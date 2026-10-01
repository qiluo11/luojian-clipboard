import { invoke } from "@tauri-apps/api/core";
import { LANZOU_PASSWORD, LANZOU_URL } from "./mirror";

interface LanzouLinkProps {
  t: (key: string) => string;
  className?: string;
}

/** 蓝奏云下载链接（用浏览器打开文件夹分享页，显示提取密码）。 */
const LanzouLink = ({ t, className = "" }: LanzouLinkProps) => (
  <button
    type="button"
    className={`lanzou-link ${className}`.trim()}
    onClick={() => {
      invoke("open_release_page", { url: LANZOU_URL }).catch(console.error);
    }}
  >
    {t("update_lanzou_link").replace("{pw}", LANZOU_PASSWORD)}
  </button>
);

export default LanzouLink;
