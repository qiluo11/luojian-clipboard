import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Reorder, useDragControls } from "framer-motion";
import type { DragControls } from "framer-motion";
import { ArrowUpDown, File, Folder, FolderOpen, GripVertical, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import { getConciseTime } from "../../../shared/lib/utils";
import { getFileIcon, peekFileIcon } from "../../../shared/lib/fileIcon";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";
import type { Locale } from "../../../shared/types";
import "./ExplorerHistoryView.css";

/** Mirrors the Rust `ExplorerHistoryEntry` (snake_case JSON, like history). */
interface ExplorerHistoryEntry {
  id: number;
  path: string;
  name: string;
  kind: "folder" | "file" | string;
  last_visited: number;
  visit_count: number;
  is_pinned: boolean;
  /** Manual drag order (Migration 15); larger = shown first in "manual". */
  sort_order: number;
}

interface ExplorerHistoryViewProps {
  t: (key: string) => string;
  language: Locale;
  pushToast: (message: string, duration?: number) => void;
}

/**
 * Sort modes for the path list (all data is already loaded). "manual" is the
 * drag-reorder order persisted via reorder_explorer_entries; dragging a row
 * switches into it automatically.
 */
type ExplorerSortMode = "recent" | "visits" | "name" | "manual";

const SORT_MODES: ExplorerSortMode[] = ["recent", "visits", "name", "manual"];
const SORT_LABEL_KEYS: Record<ExplorerSortMode, string> = {
  recent: "explorer_sort_recent",
  visits: "explorer_sort_visits",
  name: "explorer_sort_name",
  manual: "explorer_sort_manual"
};

/**
 * Shared comparator: pinned rows lead in EVERY mode; "recent" also uses
 * sort_order as tie-break so the persisted manual order stays deterministic;
 * "manual" orders by sort_order DESC (mirrors the backend list ordering).
 */
const compareEntries = (
  a: ExplorerHistoryEntry,
  b: ExplorerHistoryEntry,
  mode: ExplorerSortMode
): number => {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  if (mode === "manual") {
    if ((a.sort_order || 0) !== (b.sort_order || 0)) {
      return (b.sort_order || 0) - (a.sort_order || 0);
    }
    return b.last_visited - a.last_visited;
  }
  if (mode === "visits") {
    if (a.visit_count !== b.visit_count) return b.visit_count - a.visit_count;
    return b.last_visited - a.last_visited;
  }
  if (mode === "name") {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  }
  return b.last_visited - a.last_visited || (b.sort_order || 0) - (a.sort_order || 0);
};

const PathItemIcon = ({ entry }: { entry: ExplorerHistoryEntry }) => {
  const [icon, setIcon] = useState<string | null>(() => peekFileIcon(entry.path) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = peekFileIcon(entry.path);
    if (cached !== undefined) {
      setIcon(cached ?? null);
      return;
    }
    setIcon(null);
    void getFileIcon(entry.path).then((next) => {
      if (!cancelled) setIcon(next);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  if (icon) {
    return <img src={icon} alt="" className="explorer-file-icon" loading="lazy" />;
  }
  return entry.kind === "folder" ? (
    <Folder size={20} className="explorer-type-icon" />
  ) : (
    <File size={20} className="explorer-type-icon" />
  );
};

const ExplorerPathItem = ({
  entry,
  t,
  language,
  pushToast,
  onChanged,
  dragControls
}: {
  entry: ExplorerHistoryEntry;
  t: (key: string) => string;
  language: Locale;
  pushToast: (message: string, duration?: number) => void;
  onChanged: () => void;
  /** Present only inside the reorderable list; renders the drag handle. */
  dragControls?: DragControls;
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Close the context menu on any outside interaction (same as favorites).
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuPos]);

  const copyPath = useCallback(async () => {
    try {
      // Plain clipboard write; the capture pipeline picks the path up as a
      // normal text/file history entry (intended linkage, see Rust side).
      await invoke("copy_path_to_clipboard", { path: entry.path });
      pushToast(t("path_copied"), 1500);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  }, [entry.path, pushToast, t]);

  // Left click / "open" menu item: folders open directly, files open with the
  // system default program ("打开所在文件夹" stays available in the context menu).
  const openEntry = useCallback(async () => {
    try {
      if (entry.kind === "folder") {
        await invoke("open_folder", { path: entry.path });
      } else {
        await invoke("open_file_with_default_app", { filePath: entry.path });
      }
    } catch (err) {
      console.error("Failed to open entry:", err);
      pushToast(t("explorer_open_failed"), 2000);
    }
  }, [entry.kind, entry.path, pushToast, t]);

  const togglePin = useCallback(async () => {
    setMenuPos(null);
    try {
      await invoke("toggle_explorer_pin", { id: entry.id });
      onChanged();
    } catch (err) {
      console.error("Failed to toggle explorer pin:", err);
    }
  }, [entry.id, onChanged]);

  const remove = useCallback(async () => {
    setMenuPos(null);
    try {
      await invoke("delete_explorer_entry", { id: entry.id });
      onChanged();
    } catch (err) {
      console.error("Failed to delete explorer entry:", err);
    }
  }, [entry.id, onChanged]);

  return (
    <div
      ref={rowRef}
      className={`history-item explorer-path-item${menuPos ? " clipboard-item--menu-open" : ""}${entry.is_pinned ? " pinned" : ""}`}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        // The drag handle drives reordering, not open (mirrors ClipboardItem).
        if (target.closest("button, input, textarea, [role='button'], .drag-handle")) return;
        if (menuPos) {
          e.preventDefault();
          return;
        }
        // Left click opens the entry directly (folder) or its containing
        // folder with the file selected (file); copy path stays in the menu.
        e.preventDefault();
        void openEntry();
      }}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea")) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = rowRef.current?.getBoundingClientRect();
        if (rect) {
          setMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }}
    >
      <div className="item-meta">
        <div className="item-meta-left">
          {dragControls && (
            <div
              className="drag-handle drag-handle--hover"
              onPointerDown={(e) => dragControls.start(e)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t("drag_reorder")}
              title={t("drag_reorder")}
              style={{
                cursor: "grab",
                alignItems: "center",
                touchAction: "none"
              }}
            >
              <GripVertical size={14} />
            </div>
          )}
          <div className="app-info">
            <PathItemIcon entry={entry} />
            <span>{entry.kind === "folder" ? t("explorer_kind_folder") : t("explorer_kind_file")}</span>
          </div>
        </div>
        <div className="item-meta-right">
          <div className="item-actions">
            <button
              className="btn-icon"
              title={entry.is_pinned ? t("unpin") : t("pin")}
              onClick={(e) => {
                e.stopPropagation();
                void togglePin();
              }}
            >
              {entry.is_pinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
            <button
              className="btn-icon"
              title={t("delete")}
              onClick={(e) => {
                e.stopPropagation();
                void remove();
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="item-meta-right-info">
            <span>{getConciseTime(entry.last_visited, language)}</span>
          </div>
        </div>
      </div>

      <div className="content-preview-shell">
        <div className="content-preview explorer-path-preview">
          <div className="explorer-path-text">
            <div className="explorer-path-name">{entry.name}</div>
            <div className="explorer-path-full" title={entry.path}>
              {entry.path}
            </div>
          </div>
          <span className="explorer-visit-count">
            {t("explorer_visit_count").replace("{count}", String(entry.visit_count))}
          </span>
        </div>
      </div>

      {menuPos && (
        <div
          className="clipboard-item-context-menu"
          style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              setMenuPos(null);
              void openEntry();
            }}
          >
            {t("explorer_open_folder")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              setMenuPos(null);
              void copyPath();
            }}
          >
            {t("explorer_copy_path")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              void togglePin();
            }}
          >
            {entry.is_pinned ? t("unpin") : t("pin")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}
          >
            {t("delete")}
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Reorder.Item wrapper around a path row (same pattern as the clipboard
 * pinned drag): dragging starts only from the row's `.drag-handle` so a
 * plain click still opens the entry.
 */
const SortablePathItem = ({
  entry,
  t,
  language,
  pushToast,
  onChanged,
  onDragStart,
  onDragEnd
}: {
  entry: ExplorerHistoryEntry;
  t: (key: string) => string;
  language: Locale;
  pushToast: (message: string, duration?: number) => void;
  onChanged: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) => {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={entry.id}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ listStyle: "none", display: "flex" }}
    >
      <ExplorerPathItem
        entry={entry}
        t={t}
        language={language}
        pushToast={pushToast}
        onChanged={onChanged}
        dragControls={controls}
      />
    </Reorder.Item>
  );
};

const ExplorerHistoryView = ({ t, language, pushToast }: ExplorerHistoryViewProps) => {
  const [entries, setEntries] = useState<ExplorerHistoryEntry[]>([]);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [sortMode, setSortMode] = useState<ExplorerSortMode>("recent");
  // In-place filter (also the Alt+F target while this tab is active, see the
  // `data-inplace-search` hook-up in App.tsx's focus-search-input listener).
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // Esc with text: clear the filter first (global keyboard nav is gated
      // for this tab, so the window-hide branch can never fire here).
      if (e.key === "Escape" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        setQuery("");
      }
    },
    []
  );

  const reload = useCallback(() => {
    invoke<ExplorerHistoryEntry[]>("get_explorer_history", { limit: 300 })
      .then(setEntries)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    reload();
    // Throttled event emitted by both collector channels on new visits.
    const unlisten = listen("explorer-history-changed", () => reload());
    return () => {
      unlisten.then((off) => off());
    };
  }, [reload]);

  // Esc closes the confirm dialog (global keyboard nav is gated for this tab).
  useEffect(() => {
    if (!clearDialogOpen) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") setClearDialogOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearDialogOpen]);

  // Filter runs before sort: the three sort modes always order the visible
  // (matching) subset. Case-insensitive substring on name and path.
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) || entry.path.toLowerCase().includes(q)
    );
  }, [entries, query]);

  // Pinned entries always lead, in every sort mode (same convention as
  // useFilteredHistory); the pinned group itself follows the chosen order.
  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => compareEntries(a, b, sortMode));
  }, [filteredEntries, sortMode]);

  // ---- Drag-reorder (handle-initiated, see SortablePathItem) ----
  // Drop switches the list into "manual" mode and persists the FULL current
  // display order (filtered-out rows keep their slots), written length-index
  // DESC to match the backend `is_pinned DESC, sort_order DESC, last_visited DESC`.
  const [isDragging, setIsDragging] = useState(false);
  const [orderIds, setOrderIds] = useState<number[]>([]);
  const orderRef = useRef<number[]>([]);

  useEffect(() => {
    if (isDragging) return;
    const next = sortedEntries.map((e) => e.id);
    setOrderIds(next);
    orderRef.current = next;
  }, [sortedEntries, isDragging]);

  const orderedVisibleEntries = useMemo(() => {
    const byId = new Map(sortedEntries.map((e) => [e.id, e]));
    const ordered: ExplorerHistoryEntry[] = [];
    const seen = new Set<number>();
    orderIds.forEach((id) => {
      const item = byId.get(id);
      if (!item || seen.has(id)) return;
      ordered.push(item);
      seen.add(id);
    });
    sortedEntries.forEach((e) => {
      if (!seen.has(e.id)) ordered.push(e);
    });
    return ordered;
  }, [sortedEntries, orderIds]);

  const handleReorder = useCallback((nextIds: number[]) => {
    setOrderIds(nextIds);
    orderRef.current = nextIds;
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    const finalVisibleIds = orderRef.current;
    const currentVisibleIds = sortedEntries.map((e) => e.id);
    if (
      finalVisibleIds.length === currentVisibleIds.length &&
      finalVisibleIds.every((id, idx) => id === currentVisibleIds[idx])
    ) {
      return;
    }
    // Slot-merge the new visible order back into the unfiltered display order.
    const byId = new Map(entries.map((e) => [e.id, e]));
    const visibleSet = new Set(finalVisibleIds);
    const fullOrder = [...entries].sort((a, b) => compareEntries(a, b, sortMode));
    const slots: number[] = [];
    fullOrder.forEach((e, i) => {
      if (visibleSet.has(e.id)) slots.push(i);
    });
    const merged = [...fullOrder];
    finalVisibleIds.forEach((id, k) => {
      const item = byId.get(id);
      const slot = slots[k];
      if (item && slot !== undefined) merged[slot] = item;
    });
    const orderMap = new Map<number, number>(
      merged.map((e, i) => [e.id, merged.length - i])
    );
    setEntries((prev) =>
      prev.map((e) => {
        const order = orderMap.get(e.id);
        return order !== undefined ? { ...e, sort_order: order } : e;
      })
    );
    invoke("reorder_explorer_entries", { ids: merged.map((e) => e.id) }).catch(console.error);
    setSortMode("manual");
  }, [entries, sortMode, sortedEntries]);

  const cycleSortMode = useCallback(() => {
    const idx = SORT_MODES.indexOf(sortMode);
    setSortMode(SORT_MODES[(idx + 1) % SORT_MODES.length]);
  }, [sortMode]);

  const handleClear = useCallback(async () => {
    setClearDialogOpen(false);
    try {
      await invoke("clear_explorer_history");
      pushToast(t("explorer_history_cleared"), 1500);
      reload();
    } catch (err) {
      console.error("Failed to clear explorer history:", err);
    }
  }, [pushToast, reload, t]);

  return (
    <div className="explorer-view">
      <div className="explorer-toolbar window-no-drag">
        {/* In-place search: always visible, filters name/path locally. Alt+F
            (focus-search-input) lands here instead of switching views. */}
        <div className="inline-search">
          <Search size={12} className="inline-search-icon" />
          <input
            ref={searchInputRef}
            data-inplace-search=""
            type="text"
            className="inline-search-input"
            placeholder={t("explorer_search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="inline-search-clear"
              title={t("cancel")}
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        {/* Single compact pill cycling recent -> visits -> name -> manual; the
            toolbar only has ~340px so the active label itself shows the mode. */}
        <button
          type="button"
          className="explorer-sort-button"
          title={t("explorer_sort").replace("{mode}", t(SORT_LABEL_KEYS[sortMode]))}
          onClick={cycleSortMode}
        >
          <ArrowUpDown size={11} />
          <span className="explorer-sort-label">{t(SORT_LABEL_KEYS[sortMode])}</span>
        </button>
        <button
          type="button"
          className="btn-icon"
          title={t("explorer_clear_all")}
          onClick={() => setClearDialogOpen(true)}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {sortedEntries.length === 0 ? (
        <div className="explorer-list">
          <div className="empty-state">
            <FolderOpen size={40} opacity={0.2} style={{ marginBottom: "12px" }} />
            <p>{query.trim() ? t("no_records") : t("explorer_empty")}</p>
          </div>
        </div>
      ) : (
        // Non-virtualized (capped at 300 rows), so a plain Reorder.Group is fine.
        <Reorder.Group
          as="div"
          axis="y"
          className="explorer-list"
          values={orderedVisibleEntries.map((e) => e.id)}
          onReorder={handleReorder}
        >
          {orderedVisibleEntries.map((entry) => (
            <SortablePathItem
              key={entry.id}
              entry={entry}
              t={t}
              language={language}
              pushToast={pushToast}
              onChanged={reload}
              onDragStart={() => setIsDragging(true)}
              onDragEnd={handleDragEnd}
            />
          ))}
        </Reorder.Group>
      )}

      {clearDialogOpen && (
        <div className="modal-overlay" onClick={() => setClearDialogOpen(false)}>
          <div
            className="confirm-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t("explorer_clear_all")}
          >
            <div className="confirm-dialog-title">{t("explorer_clear_all")}</div>
            <div className="confirm-dialog-message">{t("explorer_clear_confirm")}</div>
            <div className="confirm-dialog-buttons">
              <button
                className="confirm-dialog-button"
                onClick={() => setClearDialogOpen(false)}
              >
                <X size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                {t("cancel")}
              </button>
              <button
                className="confirm-dialog-button primary"
                onClick={() => void handleClear()}
              >
                {t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExplorerHistoryView;
