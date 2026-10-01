/**
 * User-defined ordering for the header buttons, category tabs and search tag
 * chips. Orders are persisted as JSON string arrays in the settings table
 * (keys below, stored through `saveAppSetting`, i.e. with the `app.` prefix).
 */

export const HEADER_BUTTON_ORDER_KEY = "header_button_order";
export const CATEGORY_TAB_ORDER_KEY = "category_tab_order";
export const SEARCH_TAG_ORDER_KEY = "search_tag_order";
export const SEARCH_TAG_SORT_KEY = "search_tag_sort";

export type SearchTagSortMode = "count" | "custom";

/** Default order of the draggable header buttons: settings sits rightmost; the hide "X" stays after it and is not draggable. */
export const DEFAULT_HEADER_BUTTON_ORDER = [
  "pin",
  "search",
  "clear",
  "tags",
  "emoji",
  "chat",
  "settings"
] as const;

/** Parse a stored JSON array of strings; anything malformed yields []. */
export const parseStoredOrder = (raw: string | undefined | null): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v === "string" && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  } catch {
    return [];
  }
};

/**
 * Merge a stored order with the ids that currently exist: stored ids that no
 * longer exist are dropped, ids missing from the stored order are appended in
 * their natural (`available`) order.
 */
export const applyStoredOrder = (available: readonly string[], stored: readonly string[]): string[] => {
  const availableSet = new Set(available);
  const result: string[] = [];
  const used = new Set<string>();
  for (const id of stored) {
    if (availableSet.has(id) && !used.has(id)) {
      used.add(id);
      result.push(id);
    }
  }
  for (const id of available) {
    if (!used.has(id)) {
      used.add(id);
      result.push(id);
    }
  }
  return result;
};

/**
 * Move `dragId` so it sits just before `beforeId` (or at the very end when
 * `beforeId` is null). Ids not currently rendered keep their relative slot.
 */
export const moveBefore = (order: readonly string[], dragId: string, beforeId: string | null): string[] => {
  if (dragId === beforeId) return [...order];
  const without = order.filter((id) => id !== dragId);
  if (beforeId === null) return [...without, dragId];
  const idx = without.indexOf(beforeId);
  if (idx < 0) return [...without, dragId];
  return [...without.slice(0, idx), dragId, ...without.slice(idx)];
};

/** Move `dragId` so it sits just after `afterId`. */
export const moveAfter = (order: readonly string[], dragId: string, afterId: string): string[] => {
  if (dragId === afterId) return [...order];
  const without = order.filter((id) => id !== dragId);
  const idx = without.indexOf(afterId);
  if (idx < 0) return [...without, dragId];
  return [...without.slice(0, idx + 1), dragId, ...without.slice(idx + 1)];
};

export const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
