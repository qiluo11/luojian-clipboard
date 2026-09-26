import type { RefObject } from "react";
import {
  ChevronLeft,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  Settings as SettingsIcon,
  Smile,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { TagCatalogEntry } from "../../../shared/hooks/useTagCatalog";
import SearchTagStrip from "./SearchTagStrip";
import { CATEGORY_TABS, isPathsTab } from "../../../shared/config/categoryTabs";

interface AppHeaderProps {
  t: (key: string) => string;
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  showTagManager: boolean;
  setShowTagManager: (val: boolean) => void;
  tagManagerEnabled: boolean;
  showEmojiPanel: boolean;
  setShowEmojiPanel: (val: boolean) => void;
  emojiPanelEnabled: boolean;
  chatMode: boolean;
  fileServerEnabled: boolean;
  isWindowPinned: boolean;
  setIsWindowPinned: (val: boolean) => void;
  clearHistory: () => void;
  showSearchBox: boolean;
  setShowSearchBox: (val: boolean) => void;
  search: string;
  setSearch: (val: string) => void;
  setIsComposing: (val: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  setShowTagFilter: (val: boolean) => void;
  /** Full tag list (saved + used) with item counts, most-used first. */
  tagCatalog: TagCatalogEntry[];
  tagColors: Record<string, string>;
  setSearchIsFocused: (val: boolean) => void;
  setEditingTagsId: (val: number | null) => void;
  theme: string;
  colorMode: string;
  settingsTitle: string;
  /** Active category tab id (null = default / show all). */
  typeFilter: string | null;
  setTypeFilter: (val: string | null) => void;
  /** Quicker-style favorites view toggle ("剪贴板 | 收藏"). */
  showFavorites: boolean;
  setShowFavorites: (val: boolean) => void;
  onBack: () => void;
  onToggleChat: () => void;
}

const AppHeader = ({
  t,
  showSettings,
  setShowSettings,
  showTagManager,
  setShowTagManager,
  tagManagerEnabled,
  showEmojiPanel,
  setShowEmojiPanel,
  emojiPanelEnabled,
  chatMode,
  fileServerEnabled,
  isWindowPinned,
  setIsWindowPinned,
  clearHistory,
  showSearchBox,
  setShowSearchBox,
  search,
  setSearch,
  setIsComposing,
  searchInputRef,
  setShowTagFilter,
  tagCatalog,
  tagColors,
  setSearchIsFocused,
  setEditingTagsId,
  theme,
  colorMode,
  settingsTitle,
  typeFilter,
  setTypeFilter,
  showFavorites,
  setShowFavorites,
  onBack,
  onToggleChat
}: AppHeaderProps) => {
  const activeTab = typeFilter ?? "default";
  const handleTabClick = (tabId: string) => {
    // Clicking the active tab returns to "默认"; the default tab itself is a no-op reset.
    setTypeFilter(tabId === activeTab ? null : tabId);
  };
  // Visibility follows showSearchBox only; closing also clears the query /
  // tag filter (App re-opens the panel whenever a non-empty search is set).
  const searchPanelOpen = showSearchBox;
  const activeSearchTag = search.startsWith("tag:") ? search.slice(4) : null;
  const handleTagSelect = (tag: string | null) => {
    setSearch(tag ? `tag:${tag}` : "");
    setEditingTagsId(null);
  };

  return (
  <header className="window-drag-region">
    <div className="header-top">
      <div className="header-leading">
        {(showSettings || showTagManager || showEmojiPanel) && (
          <button className="btn-icon window-no-drag" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="header-drag-region" data-tauri-drag-region>
          <span className="header-title">
            {showEmojiPanel
              ? (t('emoji_panel') || '表情包')
              : showTagManager && tagManagerEnabled
                ? (t('tag_manager') || '标签管理')
                : showSettings
                  ? settingsTitle
                  : t('app_name')}
          </span>
        </div>
      </div>
      <div className="header-actions window-no-drag">
        {/* Pin Button - Always visible but single instance */}
        <button
          className={`btn-icon ${isWindowPinned ? 'active' : ''}`}
          title={t('pin')}
          onClick={() => {
            const newVal = !isWindowPinned;
            setIsWindowPinned(newVal);
            invoke("set_window_pinned", { pinned: newVal }).catch(console.error);
          }}
        >
          {isWindowPinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>

        {!showSettings && !showTagManager && !showEmojiPanel && (
          <>
            {/* Search panel toggle; same state the wheel gesture and the
                Alt+F hotkey drive, so no extra state is introduced. */}
            {!showFavorites && !isPathsTab(typeFilter) && (
              <button
                className={`btn-icon${showSearchBox ? ' active' : ''}`}
                title={t('search')}
                aria-pressed={showSearchBox}
                onClick={() => {
                  if (showSearchBox) {
                    searchInputRef.current?.blur();
                    setSearch("");
                    setShowSearchBox(false);
                    return;
                  }
                  setShowSearchBox(true);
                  invoke("activate_window_focus").catch(console.error);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
              >
                <Search size={16} />
              </button>
            )}
            {!showFavorites && !isPathsTab(typeFilter) && (
              <button className="btn-icon" title={t('clear_history')} onClick={clearHistory}>
                <Trash2 size={16} />
              </button>
            )}
            {tagManagerEnabled && (
              <button className="btn-icon" title={t('tag_manager') || '标签管理'} onClick={() => setShowTagManager(true)}>
                <Tag size={16} />
              </button>
            )}
            {emojiPanelEnabled && (
              <button className="btn-icon" title={t('emoji_panel') || '表情包'} onClick={() => setShowEmojiPanel(true)}>
                <Smile size={16} />
              </button>
            )}
            <button className="btn-icon" title={t('settings')} onClick={() => setShowSettings(true)}>
              <SettingsIcon size={16} />
            </button>
          </>
        )}
        {fileServerEnabled && (
          <button
            className={`btn-icon header-chat-btn ${chatMode && showSettings ? 'active' : ''}`}
            title={t('file_transfer_chat')}
            onClick={onToggleChat}
          >
            <MessageSquare size={16} />
          </button>
        )}
        <button className="btn-icon" title={t('hide')} onClick={async () => {
          invoke("hide_window_cmd").catch(console.error);
        }}>
          <X size={16} />
        </button>
      </div>
    </div>

    {!showSettings && !showTagManager && !showEmojiPanel && (
      <div
        className="category-tabs window-no-drag hide-scrollbar"
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        {/* Quicker-style "剪贴板 | 收藏" view switch (shares the tabs row) */}
        <div className="view-switch">
          <button
            className={`category-tab${!showFavorites ? " active" : ""}`}
            onClick={() => setShowFavorites(false)}
            title={t('view_clipboard')}
          >
            {t('view_clipboard')}
          </button>
          <button
            className={`category-tab${showFavorites ? " active" : ""}`}
            onClick={() => setShowFavorites(true)}
            title={t('view_favorites')}
          >
            {t('view_favorites')}
          </button>
        </div>
        <span className="view-switch-divider" />
        {!showFavorites && CATEGORY_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`category-tab ${isActive ? "active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
              title={t(tab.labelKey)}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
    )}

    {!showSettings && !showTagManager && !showEmojiPanel && !showFavorites && !isPathsTab(typeFilter) && (
      // Always mounted in-flow row (pushes the list, never overlays it).
      // Open/close is a CSS grid-rows transition; `inert` keeps the closed
      // panel out of the tab order. The tag strip is permanent, so focus and
      // blur no longer mount/unmount content (the old flicker source).
      <div
        className={`search-panel${searchPanelOpen ? " open" : ""}`}
        inert={!searchPanelOpen}
        aria-hidden={!searchPanelOpen}
      >
        <div className="search-panel-inner">
          <div className="search-container window-no-drag">
            <div style={{ position: 'relative' }}>
              <Search size={14} className="search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                placeholder={t('search_placeholder')}
                value={search}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(e) => {
                  setIsComposing(false);
                  setSearch((e.target as HTMLInputElement).value);
                }}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                onMouseDown={() => {
                  invoke("activate_window_focus").catch(console.error);
                }}
                onFocus={() => {
                  invoke("activate_window_focus").catch(console.error);
                  setShowTagFilter(true);
                  setSearchIsFocused(true);
                  setEditingTagsId(null);
                }}
                onBlur={() => {
                  setShowTagFilter(false);
                  setSearchIsFocused(false);
                }}
                style={{ color: colorMode === 'dark' ? '#ffffff' : undefined }}
              />
              {search.length > 0 && (
                <button
                  type="button"
                  className="search-clear-btn"
                  title={t('search_clear')}
                  aria-label={t('search_clear')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSearch("");
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <SearchTagStrip
            t={t}
            tags={tagCatalog}
            activeTag={activeSearchTag}
            onSelect={handleTagSelect}
            theme={theme}
            tagColors={tagColors}
          />
        </div>
      </div>
    )}
  </header>
);
};

export default AppHeader;
