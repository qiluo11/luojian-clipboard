import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TagCatalogEntry {
  name: string;
  count: number;
}

/** Most-used first, then by name; blank names are dropped. */
export const sortTagCatalog = (map: Record<string, number>): TagCatalogEntry[] =>
  Object.entries(map)
    .filter(([name]) => name.trim().length > 0)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const sameCatalog = (a: TagCatalogEntry[], b: TagCatalogEntry[]) =>
  a.length === b.length &&
  a.every((entry, i) => entry.name === b[i].name && entry.count === b[i].count);

/**
 * Full tag list for the search tag strip, read from `get_all_tags_info`
 * (entry_tags counts + saved_tags with zero items). Unlike the old
 * history-derived list, newly created tags show up before they are used.
 * `refreshToken` / `refreshToken2` changes trigger a debounced refetch; an
 * unchanged result keeps the previous array so chips never re-render.
 */
export const useTagCatalog = (refreshToken: unknown, refreshToken2: unknown) => {
  const [tags, setTags] = useState<TagCatalogEntry[]>([]);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const map = await invoke<Record<string, number>>("get_all_tags_info");
      if (seq !== seqRef.current) return;
      const next = sortTagCatalog(map || {});
      setTags((prev) => (sameCatalog(prev, next) ? prev : next));
    } catch (e) {
      console.error("Failed to load tag catalog", e);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(refresh, 250);
    return () => window.clearTimeout(id);
  }, [refresh, refreshToken, refreshToken2]);

  return { tags, refresh };
};
