import type { ClipboardEntry } from "../types";

/**
 * Quicker-style category tabs shown in the app header.
 *
 * The `typeFilter` state holds the active tab id ("default" is stored as
 * `null`). A tab maps to one or more `content_type` values; only tabs that
 * map to a single content type can be pushed down to the backend
 * (`get_clipboard_history` accepts one optional `contentType`), the rest are
 * filtered purely on the client.
 */
export type CategoryTabId =
  | "default"
  | "pinned"
  | "text"
  | "rich_text"
  | "image"
  | "file"
  /** Explorer access history tab. Not a clipboard content type: when active
   * the list area renders `ExplorerHistoryView` instead of clipboard items. */
  | "paths";

export interface CategoryTab {
  id: CategoryTabId;
  /** Locale key for the tab label. */
  labelKey: string;
}

export const CATEGORY_TABS: CategoryTab[] = [
  { id: "default", labelKey: "category_default" },
  { id: "pinned", labelKey: "category_pinned" },
  { id: "text", labelKey: "category_text" },
  { id: "rich_text", labelKey: "category_rich_text" },
  { id: "image", labelKey: "category_image" },
  { id: "file", labelKey: "category_file" },
  { id: "paths", labelKey: "category_paths" }
];

/**
 * Tabs whose whole match set is a single content type get server-side
 * filtering. Multi-type tabs ("text", "file") need client-side type filtering.
 * The independent pin dimension is sent as `pinnedFilter`, not `contentType`.
 */
export const SERVER_SINGLE_TYPE_BY_TAB: Record<string, string> = {
  rich_text: "rich_text",
  image: "image"
};

const TEXT_TYPES = new Set(["text", "url", "code"]);
const FILE_TYPES = new Set(["file", "video"]);

/** True when the "paths" tab owns the list area (ExplorerHistoryView replaces
 * the clipboard list; search is hidden while it is active). */
export const isPathsTab = (tabId: string | null): boolean => tabId === "paths";

/** Client-side predicate for the active tab (null / "default" matches all). */
export const matchesCategoryTab = (
  item: ClipboardEntry,
  tabId: string | null
): boolean => {
  if (!tabId || tabId === "default") return true;
  // "paths" is a separate data source, never a clipboard content filter.
  if (tabId === "paths") return false;
  if (tabId === "pinned") return !!item.is_pinned;
  if (tabId === "text") return TEXT_TYPES.has(item.content_type);
  if (tabId === "file") return FILE_TYPES.has(item.content_type);
  // rich_text / image: also kept correct if new single-type tabs are added.
  return item.content_type === tabId;
};
