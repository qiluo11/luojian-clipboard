export type SearchHotkeyAction = "open" | "close" | "focus-inplace";

export interface SearchHotkeyState {
  /** Window was hidden and has just been summoned by the hotkey. */
  wasHidden: boolean;
  /** Favorites / "最近打开" view: its always-visible inline search is the target. */
  inPlace: boolean;
  /** Settings, tag manager, emoji panel or chat is covering the list. */
  overlayOpen: boolean;
  /** Main search bar currently open (showSearchBox). */
  panelOpen: boolean;
}

/**
 * Alt+F (search hotkey) behaviour. It toggles the main search bar whenever the
 * clipboard list is showing; summoning a hidden window or leaving an overlay
 * always opens it, and in-place search views just focus their own input.
 */
export const decideSearchHotkeyAction = ({
  wasHidden,
  inPlace,
  overlayOpen,
  panelOpen
}: SearchHotkeyState): SearchHotkeyAction => {
  if (inPlace && !overlayOpen) return "focus-inplace";
  if (wasHidden || overlayOpen) return inPlace ? "focus-inplace" : "open";
  return panelOpen ? "close" : "open";
};
