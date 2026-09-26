import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Reorder, useDragControls } from "framer-motion";
import type { DragControls } from "framer-motion";
import {
  BookmarkMinus,
  Code,
  File,
  FileText,
  Files,
  FolderInput,
  GripVertical,
  Image as ImageIcon,
  Link as LinkIcon,
  Pencil,
  Plus,
  Search,
  Star,
  Video,
  X
} from "lucide-react";
import ViewportPopover from "../../../shared/components/ViewportPopover";
import { backgroundScrollDismiss } from "../../../shared/lib/backgroundScrollDismiss";
import HtmlContent from "../../../shared/components/HtmlContent";
import { getConciseTime } from "../../../shared/lib/utils";
import { getFileIcon, peekFileIcon } from "../../../shared/lib/fileIcon";
import { toTauriLocalImageSrc } from "../../../shared/lib/localImageSrc";
import type { Locale } from "../../../shared/types";
import "./FavoritesView.css";

/** folder_id sentinel for the implicit "默认" (ungrouped) folder; mirrors Rust. */
const DEFAULT_FOLDER_ID = 0;

export interface FavoriteFolder {
  id: number;
  name: string;
  sort_order: number;
  created_at: number;
}

export interface FavoriteEntry {
  id: number;
  folder_id: number;
  title?: string | null;
  content: string;
  content_type: string;
  html_content?: string | null;
  source_app?: string | null;
  preview: string;
  created_at: number;
  use_count: number;
  sort_order: number;
}

interface FavoritesPayload {
  folders: FavoriteFolder[];
  favorites: FavoriteEntry[];
}

interface FavoritesViewProps {
  t: (key: string) => string;
  theme: string;
  language: Locale;
}

/** Strip the image-fallback marker comment that history rich_text html may carry. */
const RICH_IMAGE_MARKER_RE = /<!--TIEZ_RICH_IMAGE:[\s\S]*?-->/g;
const cleanRichHtml = (html: string) => html.replace(RICH_IMAGE_MARKER_RE, "").trim();

const getTypeIcon = (type: string) => {
  switch (type) {
    case "text":
      return <FileText size={14} />;
    case "image":
      return <ImageIcon size={14} />;
    case "url":
      return <LinkIcon size={14} />;
    case "code":
      return <Code size={14} />;
    case "file":
      return <File size={14} />;
    case "video":
      return <Video size={14} />;
    case "rich_text":
      return <FileText size={14} />;
    default:
      return <FileText size={14} />;
  }
};

interface FavoriteItemCardProps {
  entry: FavoriteEntry;
  folders: FavoriteFolder[];
  language: Locale;
  t: (key: string) => string;
  onChanged: () => void;
  /** Present only inside the reorderable list; renders the drag handle. */
  dragControls?: DragControls;
}

const FavoriteItemCard = ({
  entry,
  folders,
  language,
  t,
  onChanged,
  dragControls
}: FavoriteItemCardProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [movePos, setMovePos] = useState<{ x: number; y: number } | null>(null);
  const moveOpen = movePos !== null;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(entry.title || "");
  const [imageFailed, setImageFailed] = useState(false);
  const [fileIcon, setFileIcon] = useState<string | null>(
    () => peekFileIcon(entry.content.split("\n")[0]?.trim() || null) ?? null
  );

  const filePaths = useMemo(
    () =>
      entry.content_type === "file"
        ? entry.content.split("\n").filter((p) => p.trim())
        : [],
    [entry.content, entry.content_type]
  );
  const singleFilePath = filePaths.length === 1 ? filePaths[0] : null;

  useEffect(() => {
    let cancelled = false;
    if (entry.content_type !== "file" || !singleFilePath) {
      setFileIcon(null);
      return;
    }
    const cached = peekFileIcon(singleFilePath);
    if (cached !== undefined) {
      setFileIcon(cached ?? null);
      return;
    }
    setFileIcon(null);
    getFileIcon(singleFilePath).then((icon) => {
      if (!cancelled) setFileIcon(icon);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.content_type, singleFilePath]);

  // Close popovers on outside interaction, mirroring ClipboardItem's menu.
  useEffect(() => {
    if (!menuPos && !moveOpen) return;
    const close = () => {
      setMenuPos(null);
      setMovePos(null);
    };
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const onScroll = backgroundScrollDismiss(close);
    window.addEventListener("resize", close);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuPos, moveOpen]);

  const paste = useCallback(
    async (withFormat?: boolean) => {
      try {
        await invoke("paste_favorite", {
          id: entry.id,
          paste: true,
          pasteWithFormat: withFormat
        });
      } catch (err) {
        console.error("Failed to paste favorite:", err);
      }
    },
    [entry.id]
  );

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next === (entry.title || "").trim()) return;
    try {
      await invoke("rename_favorite", { id: entry.id, title: next });
      onChanged();
    } catch (err) {
      console.error("Failed to rename favorite:", err);
    }
  }, [entry.title, onChanged, titleDraft]);

  const remove = useCallback(async () => {
    try {
      await invoke("remove_favorite", { id: entry.id });
      onChanged();
    } catch (err) {
      console.error("Failed to remove favorite:", err);
    }
  }, [entry.id, onChanged]);

  const moveTo = useCallback(
    async (folderId: number) => {
      setMovePos(null);
      setMenuPos(null);
      try {
        await invoke("move_favorite", { id: entry.id, folderId });
        onChanged();
      } catch (err) {
        console.error("Failed to move favorite:", err);
      }
    },
    [entry.id, onChanged]
  );

  const hasHtml = entry.content_type === "rich_text" && !!entry.html_content;
  const titleTrim = (entry.title || "").trim();
  const isTextLike = ["text", "code", "url"].includes(entry.content_type);

  const renderPreview = () => {
    if (entry.content_type === "image") {
      if (imageFailed) {
        return (
          <div className="favorite-image-missing">
            <ImageIcon size={20} />
            <span>{t("favorite_image_missing")}</span>
          </div>
        );
      }
      const src = entry.content.startsWith("data:")
        ? entry.content
        : toTauriLocalImageSrc(entry.content) || convertFileSrc(entry.content);
      return (
        <img
          src={src}
          alt={t("image_preview")}
          className="image-preview"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      );
    }

    if (entry.content_type === "video") {
      const src = entry.content.startsWith("data:")
        ? entry.content
        : toTauriLocalImageSrc(entry.content) || entry.content;
      return (
        <div className="video-thumbnail-card">
          <div className="video-thumbnail-wrapper">
            <video src={src} preload="metadata" muted playsInline className="video-thumbnail-element" />
            <div className="video-play-overlay">
              <Video size={16} />
            </div>
          </div>
          <div className="video-info-wrapper">
            <div className="video-name">{entry.content.split(/[\\/]/).pop()}</div>
          </div>
        </div>
      );
    }

    if (entry.content_type === "file") {
      if (filePaths.length > 1) {
        return (
          <div className="file-thumbnail-card" title={entry.content}>
            <div className="file-icon-wrapper">
              <Files size={24} />
            </div>
            <div className="file-info-wrapper">
              <div className="file-name">{filePaths.length} {t("items")}</div>
              <div className="file-hint">{filePaths[0].split(/[\\/]/).pop()} ...</div>
            </div>
          </div>
        );
      }
      const filePath = filePaths[0] || "";
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const dirPath = filePath.split(/[\\/]/).slice(0, -1).join("\\");
      return (
        <div className="file-thumbnail-card" title={entry.content}>
          <div className={`file-icon-wrapper${fileIcon ? " file-icon-wrapper-system" : ""}`}>
            {fileIcon ? (
              <img src={fileIcon} alt={`${fileName} icon`} className="file-icon-image" loading="lazy" />
            ) : (
              <File size={24} />
            )}
          </div>
          <div className="file-info-wrapper">
            <div className="file-name">{fileName}</div>
            <div className="file-hint">{dirPath || entry.content}</div>
          </div>
        </div>
      );
    }

    if (hasHtml) {
      return (
        <HtmlContent
          className="rich-text-preview"
          htmlContent={cleanRichHtml(entry.html_content || "")}
          fallbackText={entry.preview}
          preview={true}
          style={{
            maxHeight: "64px",
            overflow: "hidden",
            fontSize: "var(--clipboard-item-font-size)",
            lineHeight: "1.4",
            position: "relative",
            pointerEvents: "none",
            maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)"
          }}
        />
      );
    }

    // Text-ish entries with a custom title show the title instead of raw content.
    if (isTextLike && titleTrim) {
      return <>{titleTrim}</>;
    }
    return <>{entry.preview || entry.content}</>;
  };

  return (
    <div
      ref={cardRef}
      className={`history-item favorite-item${menuPos || moveOpen ? " clipboard-item--menu-open" : ""}`}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        // The drag handle drives reordering, not paste (mirrors ClipboardItem).
        if (target.closest("button, input, textarea, [role='button'], .drag-handle")) return;
        if (menuPos || moveOpen) {
          e.preventDefault();
          return;
        }
        // Keep the previous app focused so the paste lands there.
        e.preventDefault();
        void paste(false);
      }}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea")) return;
        e.preventDefault();
        e.stopPropagation();
        setMovePos(null);
        setMenuPos({ x: e.clientX, y: e.clientY });
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
            {getTypeIcon(entry.content_type)}
            <span>{entry.source_app || t("view_favorites")}</span>
          </div>
        </div>
        <div className="item-meta-right">
          <div className="item-actions">
            <button
              className={`btn-icon ${editingTitle ? "active" : ""}`}
              title={t("favorite_edit_title")}
              onClick={(e) => {
                e.stopPropagation();
                setMenuPos(null);
                setMovePos(null);
                setTitleDraft(entry.title || "");
                setEditingTitle((prev) => !prev);
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              className={`btn-icon ${moveOpen ? "active" : ""}`}
              title={t("favorite_move_to")}
              onMouseDown={e => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                setMenuPos(null);
                const rect = e.currentTarget.getBoundingClientRect();
                setMovePos(prev => prev ? null : { x: rect.left, y: rect.bottom + 4 });
              }}
            >
              <FolderInput size={12} />
            </button>
            <button className="btn-icon" title={t("favorite_remove")} onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}>
              <BookmarkMinus size={12} />
            </button>
          </div>
          <div className="item-meta-right-info">
            <span>{getConciseTime(entry.created_at, language)}</span>
          </div>
        </div>
      </div>

      <div className="content-preview-shell">
        {titleTrim && !(isTextLike && titleTrim) && (
          <div className="item-display-title">{titleTrim}</div>
        )}
        {editingTitle && (
          <input
            className="favorite-title-input"
            type="text"
            autoFocus
            value={titleDraft}
            placeholder={t("favorite_title_placeholder")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditingTitle(false);
              }
            }}
          />
        )}
        <div
          className={`content-preview${entry.content_type === "rich_text" ? " rich-text" : ""}${entry.content_type === "file" ? " file-preview" : ""}`}
        >
          {renderPreview()}
        </div>
      </div>

      {movePos && (
        <ViewportPopover className="favorite-popover" x={movePos.x} y={movePos.y}>
          <button
            type="button"
            className={`clipboard-item-context-menu__item${entry.folder_id === DEFAULT_FOLDER_ID ? " favorite-menu-item--current" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              void moveTo(DEFAULT_FOLDER_ID);
            }}
          >
            {t("favorite_folder_default")}
          </button>
          {folders.map((folder) => (
            <button
              type="button"
              key={folder.id}
              className={`clipboard-item-context-menu__item${entry.folder_id === folder.id ? " favorite-menu-item--current" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                void moveTo(folder.id);
              }}
            >
              {folder.name}
            </button>
          ))}
        </ViewportPopover>
      )}

      {menuPos && (
        <ViewportPopover className="favorite-popover" x={menuPos.x} y={menuPos.y}>
          {hasHtml && (
            <button
              type="button"
              className="clipboard-item-context-menu__item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuPos(null);
                void paste(true);
              }}
            >
              {t("favorite_paste_with_format")}
            </button>
          )}
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              setMenuPos(null);
              setTitleDraft(entry.title || "");
              setEditingTitle(true);
            }}
          >
            {t("favorite_edit_title")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              setMenuPos(null);
              setMovePos(menuPos);
            }}
          >
            {t("favorite_move_to")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              setMenuPos(null);
              void remove();
            }}
          >
            {t("favorite_remove")}
          </button>
        </ViewportPopover>
      )}
    </div>
  );
};

/**
 * Reorder.Item wrapper around a favorite card (mirrors the clipboard pinned
 * SortableItem): drag starts only from the card's `.drag-handle`, so a plain
 * click keeps pasting.
 */
const SortableFavoriteItem = ({
  entry,
  folders,
  language,
  t,
  onChanged,
  onDragStart,
  onDragEnd
}: {
  entry: FavoriteEntry;
  folders: FavoriteFolder[];
  language: Locale;
  t: (key: string) => string;
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
      <FavoriteItemCard
        entry={entry}
        folders={folders}
        language={language}
        t={t}
        onChanged={onChanged}
        dragControls={controls}
      />
    </Reorder.Item>
  );
};

const FavoritesView = ({ t, theme, language }: FavoritesViewProps) => {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number>(DEFAULT_FOLDER_ID);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderMenu, setFolderMenu] = useState<{ folderId: number; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FavoriteFolder | null>(null);
  // In-place search (the Alt+F target while this view is active, see the
  // `data-inplace-search` hook-up in App.tsx's focus-search-input listener).
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      // Esc with text: clear the filter first (global keyboard nav is gated
      // for the favorites view, so the window-hide branch can't fire).
      if (e.key === "Escape" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        setQuery("");
      }
    },
    []
  );

  const reload = useCallback(() => {
    invoke<FavoritesPayload>("list_favorites")
      .then((payload) => {
        setFolders(payload.folders);
        setFavorites(payload.favorites);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Close folder tab menu on outside interaction.
  useEffect(() => {
    if (!folderMenu) return;
    const close = () => setFolderMenu(null);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    const onScroll = backgroundScrollDismiss(close);
    window.addEventListener("resize", close);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [folderMenu]);

  const submitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName("");
    if (!name) return;
    try {
      const id = await invoke<number>("create_folder", { name });
      reload();
      setActiveFolderId(id);
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  }, [newFolderName, reload]);

  const commitRenameFolder = useCallback(async () => {
    const id = renamingFolderId;
    const name = folderDraft.trim();
    setRenamingFolderId(null);
    if (id === null || !name) return;
    try {
      await invoke("rename_folder", { id, name });
      reload();
    } catch (err) {
      console.error("Failed to rename folder:", err);
    }
  }, [folderDraft, reload, renamingFolderId]);

  const confirmDeleteFolder = useCallback(
    async (deleteItems: boolean) => {
      const target = deleteTarget;
      setDeleteTarget(null);
      if (!target) return;
      try {
        await invoke("delete_folder", { id: target.id, deleteItems });
        if (activeFolderId === target.id) {
          setActiveFolderId(DEFAULT_FOLDER_ID);
        }
        reload();
      } catch (err) {
        console.error("Failed to delete folder:", err);
      }
    },
    [activeFolderId, deleteTarget, reload]
  );

  // Folder scoping plus an in-place text filter (title / content,
  // case-insensitive substring). The folder-tab counts intentionally stay
  // unfiltered so tabs don't flicker while typing.
  const visibleFavorites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return favorites.filter((f) => {
      if (f.folder_id !== activeFolderId) return false;
      if (!q) return true;
      return (
        (f.title || "").toLowerCase().includes(q) ||
        f.content.toLowerCase().includes(q)
      );
    });
  }, [activeFolderId, favorites, query]);

  // ---- Favorite entry drag-reorder (Reorder.Group over the visible list) ----
  // Same shape as the clipboard pinned drag (AppMainContent): the id order is
  // local state synced from the derived list while not dragging; drop commits
  // length-index DESC sort_order locally (optimistic) + persists fire-and-forget.
  const [isDraggingEntries, setIsDraggingEntries] = useState(false);
  const [entryOrderIds, setEntryOrderIds] = useState<number[]>([]);
  const entryOrderRef = useRef<number[]>([]);

  useEffect(() => {
    if (isDraggingEntries) return;
    const next = visibleFavorites.map((f) => f.id);
    setEntryOrderIds(next);
    entryOrderRef.current = next;
  }, [visibleFavorites, isDraggingEntries]);

  const orderedVisibleFavorites = useMemo(() => {
    const byId = new Map(visibleFavorites.map((f) => [f.id, f]));
    const ordered: FavoriteEntry[] = [];
    const seen = new Set<number>();
    entryOrderIds.forEach((id) => {
      const item = byId.get(id);
      if (!item || seen.has(id)) return;
      ordered.push(item);
      seen.add(id);
    });
    visibleFavorites.forEach((f) => {
      if (!seen.has(f.id)) ordered.push(f);
    });
    return ordered;
  }, [visibleFavorites, entryOrderIds]);

  const handleEntryReorder = useCallback((nextIds: number[]) => {
    setEntryOrderIds(nextIds);
    entryOrderRef.current = nextIds;
  }, []);

  // Simple scheme under a search filter: only the VISIBLE entries reorder
  // among themselves — filtered-out rows keep the slots they currently occupy
  // inside the group — then the whole group is renumbered DESC.
  const commitEntryReorder = useCallback(
    (finalVisibleIds: number[]) => {
      const q = query.trim().toLowerCase();
      const group = favorites.filter((f) => f.folder_id === activeFolderId);
      const byId = new Map(group.map((f) => [f.id, f]));
      const isVisible = (f: FavoriteEntry) =>
        !q ||
        (f.title || "").toLowerCase().includes(q) ||
        f.content.toLowerCase().includes(q);
      const slots: number[] = [];
      group.forEach((f, i) => {
        if (isVisible(f)) slots.push(i);
      });
      const merged = [...group];
      finalVisibleIds.forEach((id, k) => {
        const item = byId.get(id);
        const slot = slots[k];
        if (item && slot !== undefined) merged[slot] = item;
      });
      const mergedIds = merged.map((f) => f.id);
      const currentIds = group.map((f) => f.id);
      if (
        mergedIds.length === currentIds.length &&
        mergedIds.every((id, i) => id === currentIds[i])
      ) {
        return;
      }
      const orderMap = new Map<number, number>(
        mergedIds.map((id, index) => [id, mergedIds.length - index])
      );
      setFavorites((prev) => {
        const patched = prev.map((f) => {
          const order = orderMap.get(f.id);
          return order !== undefined ? { ...f, sort_order: order } : f;
        });
        patched.sort((a, b) => b.sort_order - a.sort_order || b.id - a.id);
        return patched;
      });
      invoke("reorder_favorites", { ids: mergedIds }).catch(console.error);
    },
    [activeFolderId, favorites, query]
  );

  const handleEntryDragEnd = useCallback(() => {
    setIsDraggingEntries(false);
    commitEntryReorder(entryOrderRef.current);
  }, [commitEntryReorder]);

  // ---- Folder tab drag-reorder (horizontal) ----
  const [isDraggingFolders, setIsDraggingFolders] = useState(false);
  const [folderOrderIds, setFolderOrderIds] = useState<number[]>([]);
  const folderOrderRef = useRef<number[]>([]);

  useEffect(() => {
    if (isDraggingFolders) return;
    const next = folders.map((f) => f.id);
    setFolderOrderIds(next);
    folderOrderRef.current = next;
  }, [folders, isDraggingFolders]);

  const orderedFolders = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ordered: FavoriteFolder[] = [];
    const seen = new Set<number>();
    folderOrderIds.forEach((id) => {
      const item = byId.get(id);
      if (!item || seen.has(id)) return;
      ordered.push(item);
      seen.add(id);
    });
    folders.forEach((f) => {
      if (!seen.has(f.id)) ordered.push(f);
    });
    return ordered;
  }, [folders, folderOrderIds]);

  const handleFolderReorder = useCallback((nextIds: number[]) => {
    setFolderOrderIds(nextIds);
    folderOrderRef.current = nextIds;
  }, []);

  const handleFolderDragEnd = useCallback(() => {
    setIsDraggingFolders(false);
    const finalIds = folderOrderRef.current;
    const currentIds = folders.map((f) => f.id);
    if (
      finalIds.length === currentIds.length &&
      finalIds.every((id, idx) => id === currentIds[idx])
    ) {
      return;
    }
    // Folder query is ASCENDING (sort_order, id): index itself is the order.
    const orderMap = new Map<number, number>(finalIds.map((id, index) => [id, index]));
    setFolders((prev) => {
      const patched = prev.map((f) => {
        const order = orderMap.get(f.id);
        return order !== undefined ? { ...f, sort_order: order } : f;
      });
      patched.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return patched;
    });
    invoke("reorder_favorite_folders", { ids: finalIds }).catch(console.error);
  }, [folders]);

  const tabCount = useCallback(
    (folderId: number) =>
      favorites.filter((f) => f.folder_id === folderId).length,
    [favorites]
  );

  // Real folder tabs live in a horizontal Reorder.Group (drag to reorder;
  // persisted via reorder_favorite_folders). The rename editor disables the
  // drag listener so text selection inside the input still works.
  const renderFolderTab = (folder: FavoriteFolder) => {
    const renaming = renamingFolderId === folder.id;
    const content = renaming ? (
      <input
        className="favorite-folder-input"
        type="text"
        autoFocus
        value={folderDraft}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
        onChange={(e) => setFolderDraft(e.target.value)}
        onBlur={() => void commitRenameFolder()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setRenamingFolderId(null);
          }
        }}
      />
    ) : (
      <button
        className={`category-tab favorite-folder-tab${activeFolderId === folder.id ? " active" : ""}`}
        title={`${folder.name} · ${t("drag_reorder")}`}
        onClick={() => setActiveFolderId(folder.id)}
        onDoubleClick={() => {
          setRenamingFolderId(folder.id);
          setFolderDraft(folder.name);
        }}
        onMouseDown={e => { if (e.button === 2) e.preventDefault(); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setFolderMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
        }}
      >
        {folder.name}
        <span className="favorite-folder-count">{tabCount(folder.id)}</span>
      </button>
    );
    return (
      <Reorder.Item
        key={folder.id}
        value={folder.id}
        as="div"
        className="favorite-folder-tab-item"
        dragListener={!renaming}
        dragMomentum={false}
        onDragStart={() => setIsDraggingFolders(true)}
        onDragEnd={handleFolderDragEnd}
        style={{ listStyle: "none", display: "inline-flex" }}
      >
        {content}
      </Reorder.Item>
    );
  };

  return (
    <div className="favorites-view">
      <div
        className="favorite-folders window-no-drag hide-scrollbar"
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        <button
          className={`category-tab favorite-folder-tab${activeFolderId === DEFAULT_FOLDER_ID ? " active" : ""}`}
          onClick={() => setActiveFolderId(DEFAULT_FOLDER_ID)}
        >
          {t("favorite_folder_default")}
          <span className="favorite-folder-count">{tabCount(DEFAULT_FOLDER_ID)}</span>
        </button>
        <Reorder.Group
          as="div"
          axis="x"
          className="favorite-folders-group"
          values={orderedFolders.map((f) => f.id)}
          onReorder={handleFolderReorder}
        >
          {orderedFolders.map(renderFolderTab)}
        </Reorder.Group>
        {creatingFolder ? (
          <input
            className="favorite-folder-input"
            type="text"
            autoFocus
            value={newFolderName}
            placeholder={t("new_folder")}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={() => void submitNewFolder()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
          />
        ) : (
          <button
            className="category-tab favorite-add-folder"
            title={t("new_folder")}
            onClick={() => setCreatingFolder(true)}
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      <div className="favorite-search-row window-no-drag">
        <div className="inline-search">
          <Search size={12} className="inline-search-icon" />
          <input
            ref={searchInputRef}
            data-inplace-search=""
            type="text"
            className="inline-search-input"
            placeholder={t("favorite_search_placeholder")}
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
      </div>

      {visibleFavorites.length === 0 ? (
        <div className="favorites-list">
          <div className="empty-state">
            <Star size={40} opacity={0.2} style={{ marginBottom: "12px" }} />
            <p>{query.trim() ? t("no_records") : t("favorites_empty")}</p>
          </div>
        </div>
      ) : (
        <Reorder.Group
          as="div"
          axis="y"
          className="favorites-list"
          values={orderedVisibleFavorites.map((f) => f.id)}
          onReorder={handleEntryReorder}
        >
          {orderedVisibleFavorites.map((entry) => (
            <SortableFavoriteItem
              key={entry.id}
              entry={entry}
              folders={folders}
              language={language}
              t={t}
              onChanged={reload}
              onDragStart={() => setIsDraggingEntries(true)}
              onDragEnd={handleEntryDragEnd}
            />
          ))}
        </Reorder.Group>
      )}

      {folderMenu && (
        <ViewportPopover className="favorite-popover" x={folderMenu.x} y={folderMenu.y}>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              const folder = folders.find((f) => f.id === folderMenu.folderId);
              setFolderMenu(null);
              if (folder) {
                setRenamingFolderId(folder.id);
                setFolderDraft(folder.name);
              }
            }}
          >
            {t("rename_folder")}
          </button>
          <button
            type="button"
            className="clipboard-item-context-menu__item"
            onClick={(e) => {
              e.stopPropagation();
              const folder = folders.find((f) => f.id === folderMenu.folderId);
              setFolderMenu(null);
              if (folder) setDeleteTarget(folder);
            }}
          >
            {t("delete_folder")}
          </button>
        </ViewportPopover>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div
            className={`confirm-dialog theme-${theme} favorites-folder-dialog`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t("delete_folder")}
          >
            <div className="confirm-dialog-title">{t("delete_folder")}</div>
            <div className="confirm-dialog-message">
              {t("delete_folder_question").replace("{name}", deleteTarget.name)}
            </div>
            <div className="confirm-dialog-buttons">
              <button
                className="confirm-dialog-button"
                onClick={() => setDeleteTarget(null)}
              >
                <X size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                {t("cancel")}
              </button>
              <button
                className="confirm-dialog-button"
                onClick={() => void confirmDeleteFolder(false)}
              >
                {t("delete_folder_keep_items")}
              </button>
              <button
                className="confirm-dialog-button primary"
                onClick={() => void confirmDeleteFolder(true)}
              >
                {t("delete_folder_with_items")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FavoritesView;
