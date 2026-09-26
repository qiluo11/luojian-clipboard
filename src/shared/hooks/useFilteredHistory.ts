import { useMemo } from "react";
import type { ClipboardEntry } from "../types";
import { matchesCategoryTab } from "../config/categoryTabs";

interface UseFilteredHistoryOptions {
  history: ClipboardEntry[];
  search: string;
  /** Active category tab id (null = default / show all). */
  typeFilter: string | null;
  pinnedOnlyInPinned: boolean;
}

export const useFilteredHistory = ({
  history,
  search,
  typeFilter,
  pinnedOnlyInPinned
}: UseFilteredHistoryOptions) => {
  return useMemo(() => {
    const lowerSearch = search.toLowerCase();

    const filtered = history.filter((item) => {
      if (pinnedOnlyInPinned && typeFilter !== "pinned" && item.is_pinned) return false;
      if (!matchesCategoryTab(item, typeFilter)) {
        return false;
      }

      let effectiveSearch = lowerSearch;
      const isTagSearch = effectiveSearch.startsWith("tag:");
      if (isTagSearch) {
        effectiveSearch = effectiveSearch.slice(4);
      }

      if (!effectiveSearch) return true;

      if (isTagSearch) {
        return item.tags?.some((tag) => tag.toLowerCase().includes(effectiveSearch)) ?? false;
      }

      return (
        item.content?.toLowerCase().includes(effectiveSearch) ||
        item.source_app?.toLowerCase().includes(effectiveSearch) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(effectiveSearch))
      );
    });

    return filtered.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }
      if (a.is_pinned) {
        if ((a.pinned_order || 0) !== (b.pinned_order || 0)) {
          return (b.pinned_order || 0) - (a.pinned_order || 0);
        }
        return b.timestamp - a.timestamp;
      }
      return b.timestamp - a.timestamp;
    });
  }, [history, search, typeFilter, pinnedOnlyInPinned]);
};
