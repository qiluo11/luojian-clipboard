import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import {
  CATEGORY_TAB_ORDER_KEY,
  HEADER_BUTTON_ORDER_KEY,
  SEARCH_TAG_ORDER_KEY,
  SEARCH_TAG_SORT_KEY,
  type SearchTagSortMode
} from "../../../../shared/lib/uiOrder";

interface UiOrderSettingsGroupProps {
  t: (key: string) => string;
  collapsed: boolean;
  onToggle: () => void;
  appSettings: Record<string, string>;
  saveAppSetting: (key: string, val: string) => void;
}

const selectStyle = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border-color)",
  background: "var(--input-bg)",
  color: "var(--text-color)",
  fontSize: "12px"
} as const;

/** 界面排序：长按拖动的说明、标签排序方式、恢复默认顺序。 */
const UiOrderSettingsGroup = ({ t, collapsed, onToggle, appSettings, saveAppSetting }: UiOrderSettingsGroupProps) => {
  const tagSort: SearchTagSortMode = appSettings[`app.${SEARCH_TAG_SORT_KEY}`] === "custom" ? "custom" : "count";

  return (
    <div className={`settings-group ${collapsed ? "collapsed" : ""}`} data-group="ui_order">
      <div className="group-header" onClick={onToggle}>
        <h3 style={{ margin: 0 }}>{t("ui_order")}</h3>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </div>
      {!collapsed && (
        <div className="group-content">
          <div className="setting-item column">
            <div className="settings-subpage-note">{t("ui_order_hint")}</div>
          </div>
          <div className="setting-item">
            <div className="item-label-group">
              <span className="item-label">{t("search_tag_sort")}</span>
            </div>
            <select
              className="search-tag-sort-select"
              value={tagSort}
              onChange={(e) => saveAppSetting(SEARCH_TAG_SORT_KEY, e.target.value)}
              style={selectStyle}
            >
              <option value="count">{t("search_tag_sort_count")}</option>
              <option value="custom">{t("search_tag_sort_custom")}</option>
            </select>
          </div>
          <div className="setting-item no-border">
            <div className="item-label-group">
              <span className="item-label">{t("ui_order_reset_desc")}</span>
            </div>
            <button
              type="button"
              className="btn-icon ui-order-reset-btn"
              style={{ width: "auto", padding: "4px 12px", fontSize: "12px", height: "26px", gap: "6px" }}
              onClick={() => {
                saveAppSetting(HEADER_BUTTON_ORDER_KEY, "");
                saveAppSetting(CATEGORY_TAB_ORDER_KEY, "");
                saveAppSetting(SEARCH_TAG_ORDER_KEY, "");
                saveAppSetting(SEARCH_TAG_SORT_KEY, "count");
              }}
            >
              <RotateCcw size={13} />
              {t("ui_order_reset")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UiOrderSettingsGroup;
