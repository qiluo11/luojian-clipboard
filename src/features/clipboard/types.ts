import type { MouseEvent, ReactNode } from "react";
import type { DragControls } from "framer-motion";
import type { ClipboardEntry, Locale } from "../../shared/types";
import type { WebAiPrompt } from "../settings/types";

export interface QuickPasteHint {
  slot: number;
  combo: string;
}

export interface ClipboardItemProps {
  item: ClipboardEntry;
  isSelected: boolean;
  windowPinned: boolean;
  isSensitiveHidden: boolean;
  isRevealed: boolean;
  isEditingTags: boolean;
  tagInput: string;
  /** Tags used elsewhere in history; shown as quick-pick when editing tags */
  tagSuggestions?: string[];
  theme: string;
  language: Locale;
  t: (key: string) => string;
  tagColors?: Record<string, string>;
  richTextSnapshotPreview?: boolean;
  showSourceAppIcon?: boolean;
  sensitiveMaskPrefixVisible?: number;
  sensitiveMaskSuffixVisible?: number;
  sensitiveMaskEmailDomain?: boolean;
  quickPasteHint?: QuickPasteHint;

  onSelect: () => void;
  onCopy: (withFormat?: boolean) => void;
  onToggleReveal: (e: MouseEvent) => void;
  onOpen: (e: MouseEvent) => void;
  onTogglePin: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
  onToggleTagEditor: (e: MouseEvent) => void;
  onTagInput: (val: string) => void;
  onTagAdd: () => void;
  /** Pick an existing tag from the suggestion list (typically closes editor after add) */
  onTagPick?: (tag: string) => void;
  /** Close tag editor without adding (e.g. Escape) */
  onTagEditCancel?: () => void;
  onTagDelete: (tag: string) => void;
  /** User-defined display title for this entry (resolved from the title map). */
  displayTitle?: string;
  /** Open the Quicker-style properties panel for this entry. */
  onShowProperties?: () => void;
  /** Add this entry to the favorites ("加入收藏"). Hidden when absent. */
  onFavorite?: (e: MouseEvent) => void;
  /** 网页版 AI：右键菜单"问 AI"开关与提示词列表 */
  webAiEnabled?: boolean;
  webAiPrompts?: WebAiPrompt[];
  /** 用户从二级列表点选提示词后触发（content 即本条目内容）。 */
  onWebAiAsk?: (prompt: WebAiPrompt) => void;
  dragControls?: DragControls;
  id?: string;
  disableLayout?: boolean;
}

export type ClipboardRenderItem = (
  item: ClipboardEntry,
  index: number,
  isFirst: boolean
) => ReactNode;

export interface VirtualClipboardListProps {
  items: ClipboardEntry[];
  renderItem: ClipboardRenderItem;
  onLoadMore?: () => void;
  hasMore: boolean;
  isLoading: boolean;
  selectedIndex: number;
  isKeyboardMode: boolean;
  onScroll?: (offset: number) => void;
  compactMode: boolean;
  header?: ReactNode;
}

export interface VirtualClipboardListHandle {
  scrollToItem: (index: number) => void;
  scrollToTop: () => void;
  resetAfterIndex: (index: number) => void;
}
