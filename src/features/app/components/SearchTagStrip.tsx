import type { CSSProperties } from "react";
import { LayoutGroup, MotionConfig, motion } from "framer-motion";
import { getTagColor } from "../../../shared/lib/utils";
import type { TagCatalogEntry } from "../../../shared/hooks/useTagCatalog";
import type { useLongPressReorder } from "../../../shared/hooks/useLongPressReorder";

interface SearchTagStripProps {
  t: (key: string) => string;
  tags: TagCatalogEntry[];
  /** Exact tag currently applied through a `tag:` search, if any. */
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
  theme: string;
  tagColors: Record<string, string>;
  /** Long-press drag reordering (optional). */
  reorder?: ReturnType<typeof useLongPressReorder>;
}

const EASE_OUT: [number, number, number, number] = [0.2, 0, 0, 1];

/**
 * Always-visible single-row tag filter under the search input. It no longer
 * mounts on focus / unmounts on blur, so the list below never jumps.
 */
const SearchTagStrip = ({ t, tags, activeTag, onSelect, theme, tagColors, reorder }: SearchTagStripProps) => (
  <MotionConfig reducedMotion="user">
    <LayoutGroup id="search-tag-strip">
      <motion.div
        layoutScroll
        ref={reorder?.containerRef}
        className={`search-tag-strip window-no-drag hide-scrollbar${reorder?.draggingId ? " reordering" : ""}`}
        role="toolbar"
        aria-label={t("tags")}
        onWheel={(e) => {
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {tags.length === 0 ? (
          <span className="search-tag-empty">{t("search_tags_empty")}</span>
        ) : (
          tags.map((tag, i) => {
            const isActive = activeTag === tag.name;
            const background = tagColors[tag.name] || getTagColor(tag.name, theme);
            const style = {
              "--chip-bg": background
            } as CSSProperties;
            return (
              <motion.button
                key={tag.name}
                {...(reorder ? reorder.itemProps(tag.name) : {})}
                type="button"
                // Stand down while a long-press drag runs: the reorder hook animates
                // the chips itself (two layout systems fighting caused jumps).
                layout={reorder?.busy ? false : "position"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  opacity: { duration: 0.16, delay: Math.min(i, 12) * 0.025, ease: EASE_OUT },
                  y: { duration: 0.16, delay: Math.min(i, 12) * 0.025, ease: EASE_OUT },
                  layout: { type: "spring", stiffness: 520, damping: 40 }
                }}
                className={`search-tag-chip${isActive ? " active" : ""}`}
                style={style}
                aria-pressed={isActive}
                title={`${tag.name} · ${tag.count}`}
                data-tag={tag.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(isActive ? null : tag.name)}
              >
                {isActive && (
                  <motion.span
                    layoutId="search-tag-active-ring"
                    className="search-tag-active-ring"
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                  />
                )}
                <span className="search-tag-name">{tag.name}</span>
                <span className="search-tag-count">{tag.count}</span>
              </motion.button>
            );
          })
        )}
      </motion.div>
    </LayoutGroup>
  </MotionConfig>
);

export default SearchTagStrip;
