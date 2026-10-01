//! 检测更新 + 一键更新。
//!
//! - 用 Tauri 官方更新插件读取 Release 里的 `latest.json`
//!   （`plugins.updater.endpoints`，这次请求会让 GitHub 看到本机 IP）。
//! - 频率由 `app.update_check_frequency` 控制：daily / weekly(默认) / monthly / never；
//!   never 时后台完全不联网，只有用户在设置里手动点“检查更新”才会请求。
//! - 发现新版本后写入 `app.update_pending`，前端在下次打开窗口时弹出应用内对话框。
//! - “不再提示”把该版本写入 `app.update_skipped_version`，更高的版本仍会提示。
//! - “立即更新”（`install_update`）：下载安装包 → 用 tauri.conf.json 里的公钥校验签名
//!   → 安装（Windows passive 模式：小进度窗、无需点击），安装时落笺自动退出，装完重新打开。

use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::settings_repo::SettingsRepository;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

/// 只允许打开本项目的 GitHub 页面。
pub const RELEASE_URL_PREFIX: &str = "https://github.com/qiluo11/luojian-clipboard/";
pub const RELEASES_PAGE: &str = "https://github.com/qiluo11/luojian-clipboard/releases/latest";
/// 国内网盘（蓝奏云文件夹分享，提取密码在界面上显示）。只能用浏览器手动下载，
/// 蓝奏云没有稳定的直链，所以“立即更新”仍然走 GitHub。
pub const LANZOU_URL: &str = "https://wwayd.lanzouu.com/b01gica1pa";
/// 检查更新（只读很小的 latest.json）的超时。
const CHECK_TIMEOUT_SECS: u64 = 30;
/// 下载安装包的超时：reqwest 的 timeout 包含整个下载过程，国内慢速网络要留足时间。
const DOWNLOAD_TIMEOUT_SECS: u64 = 10 * 60;

pub const KEY_FREQUENCY: &str = "app.update_check_frequency";
pub const KEY_LAST_CHECK: &str = "app.update_last_check";
pub const KEY_SKIPPED: &str = "app.update_skipped_version";
pub const KEY_PENDING: &str = "app.update_pending";

pub const EVENT_UPDATE_AVAILABLE: &str = "update-available";
/// 下载进度：`{ downloaded, total }`（字节；total 可能为 null）。
pub const EVENT_UPDATE_PROGRESS: &str = "update-progress";
/// 下载并校验完成，开始安装（随后落笺会被安装程序关闭）。
pub const EVENT_UPDATE_INSTALLING: &str = "update-installing";

const DAY_SECS: u64 = 24 * 60 * 60;
const NOTES_MAX_CHARS: usize = 1200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub release_name: String,
    pub notes: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize)]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// 解析 `v1.2.3` / `1.2.3-beta.1` / `1.2`，返回 (主, 次, 修订, 预发布标记)。
pub fn parse_version(raw: &str) -> Option<(u64, u64, u64, Option<String>)> {
    let s = raw.trim().trim_start_matches(['v', 'V']);
    let s = s.split('+').next().unwrap_or(s);
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) if !p.is_empty() => (c, Some(p.to_string())),
        _ => (s, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = match parts.next() {
        Some(p) => p.parse::<u64>().ok()?,
        None => 0,
    };
    let patch = match parts.next() {
        Some(p) => p.parse::<u64>().ok()?,
        None => 0,
    };
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch, pre))
}

/// `latest` 是否比 `current` 新。无法解析时一律视为“不新”，避免误报。
pub fn is_newer(latest: &str, current: &str) -> bool {
    let (Some(l), Some(c)) = (parse_version(latest), parse_version(current)) else {
        return false;
    };
    let lc = (l.0, l.1, l.2);
    let cc = (c.0, c.1, c.2);
    if lc != cc {
        return lc > cc;
    }
    // 同号：正式版 > 预发布版；两个预发布版按字符串比较。
    match (&l.3, &c.3) {
        (None, Some(_)) => true,
        (Some(_), None) | (None, None) => false,
        (Some(a), Some(b)) => a > b,
    }
}

/// 频率 → 间隔秒数；never / 未知值返回 None（不自动检查）。
pub fn frequency_interval(freq: &str) -> Option<u64> {
    match freq {
        "daily" => Some(DAY_SECS),
        "weekly" | "" => Some(7 * DAY_SECS),
        "monthly" => Some(30 * DAY_SECS),
        _ => None,
    }
}

/// 按频率和上次检查时间判断现在是否该检查。
pub fn is_due(freq: &str, last_check: Option<u64>, now: u64) -> bool {
    let Some(interval) = frequency_interval(freq) else {
        return false;
    };
    match last_check {
        None => true,
        // 时钟被往回调过：也重新检查一次
        Some(last) if last > now => true,
        Some(last) => now - last >= interval,
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// 某个版本的 Release 页面（给“前往下载”用）。
pub fn release_page_url(version: &str) -> String {
    format!(
        "{}releases/tag/v{}",
        RELEASE_URL_PREFIX,
        version.trim().trim_start_matches(['v', 'V'])
    )
}

/// 允许打开的网址：本项目 GitHub 页面或蓝奏云文件夹；其他一律改为 Release 列表页。
pub fn allowed_open_target(url: &str) -> String {
    if url.starts_with(RELEASE_URL_PREFIX) || url == LANZOU_URL {
        url.to_string()
    } else {
        RELEASES_PAGE.to_string()
    }
}

fn updater(app: &AppHandle, timeout_secs: u64) -> AppResult<tauri_plugin_updater::Updater> {
    app.updater_builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| AppError::Internal(format!("updater: {}", e)))
}

/// 读取 `latest.json`；插件自己会比较版本（更新的才返回 Some）。
async fn fetch_latest(app: &AppHandle, current: &str) -> AppResult<UpdateInfo> {
    let update = updater(app, CHECK_TIMEOUT_SECS)?
        .check()
        .await
        .map_err(|e| AppError::Network(format!("{}", e)))?;
    Ok(match update {
        Some(u) => UpdateInfo {
            current_version: current.to_string(),
            has_update: is_newer(&u.version, current),
            latest_version: u.version.trim_start_matches(['v', 'V']).to_string(),
            release_url: release_page_url(&u.version),
            release_name: String::new(),
            notes: truncate_chars(u.body.as_deref().unwrap_or("").trim(), NOTES_MAX_CHARS),
            published_at: u.date.map(|d| d.to_string()).unwrap_or_default(),
        },
        None => UpdateInfo {
            current_version: current.to_string(),
            latest_version: current.to_string(),
            has_update: false,
            release_url: RELEASES_PAGE.to_string(),
            release_name: String::new(),
            notes: String::new(),
            published_at: String::new(),
        },
    })
}

fn setting(db: &DbState, key: &str) -> Option<String> {
    db.settings_repo.get(key).ok().flatten()
}

/// 查询一次；成功后记录检查时间，有新版本（且未被跳过，手动检查除外）时写入待提示。
async fn run_check(app: &AppHandle, manual: bool) -> AppResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let info = fetch_latest(app, &current).await?;
    let db = app.state::<DbState>();
    let _ = db.settings_repo.set(KEY_LAST_CHECK, &now_secs().to_string());
    if info.has_update {
        let skipped = setting(&db, KEY_SKIPPED).unwrap_or_default();
        if manual || skipped != info.latest_version {
            if let Ok(json) = serde_json::to_string(&info) {
                let _ = db.settings_repo.set(KEY_PENDING, &json);
            }
            let _ = app.emit(EVENT_UPDATE_AVAILABLE, &info);
        }
    } else {
        let _ = db.settings_repo.set(KEY_PENDING, "");
    }
    Ok(info)
}

/// 设置页“检查更新”按钮。
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<UpdateInfo> {
    run_check(&app, true).await
}

/// 前端启动 / 打开窗口时读取待提示的新版本（已升级到该版本或被跳过则不返回）。
#[tauri::command]
pub fn get_pending_update(app: AppHandle, db: State<'_, DbState>) -> Option<UpdateInfo> {
    let raw = setting(&db, KEY_PENDING)?;
    if raw.trim().is_empty() {
        return None;
    }
    let info: UpdateInfo = serde_json::from_str(&raw).ok()?;
    let current = app.package_info().version.to_string();
    if !is_newer(&info.latest_version, &current) {
        let _ = db.settings_repo.set(KEY_PENDING, "");
        return None;
    }
    Some(UpdateInfo {
        current_version: current,
        has_update: true,
        ..info
    })
}

/// 关闭提示；`skip = true` 表示“不再提示”这个版本。
#[tauri::command]
pub fn dismiss_update(db: State<'_, DbState>, version: String, skip: bool) -> AppResult<()> {
    if skip && !version.trim().is_empty() {
        db.settings_repo
            .set(KEY_SKIPPED, version.trim())
            .map_err(AppError::from)?;
    }
    db.settings_repo.set(KEY_PENDING, "").map_err(AppError::from)
}

/// “前往下载”：用默认浏览器打开 Release 页面（只允许本项目地址）。
#[tauri::command]
pub fn open_release_page(url: String) -> AppResult<()> {
    crate::app::commands::web_ai_cmd::open_url(&allowed_open_target(&url))
}

/// “立即更新”：重新读取 latest.json → 下载（推送进度）→ 校验签名 → 安装。
/// Windows 上安装步骤会自动退出落笺（安装程序需要替换正在运行的文件），
/// passive 安装完成后由安装程序重新打开落笺。
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let update = updater(&app, DOWNLOAD_TIMEOUT_SECS)?
        .check()
        .await
        .map_err(|e| AppError::Network(format!("{}", e)))?
        .ok_or_else(|| AppError::Internal("no update available".to_string()))?;

    {
        let db = app.state::<DbState>();
        let _ = db.settings_repo.set(KEY_PENDING, "");
    }

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let finish_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(EVENT_UPDATE_PROGRESS, UpdateProgress { downloaded, total });
            },
            move || {
                let _ = finish_app.emit(EVENT_UPDATE_INSTALLING, ());
            },
        )
        .await
        .map_err(|e| AppError::Internal(format!("{}", e)))?;

    // 非 Windows（或安装程序没有接管退出）时手动重启。
    app.restart();
}

/// 后台定时检查：启动 60 秒后第一次判断，之后每小时判断一次是否到期。
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let (freq, last) = {
                let db = app.state::<DbState>();
                (
                    setting(&db, KEY_FREQUENCY).unwrap_or_else(|| "weekly".to_string()),
                    setting(&db, KEY_LAST_CHECK).and_then(|v| v.parse::<u64>().ok()),
                )
            };
            if is_due(&freq, last, now_secs()) {
                if let Err(e) = run_check(&app, false).await {
                    eprintln!("[update-check] failed: {}", e);
                }
            }
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("v0.2.0"), Some((0, 2, 0, None)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0, None)));
        assert_eq!(
            parse_version("1.0.0-beta.1+build5"),
            Some((1, 0, 0, Some("beta.1".to_string())))
        );
        assert_eq!(parse_version("abc"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("0.2.0", "0.2.0-beta"));
        assert!(!is_newer("0.2.0-beta", "0.2.0"));
        assert!(!is_newer("garbage", "0.1.0"));
    }

    #[test]
    fn due_by_frequency() {
        let now = 100 * DAY_SECS;
        assert!(is_due("weekly", None, now));
        assert!(!is_due("never", None, now));
        assert!(!is_due("weekly", Some(now - 6 * DAY_SECS), now));
        assert!(is_due("weekly", Some(now - 7 * DAY_SECS), now));
        assert!(is_due("daily", Some(now - DAY_SECS), now));
        assert!(!is_due("monthly", Some(now - 29 * DAY_SECS), now));
        assert!(is_due("monthly", Some(now - 30 * DAY_SECS), now));
        assert!(is_due("weekly", Some(now + 10), now));
    }

    #[test]
    fn open_target_whitelist() {
        assert_eq!(allowed_open_target(LANZOU_URL), LANZOU_URL);
        let rel = "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.3.0";
        assert_eq!(allowed_open_target(rel), rel);
        assert_eq!(allowed_open_target("https://evil.example.com/"), RELEASES_PAGE);
        assert_eq!(allowed_open_target("https://wwayd.lanzouu.com/other"), RELEASES_PAGE);
        assert_eq!(allowed_open_target("https://github.com/other/repo"), RELEASES_PAGE);
    }

    #[test]
    fn release_page_url_points_at_this_repo() {
        assert_eq!(
            release_page_url("v0.3.0"),
            "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.3.0"
        );
        assert_eq!(
            release_page_url("0.3.0"),
            "https://github.com/qiluo11/luojian-clipboard/releases/tag/v0.3.0"
        );
        assert!(release_page_url("1.0.0").starts_with(RELEASE_URL_PREFIX));
    }

    #[test]
    fn truncates_long_notes() {
        let long = "字".repeat(NOTES_MAX_CHARS + 10);
        let out = truncate_chars(&long, NOTES_MAX_CHARS);
        assert_eq!(out.chars().count(), NOTES_MAX_CHARS + 1);
    }
}
