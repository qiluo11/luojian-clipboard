import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { ClipboardEntry, ClipboardProperties, Locale } from "../../../shared/types";
import "./ItemPropertiesPanel.css";

interface ItemPropertiesPanelProps {
  /** Entry the panel was opened from (list payload; content may be truncated). */
  entry: ClipboardEntry;
  /** Current user-defined display title (from the title map). */
  displayTitle?: string;
  language: Locale;
  t: (key: string) => string;
  onClose: () => void;
  /** Persist the display title; resolves to the (possibly new) real entry id. */
  onSetTitle: (id: number, title: string) => Promise<number>;
}

type SourceTab = "text" | "html";

const CONTENT_TYPE_LABEL_KEYS: Record<string, string> = {
  text: "type_text",
  code: "type_code",
  url: "type_url",
  file: "type_file",
  image: "type_image",
  video: "type_video",
  rich_text: "type_rich_text",
  emoji: "type_emoji"
};

const LOCALE_TAGS: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en-US",
  tw: "zh-TW"
};

const formatTimestamp = (ts: number | null | undefined, language: Locale): string => {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  try {
    return new Date(ts).toLocaleString(LOCALE_TAGS[language] || "en-US");
  } catch {
    return new Date(ts).toLocaleString();
  }
};

const ItemPropertiesPanel = ({
  entry,
  displayTitle,
  language,
  t,
  onClose,
  onSetTitle
}: ItemPropertiesPanelProps) => {
  // Session (negative id) items get persisted once a title is saved; track the real id.
  const [targetId, setTargetId] = useState<number>(entry.id);
  const [properties, setProperties] = useState<ClipboardProperties | null>(null);
  const [activeTab, setActiveTab] = useState<SourceTab>("text");
  const [titleDraft, setTitleDraft] = useState<string>((displayTitle || "").trim());
  const [savingTitle, setSavingTitle] = useState(false);

  // Fetch full-fidelity properties (un-truncated content/html) for this entry.
  useEffect(() => {
    let cancelled = false;
    invoke<ClipboardProperties>("get_clipboard_properties", { id: targetId })
      .then((payload) => {
        if (!cancelled) setProperties(payload);
      })
      .catch((err) => {
        console.error("Failed to load entry properties:", err);
        if (!cancelled) {
          // Fall back to whatever the list payload already carries.
          setProperties({
            id: entry.id,
            content_type: entry.content_type,
            content: entry.content,
            html_content: entry.html_content ?? null,
            display_title: displayTitle ? displayTitle : null,
            source_app: entry.source_app,
            timestamp: entry.timestamp,
            updated_at: null,
            last_used_at: null,
            use_count: entry.use_count ?? 0,
            is_pinned: entry.is_pinned
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // displayTitle intentionally excluded: it is the fallback seed, refetching on
    // every title-map change would fight with the local draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, entry.id]);

  // Keep the draft in sync when the panel switches to another entry.
  useEffect(() => {
    setTargetId(entry.id);
    setTitleDraft((displayTitle || "").trim());
    setActiveTab("text");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceText = properties ? properties.content : entry.content;
  const sourceHtml = properties?.html_content || null;
  const hasHtml = !!sourceHtml;

  useEffect(() => {
    if (activeTab === "html" && !hasHtml) setActiveTab("text");
  }, [activeTab, hasHtml]);

  const commitTitle = useCallback(async () => {
    const next = titleDraft.trim();
    if (savingTitle) return;
    setSavingTitle(true);
    try {
      const realId = await onSetTitle(targetId, next);
      setTargetId(realId);
      setProperties((prev) =>
        prev ? { ...prev, id: realId, display_title: next || null } : prev
      );
    } catch (err) {
      console.error("Failed to save display title:", err);
    } finally {
      setSavingTitle(false);
    }
  }, [onSetTitle, savingTitle, targetId, titleDraft]);

  const handlePinChange = useCallback(
    async (nextPinned: boolean) => {
      try {
        const newId = await invoke<number>("toggle_clipboard_pin", {
          id: targetId,
          isPinned: nextPinned
        });
        setTargetId(newId);
        setProperties((prev) =>
          prev ? { ...prev, id: newId, is_pinned: nextPinned } : prev
        );
      } catch (err) {
        console.error("Failed to toggle pin:", err);
      }
    },
    [targetId]
  );

  const typeLabel = useMemo(() => {
    const ct = properties?.content_type || entry.content_type;
    const key = CONTENT_TYPE_LABEL_KEYS[ct];
    return key ? t(key) : ct;
  }, [properties?.content_type, entry.content_type, t]);

  return (
    <div className="modal-overlay ips-overlay" onClick={onClose}>
      <div
        className="item-properties-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("properties")}
      >
        <div className="ips-header">
          <div className="ips-title">{t("properties")}</div>
          <button
            type="button"
            className="ips-close-btn"
            onClick={onClose}
            title={t("close")}
            aria-label={t("close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="ips-section">
          <label className="ips-field-label" htmlFor="ips-title-input">
            {t("props_title_label")}
          </label>
          <input
            id="ips-title-input"
            className="ips-title-input"
            type="text"
            value={titleDraft}
            placeholder={t("props_title_placeholder")}
            disabled={savingTitle}
            onFocus={() => invoke("focus_clipboard_window").catch(console.error)}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              void commitTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>

        <div className="ips-section">
          <div className="ips-field-label">{t("props_source")}</div>
          <div className="ips-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "text"}
              className={`ips-tab${activeTab === "text" ? " ips-tab--active" : ""}`}
              onClick={() => setActiveTab("text")}
            >
              {t("type_text")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "html"}
              className={`ips-tab${activeTab === "html" ? " ips-tab--active" : ""}`}
              disabled={!hasHtml}
              title={hasHtml ? undefined : t("props_no_html")}
              onClick={() => hasHtml && setActiveTab("html")}
            >
              HTML
            </button>
          </div>
          <pre className="ips-source-content" aria-label={t("props_source")}>
            {activeTab === "html" && sourceHtml ? sourceHtml : sourceText || "-"}
          </pre>
        </div>

        <div className="ips-section">
          <div className="ips-field-label">{t("props_fields")}</div>
          <div className="ips-props-grid">
            <div className="ips-prop-row">
              <span className="ips-prop-key">ID</span>
              <span className="ips-prop-value">{properties?.id ?? entry.id}</span>
            </div>
            <div className="ips-prop-row">
              <span className="ips-prop-key">{t("props_type")}</span>
              <span className="ips-prop-value">{typeLabel}</span>
            </div>
            <div className="ips-prop-row">
              <span className="ips-prop-key">{t("props_created_at")}</span>
              <span className="ips-prop-value">
                {formatTimestamp(properties?.timestamp ?? entry.timestamp, language)}
              </span>
            </div>
            <div className="ips-prop-row">
              <span className="ips-prop-key">{t("props_last_used_at")}</span>
              <span className="ips-prop-value">
                {formatTimestamp(properties?.last_used_at, language)}
              </span>
            </div>
            <div className="ips-prop-row">
              <span className="ips-prop-key">{t("props_updated_at")}</span>
              <span className="ips-prop-value">
                {formatTimestamp(properties?.updated_at, language)}
              </span>
            </div>
            <div className="ips-prop-row">
              <span className="ips-prop-key">{t("use_count")}</span>
              <span className="ips-prop-value">{properties?.use_count ?? entry.use_count ?? 0}</span>
            </div>
            <label className="ips-prop-row ips-prop-row--check">
              <span className="ips-prop-key">{t("props_pinned")}</span>
              <input
                type="checkbox"
                checked={properties?.is_pinned ?? entry.is_pinned}
                onChange={(e) => {
                  void handlePinChange(e.target.checked);
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemPropertiesPanel;
