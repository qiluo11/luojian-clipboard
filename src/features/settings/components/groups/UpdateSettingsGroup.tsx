import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { showUpdateDialog, type UpdateInfo } from "../../../update/UpdateDialog";
import LanzouLink from "../../../update/LanzouLink";

export const UPDATE_FREQUENCY_KEY = "update_check_frequency";
export type UpdateFrequency = "daily" | "weekly" | "monthly" | "never";
const FREQUENCIES: UpdateFrequency[] = ["daily", "weekly", "monthly", "never"];

interface UpdateSettingsGroupProps {
  t: (key: string) => string;
  collapsed: boolean;
  onToggle: () => void;
  appSettings: Record<string, string>;
  saveAppSetting: (key: string, val: string) => void;
}

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; version: string }
  | { kind: "found"; version: string }
  | { kind: "error"; message: string };

/** 读不到 latest.json（404 / 被墙 / 还没发布）时插件给出的英文错误，改成友好提示。 */
export const isNoReleaseInfoError = (message: string) =>
  /valid release JSON|status code 404|404 Not Found/i.test(message);

const selectStyle = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border-color)",
  background: "var(--input-bg)",
  color: "var(--text-color)",
  fontSize: "12px"
} as const;

/** 检测更新：频率（默认每周）、手动检查、国内网盘下载入口。一键更新在 UpdateDialog 里。 */
const UpdateSettingsGroup = ({ t, collapsed, onToggle, appSettings, saveAppSetting }: UpdateSettingsGroupProps) => {
  const stored = appSettings[`app.${UPDATE_FREQUENCY_KEY}`] as UpdateFrequency | undefined;
  const frequency: UpdateFrequency = stored && FREQUENCIES.includes(stored) ? stored : "weekly";
  const [version, setVersion] = useState("");
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const checkNow = async () => {
    setState({ kind: "checking" });
    try {
      const info = await invoke<UpdateInfo>("check_for_update");
      if (info.has_update) {
        setState({ kind: "found", version: info.latest_version });
        showUpdateDialog(info);
      } else {
        setState({ kind: "latest", version: info.current_version || version });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const status = (() => {
    switch (state.kind) {
      case "checking":
        return t("update_checking");
      case "latest":
        return t("update_up_to_date").replace("{version}", state.version);
      case "found":
        return t("update_found").replace("{version}", state.version);
      case "error":
        return isNoReleaseInfoError(state.message)
          ? t("update_check_failed_no_info")
          : t("update_check_failed").replace("{e}", state.message);
      default:
        return "";
    }
  })();

  return (
    <div className={`settings-group ${collapsed ? "collapsed" : ""}`} data-group="update">
      <div className="group-header" onClick={onToggle}>
        <h3 style={{ margin: 0 }}>{t("update_check")}</h3>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </div>
      {!collapsed && (
        <div className="group-content">
          <div className="setting-item">
            <div className="item-label-group">
              <span className="item-label">{t("update_current_version")}</span>
            </div>
            <span className="update-current-version" style={{ fontSize: "12px", opacity: 0.8 }}>{version}</span>
          </div>
          <div className="setting-item">
            <div className="item-label-group">
              <span className="item-label">{t("update_frequency")}</span>
            </div>
            <select
              className="update-frequency-select"
              value={frequency}
              onChange={(e) => saveAppSetting(UPDATE_FREQUENCY_KEY, e.target.value)}
              style={selectStyle}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{t(`update_frequency_${f}`)}</option>
              ))}
            </select>
          </div>
          <div className="setting-item">
            <div className="item-label-group" style={{ minWidth: 0 }}>
              <span className="item-label update-check-status" role="status" style={{ whiteSpace: "normal" }}>
                {status || t("update_manual_desc")}
              </span>
            </div>
            <button
              type="button"
              className="btn-icon update-check-btn"
              disabled={state.kind === "checking"}
              style={{ width: "auto", padding: "4px 12px", fontSize: "12px", height: "26px", gap: "6px", flexShrink: 0 }}
              onClick={checkNow}
            >
              <RefreshCw size={13} />
              {t("update_check_now")}
            </button>
          </div>
          <div className="setting-item">
            <div className="item-label-group" style={{ minWidth: 0 }}>
              <span className="item-label">{t("update_lanzou_label")}</span>
            </div>
            <LanzouLink t={t} className="update-settings-lanzou" />
          </div>
          <div className="setting-item column no-border">
            <div className="settings-subpage-note">{t("update_privacy_note")}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateSettingsGroup;
