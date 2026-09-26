use rusqlite::{Connection, Result};

use base64::Engine;

pub use crate::infrastructure::encryption::{self, ENCRYPT_PREFIX};

pub use crate::domain::models::ClipboardEntry;
use crate::infrastructure::repository::clipboard_repo::SqliteClipboardRepository;
use crate::infrastructure::repository::explorer_history_repo::SqliteExplorerRepository;
use crate::infrastructure::repository::favorite_repo::SqliteFavoriteRepository;
use crate::infrastructure::repository::settings_repo::SqliteSettingsRepository;
use crate::infrastructure::repository::tag_repo::SqliteTagRepository;
use std::sync::{Arc, Mutex};

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
    pub repo: SqliteClipboardRepository,
    pub settings_repo: SqliteSettingsRepository,
    pub tag_repo: SqliteTagRepository,
    pub favorite_repo: SqliteFavoriteRepository,
    pub explorer_repo: SqliteExplorerRepository,
}

const SENSITIVE_KEYS: &[&str] = &[
    "mqtt_password",
    "mqtt_username",
    "ai_profiles",
    "cloud_sync_api_key",
    "cloud_sync_webdav_password",
];

pub const SENSITIVE_TAGS: &[&str] = &["sensitive", "密码"];

pub fn is_sensitive_key(key: &str) -> bool {
    SENSITIVE_KEYS.iter().any(|k| k.eq_ignore_ascii_case(key))
}

pub fn has_sensitive_tag(tags: &[String]) -> bool {
    tags.iter()
        .any(|t| SENSITIVE_TAGS.iter().any(|s| s.eq_ignore_ascii_case(t)))
}

pub fn is_text_type(content_type: &str) -> bool {
    matches!(content_type, "text" | "code" | "url" | "rich_text")
}

fn normalize_text(content: &str) -> String {
    content.trim().replace("\r\n", "\n")
}

pub fn calc_text_hash(content: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let normalized = normalize_text(content);
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

fn calc_visual_hash(img: &image::DynamicImage) -> i64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    img.as_bytes().hash(&mut hasher);
    hasher.finish() as i64
}

pub fn calc_image_hash_from_bytes(bytes: &[u8]) -> Option<i64> {
    if let Ok(img) = image::load_from_memory(bytes) {
        return Some(calc_visual_hash(&img));
    }

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Some(hasher.finish() as i64)
}

pub fn calc_image_hash_from_rgba(width: u32, height: u32, rgba: &[u8]) -> Option<i64> {
    let buffer = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let img = image::DynamicImage::ImageRgba8(buffer);
    Some(calc_visual_hash(&img))
}

pub fn calc_image_hash(base64_data: &str) -> Option<i64> {
    let trimmed = base64_data.trim();
    let bytes =
        if !trimmed.starts_with("data:") && (trimmed.starts_with('/') || trimmed.contains(":\\")) {
            std::fs::read(trimmed).ok()?
        } else {
            let parts: Vec<&str> = trimmed.splitn(2, ',').collect();
            let payload = if parts.len() == 2 { parts[1] } else { trimmed };
            let payload_clean = payload.replace("\r", "").replace("\n", "");
            if payload_clean.trim().is_empty() {
                return None;
            }

            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(payload_clean.trim())
                .ok()?
        };

    if let Ok(img) = image::load_from_memory(&bytes) {
        let thumb = img.resize_exact(32, 32, image::imageops::FilterType::Nearest);
        return Some(calc_visual_hash(&thumb));
    }

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Some(hasher.finish() as i64)
}

pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;

    // Performance and space pragmas
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA auto_vacuum = FULL;
    ",
    )?;

    // Run migrations
    crate::infrastructure::repository::migrations::run_migrations(&conn)?;

    // Initialize default settings
    seed_defaults(&conn)?;

    // One-shot web AI presets upgrade (idempotent, gated by settings version)
    migrate_web_ai_presets(&conn);

    Ok(conn)
}

// save_entry removed (migrated to repository)

pub fn save_image_to_file(data_url: &str, data_dir: &std::path::Path) -> Option<String> {
    use std::io::Write;
    let parts: Vec<&str> = data_url.splitn(2, ',').collect();
    if parts.len() < 2 {
        return None;
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(parts[1])
        .ok()?;

    let attachments_dir = data_dir.join("attachments");
    if !attachments_dir.exists() {
        let _ = std::fs::create_dir_all(&attachments_dir);
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    decoded.hash(&mut hasher);
    let hash = hasher.finish();

    let file_name = format!("img_{:x}.png", hash);
    let file_path = attachments_dir.join(&file_name);

    if !file_path.exists() {
        let mut file = std::fs::File::create(&file_path).ok()?;
        file.write_all(&decoded).ok()?;
    }

    Some(file_path.to_string_lossy().to_string())
}

// get_history removed (migrated to repository)

// search_history removed (migrated to repository)

// get_important_items removed (migrated to repository)

// delete_entry_db, delete_entry, enforce_storage_limit, clear_history removed (migrated to repository)

pub fn seed_defaults(conn: &Connection) -> Result<()> {
    // New defaults only: never overwrite an existing user preference.
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.pinned_only_in_pinned', 'true')", [],
    )?;
    // App settings
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.theme', 'mica')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.color_mode', 'system')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.show_app_border', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.persistent', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.capture_files', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.capture_rich_text', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.rich_text_snapshot_preview', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.deduplicate', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.silent_start', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.delete_after_paste', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.move_to_top_after_paste', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.privacy_protection', 'true')",
        [],
    );
    let _ = conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('app.privacy_protection_kinds', 'phone,idcard,email,secret')", []);
    let _ = conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('app.privacy_protection_custom_rules', '')", []);
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.cleanup_rules', '')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.app_cleanup_policies', '[]')",
        [],
    );

    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.sequential_mode', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.sequential_hotkey', 'Alt+V')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.rich_paste_hotkey', 'Alt+Shift+V')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.search_hotkey', 'Alt+F')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.quick_paste_modifier', 'disabled')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.sound_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.sound_paste_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.hide_tray_icon', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.hide_dock_icon', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.edge_docking', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.arrow_key_selection', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.window_pinned', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.hotkey', 'Alt+C')",
        [],
    );
    // Windows Explorer access-history collection ("路径" tab), on by default.
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.explorer_history_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.autostart', 'true')",
        [],
    );

    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.custom_background', '')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.surface_opacity', '50')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.notice_v028_shown', 'true')",
        [],
    );

    // Web AI (browser handoff) settings — replaces the API-key AI flow in the UI.
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.web_ai_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.web_ai_paste_delay_ms', '3000')",
        [],
    );
    // 新装默认提示词：翻译/总结/润色，自动发送（2026-09-26 按作者本人配置）。
    // 文案与 v2 升级迁移共用同一组常量。只有这次真正写入了提示词（新库或重置设置）
    // 才同时标记预设版本，否则随后的 migrate_web_ai_presets 会把
    // “说人话/豆宝看活”补回来；已有提示词的老库不受影响，照常走升级。
    let web_ai_prompts_seed = serde_json::to_string(&web_ai_default_prompts()).unwrap_or_else(|_| "[]".to_string());
    let seeded_prompts = conn
        .execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![WEB_AI_PROMPTS_KEY, web_ai_prompts_seed],
        )
        .unwrap_or(0);
    if seeded_prompts > 0 {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![
                WEB_AI_PRESETS_VERSION_KEY,
                WEB_AI_PRESETS_TARGET_VERSION.to_string()
            ],
        );
    }

    // 界面与音效默认（2026-09-26 按作者本人配置）：搜索栏默认隐藏（Alt+F 打开）、
    // 表情包面板开启、音量 70%。
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.show_search_box', 'false')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.emoji_panel_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.sound_volume', '0.7')",
        [],
    );

    // 局域网文件传输：默认关闭，需要时在设置里手动打开
    for (key, value) in [
        ("file_server_enabled", "false"),
        ("file_server_port", "12345"),
        ("file_transfer_auto_close", "false"),
        ("file_transfer_auto_copy", "false"),
    ] {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        );
    }

    // Storage limit settings
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.persistent_limit_enabled', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('app.persistent_limit', '500')",
        [],
    );

    Ok(())
}

// ---- Web AI preset prompts (v2) & one-shot upgrade migration ----
//
// Fresh installs receive the v2 set directly from `seed_defaults`; existing
// installs get upgraded once at startup by `migrate_web_ai_presets`, gated on
// the `app.web_ai_presets_version` setting. All string handling lives in pure
// functions so the logic stays unit-testable.

pub const WEB_AI_PROMPTS_KEY: &str = "app.web_ai_prompts";
pub const WEB_AI_PRESETS_VERSION_KEY: &str = "app.web_ai_presets_version";
/// Upgrade runs whenever the stored version is missing/older than this.
pub const WEB_AI_PRESETS_TARGET_VERSION: i64 = 2;

const WEB_AI_DEEPSEEK_URL: &str = "https://chat.deepseek.com/";
const WEB_AI_KIMI_URL: &str = "https://www.kimi.com/";
const WEB_AI_DOUBAO_URL: &str = "https://www.doubao.com/";

const WEB_AI_TPL_TRANSLATE_V2: &str = "把以下内容翻译成自然流畅的中文或英文（原文是中文就译成英文，反之亦然）。只输出译文，不要任何解释或额外文字：\n{content}";
const WEB_AI_TPL_SUMMARIZE_V2: &str = "阅读以下内容，提炼成 3 条要点。只输出要点列表，不要开头和结尾的客套话：\n{content}";
const WEB_AI_TPL_POLISH_V2: &str = "把以下内容改写得专业、通顺，保留原意，专有名词和代码不要改动。只输出改写后的文本：\n{content}";
const WEB_AI_TPL_PLAIN_V2: &str = "用大白话给我解释下面的内容，100 字以内，别用术语：\n{content}";
const WEB_AI_TPL_DOUBAO_V2: &str = "豆包豆包，帮我瞅瞅这段内容啥意思？用俏皮话给我讲明白：\n{content}";

fn web_ai_preset_entry(id: i64, name: &str, url: &str, template: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": name,
        "url": url,
        "template": template,
        "autoSend": false,
    })
}

/// The full v2 preset set (also used as the fresh-install seed).
pub fn web_ai_presets_v2() -> Vec<serde_json::Value> {
    vec![
        web_ai_preset_entry(1, "翻译", WEB_AI_DEEPSEEK_URL, WEB_AI_TPL_TRANSLATE_V2),
        web_ai_preset_entry(2, "总结", WEB_AI_DEEPSEEK_URL, WEB_AI_TPL_SUMMARIZE_V2),
        web_ai_preset_entry(3, "润色", WEB_AI_DEEPSEEK_URL, WEB_AI_TPL_POLISH_V2),
        web_ai_preset_entry(4, "说人话", WEB_AI_KIMI_URL, WEB_AI_TPL_PLAIN_V2),
        web_ai_preset_entry(5, "豆宝看活", WEB_AI_DOUBAO_URL, WEB_AI_TPL_DOUBAO_V2),
    ]
}

/// Fresh-install seed: 翻译/总结/润色 with auto-send on.
pub fn web_ai_default_prompts() -> Vec<serde_json::Value> {
    web_ai_presets_v2()
        .into_iter()
        .take(3)
        .map(|mut p| {
            if let Some(obj) = p.as_object_mut() {
                obj.insert("autoSend".to_string(), serde_json::Value::Bool(true));
            }
            p
        })
        .collect()
}

/// Presets that must exist after the upgrade but never existed in v1
/// (appended when missing; existing same-name entries are left untouched).
fn web_ai_presets_to_ensure() -> Vec<serde_json::Value> {
    web_ai_presets_v2().into_iter().skip(2).collect()
}

/// v1 seed templates that identify an "untouched default" entry so we can
/// safely replace them. User-edited templates never match exactly.
/// (任务书把旧"总结"文案记作 `总结以下内容：…`，而历史 seed 实为
/// `用三句话总结以下内容：…`，两者都按未改动的旧文案处理。)
fn web_ai_upgraded_template(name: &str, template: &str) -> Option<&'static str> {
    match (name, template) {
        ("翻译", "将以下内容翻译成英文（回复只需给出译文）：\n{content}") => Some(WEB_AI_TPL_TRANSLATE_V2),
        ("总结", "用三句话总结以下内容：\n{content}") => Some(WEB_AI_TPL_SUMMARIZE_V2),
        ("总结", "总结以下内容：\n{content}") => Some(WEB_AI_TPL_SUMMARIZE_V2),
        _ => None,
    }
}

pub fn web_ai_presets_need_upgrade(version: Option<&str>) -> bool {
    match version {
        None => true,
        Some(v) => match v.trim().parse::<i64>() {
            Ok(n) => n < WEB_AI_PRESETS_TARGET_VERSION,
            // 版本号异常：按需要升级处理（升级本身幂等，重写后归位）。
            Err(_) => true,
        },
    }
}

/// Pure upgrade step: rewrite legacy default templates and append missing
/// presets with fresh ids. Idempotent — running it twice changes nothing.
pub fn upgrade_web_ai_prompts(prompts: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut out = prompts;

    for item in out.iter_mut() {
        let Some(obj) = item.as_object_mut() else { continue };
        let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let template = obj.get("template").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(new_template) = web_ai_upgraded_template(name, template) {
            obj.insert(
                "template".to_string(),
                serde_json::Value::String(new_template.to_string()),
            );
        }
    }

    for preset in web_ai_presets_to_ensure() {
        let name = preset.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let exists = out
            .iter()
            .any(|p| p.get("name").and_then(|v| v.as_str()) == Some(name));
        if exists {
            continue;
        }
        let next_id = out
            .iter()
            .filter_map(|p| p.get("id").and_then(|v| v.as_i64()))
            .max()
            .map(|m| m + 1)
            .unwrap_or(1);
        let mut entry = preset;
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("id".to_string(), serde_json::json!(next_id));
        }
        out.push(entry);
    }

    out
}

/// One-shot startup migration for existing databases. Never fails the boot:
/// malformed JSON is skipped silently (version stays low so the next launch
/// retries once the data is valid again).
pub fn migrate_web_ai_presets(conn: &Connection) {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [WEB_AI_PRESETS_VERSION_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if !web_ai_presets_need_upgrade(version.as_deref()) {
        return;
    }

    let write_version = |conn: &Connection| {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![
                WEB_AI_PRESETS_VERSION_KEY,
                WEB_AI_PRESETS_TARGET_VERSION.to_string()
            ],
        );
    };

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [WEB_AI_PROMPTS_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(raw) = raw else {
        // No prompts row at all (seed should have created one); just stamp the version.
        write_version(conn);
        return;
    };

    let upgraded = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Array(list)) => upgrade_web_ai_prompts(list),
        // Parse failure or non-array shape: skip silently, keep version unstamped
        // so a later launch can retry after the data is fixed.
        _ => {
            return;
        }
    };

    if let Ok(json) = serde_json::to_string(&upgraded) {
        let _ = conn.execute(
            "UPDATE settings SET value = ?1 WHERE key = ?2",
            rusqlite::params![json, WEB_AI_PROMPTS_KEY],
        );
    }
    write_version(conn);
}

// Migrated to repositories: toggle_pin, update_pinned_order, get_entry_by_content,
// update_entry_content, insert_entry, get_entry_content, get_entry_content_full,
// get_entry_content_with_html, get_entry_by_id, update_entry_tags, get_all_tags,
// create_tag, rename_tag, delete_tag_globally, get_entries_by_tag, set_tag_color, get_tag_colors

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::repository::clipboard_repo::{
        ClipboardRepository, SqliteClipboardRepository,
    };
    use crate::infrastructure::repository::settings_repo::{
        SettingsRepository, SqliteSettingsRepository,
    };

    // 辅助函数：创建一个内存中的临时测试数据库
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // 调用你的 init_db 逻辑（手动执行部分关键建表语句）
        conn.execute(
            "CREATE TABLE clipboard_history (
                id INTEGER PRIMARY KEY,
                content_type TEXT NOT NULL,
                content TEXT NOT NULL,
                html_content TEXT,
                source_app TEXT NOT NULL,
                source_app_path TEXT,
                timestamp INTEGER NOT NULL,
                preview TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                content_hash INTEGER NOT NULL DEFAULT 0,
                tags TEXT NOT NULL DEFAULT '[]',
                use_count INTEGER NOT NULL DEFAULT 0,
                is_external INTEGER NOT NULL DEFAULT 0,
                pinned_order INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE entry_tags (
                entry_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (entry_id, tag)
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE cloud_sync_tombstones (
                content_type TEXT NOT NULL,
                content_hash INTEGER NOT NULL,
                deleted_at INTEGER NOT NULL,
                PRIMARY KEY (content_type, content_hash)
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE cloud_sync_local_index (
                sync_key TEXT PRIMARY KEY,
                digest TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_save_and_get_history() {
        let conn = setup_test_db();

        let entry = ClipboardEntry {
            id: 0,
            content_type: "text".to_string(),
            content: "Hello Integration Test".to_string(),
            html_content: None,
            source_app: "TestApp".to_string(),
            source_app_path: Some("/Applications/TestApp.app".to_string()),
            timestamp: 123456789,
            preview: "Hello...".to_string(),
            is_pinned: false,
            tags: vec![],
            use_count: 0,
            is_external: false,
            pinned_order: 0,
            file_preview_exists: true,
        };

        let conn_arc = Arc::new(Mutex::new(conn));
        let repo = SqliteClipboardRepository::new(conn_arc);

        // 1. 测试保存
        let id = repo.save(&entry, None).expect("保存失败");
        assert!(id > 0);

        // 2. 测试获取
        let history = repo.get_history(10, 0, None).expect("获取历史失败");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].content, "Hello Integration Test");
        assert_eq!(history[0].source_app, "TestApp");
    }

    #[test]
    fn test_settings_persistence() {
        let conn = setup_test_db();
        let conn_arc = Arc::new(Mutex::new(conn));
        let repo = SqliteSettingsRepository::new(conn_arc);

        // 测试设置保存
        repo.set("test_key", "test_value").unwrap();

        // 测试设置读取
        let val = repo.get("test_key").unwrap();
        assert_eq!(val, Some("test_value".to_string()));
    }

    // ---- Web AI presets v2 升级迁移 ----

    fn prompts_json(entries: &[serde_json::Value]) -> String {
        serde_json::to_string(&serde_json::Value::Array(entries.to_vec())).unwrap()
    }

    fn preset(name: &str, url: &str, template: &str, id: i64) -> serde_json::Value {
        serde_json::json!({ "id": id, "name": name, "url": url, "template": template, "autoSend": false })
    }

    #[test]
    fn web_ai_presets_version_gating() {
        assert!(web_ai_presets_need_upgrade(None));
        assert!(web_ai_presets_need_upgrade(Some("1")));
        assert!(web_ai_presets_need_upgrade(Some(" 0 ")));
        // 异常版本号：按需升级处理（迁移幂等）
        assert!(web_ai_presets_need_upgrade(Some("garbage")));
        assert!(!web_ai_presets_need_upgrade(Some("2")));
        assert!(!web_ai_presets_need_upgrade(Some("3")));
    }

    #[test]
    fn web_ai_upgrade_replaces_legacy_and_appends_missing() {
        let legacy = vec![
            preset(
                "翻译",
                WEB_AI_DEEPSEEK_URL,
                "将以下内容翻译成英文（回复只需给出译文）：\n{content}",
                1,
            ),
            preset(
                "总结",
                WEB_AI_DEEPSEEK_URL,
                "用三句话总结以下内容：\n{content}",
                2,
            ),
            // 用户改过的条目：模板非旧 seed 精确值，不得动
            preset("翻译", "https://custom.example/", "自定义译文规则：\n{content}", 7),
            // 用户自加条目：保留
            preset("新提示词", "https://custom.example/", "帮我看看：{content}", 8),
        ];

        let upgraded = upgrade_web_ai_prompts(legacy);
        assert_eq!(upgraded.len(), 5 + 2); // 原 4 条 + 追加 润色/说人话/豆宝看活

        let by_name = |want: &str| {
            upgraded
                .iter()
                .find(|p| p.get("name").and_then(|v| v.as_str()) == Some(want))
                .unwrap()
                .clone()
        };
        assert_eq!(
            by_name("翻译")["template"].as_str().unwrap(),
            WEB_AI_TPL_TRANSLATE_V2
        );
        assert_eq!(
            by_name("总结")["template"].as_str().unwrap(),
            WEB_AI_TPL_SUMMARIZE_V2
        );
        // 用户自定义 url/模板的"翻译"条目不受影响（精确匹配替换）
        assert_eq!(
            upgraded[2]["template"].as_str().unwrap(),
            "自定义译文规则：\n{content}"
        );
        assert_eq!(upgraded[2]["url"].as_str().unwrap(), "https://custom.example/");

        let polish = by_name("润色");
        assert_eq!(polish["url"].as_str().unwrap(), WEB_AI_DEEPSEEK_URL);
        assert_eq!(polish["template"].as_str().unwrap(), WEB_AI_TPL_POLISH_V2);
        assert_eq!(polish["autoSend"].as_bool().unwrap(), false);
        let plain = by_name("说人话");
        assert_eq!(plain["url"].as_str().unwrap(), WEB_AI_KIMI_URL);
        let doubao = by_name("豆宝看活");
        assert_eq!(doubao["url"].as_str().unwrap(), WEB_AI_DOUBAO_URL);

        // 追加条目 id 取最大值顺延且唯一
        let mut ids: Vec<i64> = upgraded
            .iter()
            .map(|p| p.get("id").and_then(|v| v.as_i64()).unwrap())
            .collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), upgraded.len());
        assert!(ids.iter().all(|id| *id > 0));
    }

    #[test]
    fn web_ai_upgrade_is_idempotent() {
        let legacy = vec![
            preset(
                "翻译",
                WEB_AI_DEEPSEEK_URL,
                "将以下内容翻译成英文（回复只需给出译文）：\n{content}",
                1,
            ),
            preset(
                "总结",
                WEB_AI_DEEPSEEK_URL,
                "总结以下内容：\n{content}",
                2,
            ),
        ];
        let once = upgrade_web_ai_prompts(legacy);
        let twice = upgrade_web_ai_prompts(once.clone());
        assert_eq!(once, twice);
        // 已是全新预集（seed 产物）时重复执行无变化
        let seeded = web_ai_presets_v2();
        assert_eq!(upgrade_web_ai_prompts(seeded.clone()), seeded);
    }

    #[test]
    fn web_ai_upgrade_keeps_existing_same_name_entries() {
        // 用户已有"润色"（哪怕内容不同）：不重复追加
        let legacy = vec![preset("润色", "https://mine/", "我的润色", 9)];
        let upgraded = upgrade_web_ai_prompts(legacy);
        assert_eq!(upgraded.len(), 3); // 9 保留 + 说人话 + 豆宝看活
        assert_eq!(upgraded[0]["url"].as_str().unwrap(), "https://mine/");
        assert_eq!(
            upgraded.iter().filter(|p| p.get("name").and_then(|v| v.as_str()) == Some("润色")).count(),
            1
        );
    }

    fn setup_settings_table_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn
    }

    fn read_setting(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    #[test]
    fn migrate_web_ai_presets_end_to_end() {
        let conn = setup_settings_table_db();
        // 模拟存量库：旧 seed 两条 + 用户自加一条，版本号缺失
        let old_raw = prompts_json(&[
            preset(
                "翻译",
                WEB_AI_DEEPSEEK_URL,
                "将以下内容翻译成英文（回复只需给出译文）：\n{content}",
                1,
            ),
            preset(
                "总结",
                WEB_AI_DEEPSEEK_URL,
                "用三句话总结以下内容：\n{content}",
                2,
            ),
            preset("我的提示词", "https://x/", "hi {content}", 5),
        ]);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![WEB_AI_PROMPTS_KEY, old_raw],
        )
        .unwrap();

        migrate_web_ai_presets(&conn);

        assert_eq!(
            read_setting(&conn, WEB_AI_PRESETS_VERSION_KEY).as_deref(),
            Some("2")
        );
        let stored: Vec<serde_json::Value> =
            serde_json::from_str(&read_setting(&conn, WEB_AI_PROMPTS_KEY).unwrap()).unwrap();
        // 旧 3 条（2 条升级文案 + 用户自加 1 条）+ 追加 润色/说人话/豆宝看活
        assert_eq!(stored.len(), 6);
        assert_eq!(stored[0]["template"].as_str().unwrap(), WEB_AI_TPL_TRANSLATE_V2);
        assert_eq!(stored[1]["template"].as_str().unwrap(), WEB_AI_TPL_SUMMARIZE_V2);
        assert_eq!(stored[2]["name"].as_str().unwrap(), "我的提示词");
        assert_eq!(stored[2]["id"].as_i64().unwrap(), 5);
        assert_eq!(stored[3]["name"].as_str().unwrap(), "润色");
        assert_eq!(stored[4]["name"].as_str().unwrap(), "说人话");
        assert_eq!(stored[5]["name"].as_str().unwrap(), "豆宝看活");
        assert_eq!(stored[5]["url"].as_str().unwrap(), WEB_AI_DOUBAO_URL);
        assert_eq!(stored[3]["id"].as_i64().unwrap(), 6);
        assert_eq!(stored[4]["id"].as_i64().unwrap(), 7);
        assert_eq!(stored[5]["id"].as_i64().unwrap(), 8);

        // 幂等：第二次启动不再改动
        let snapshot = read_setting(&conn, WEB_AI_PROMPTS_KEY).unwrap();
        migrate_web_ai_presets(&conn);
        assert_eq!(read_setting(&conn, WEB_AI_PROMPTS_KEY).unwrap(), snapshot);
    }

    #[test]
    fn migrate_web_ai_presets_survives_broken_json() {
        let conn = setup_settings_table_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![WEB_AI_PROMPTS_KEY, "{ not json["],
        )
        .unwrap();

        // 不炸、保留原值、不写版本号（下次启动可重试）
        migrate_web_ai_presets(&conn);
        assert_eq!(
            read_setting(&conn, WEB_AI_PROMPTS_KEY).as_deref(),
            Some("{ not json[")
        );
        assert_eq!(read_setting(&conn, WEB_AI_PRESETS_VERSION_KEY), None);
    }

    #[test]
    fn migrate_web_ai_presets_respects_user_disabled_flag() {
        let conn = setup_settings_table_db();
        // 用户把"翻译"的 autoSend 改成 true：迁移只换 template，其它字段原样保留
        let mut entry = preset(
            "翻译",
            WEB_AI_DEEPSEEK_URL,
            "将以下内容翻译成英文（回复只需给出译文）：\n{content}",
            1,
        );
        entry["autoSend"] = serde_json::json!(true);
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![WEB_AI_PROMPTS_KEY, prompts_json(&[entry])],
        )
        .unwrap();

        migrate_web_ai_presets(&conn);
        let stored: Vec<serde_json::Value> =
            serde_json::from_str(&read_setting(&conn, WEB_AI_PROMPTS_KEY).unwrap()).unwrap();
        assert_eq!(stored[0]["template"].as_str().unwrap(), WEB_AI_TPL_TRANSLATE_V2);
        assert_eq!(stored[0]["autoSend"].as_bool().unwrap(), true);
    }
}

#[cfg(test)]
mod preference_default_tests {
    use super::*;
    const KEYS: [&str; 5] = ["app.autostart", "app.sound_enabled", "app.sound_paste_enabled", "app.persistent", "app.pinned_only_in_pinned"];
    #[test]
    fn fresh_defaults_enable_the_requested_preferences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []).unwrap();
        seed_defaults(&conn).unwrap();
        for key in KEYS {
            let value: String = conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).unwrap();
            assert_eq!(value, "true", "{key}");
        }
    }
    fn get(conn: &Connection, key: &str) -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).ok()
    }
    #[test]
    fn fresh_install_keeps_three_auto_send_prompts_after_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []).unwrap();
        seed_defaults(&conn).unwrap();
        migrate_web_ai_presets(&conn);
        let prompts: Vec<serde_json::Value> =
            serde_json::from_str(&get(&conn, WEB_AI_PROMPTS_KEY).unwrap()).unwrap();
        let names: Vec<&str> = prompts.iter().map(|p| p["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["翻译", "总结", "润色"]);
        assert!(prompts.iter().all(|p| p["autoSend"] == serde_json::Value::Bool(true)));
        assert_eq!(get(&conn, WEB_AI_PRESETS_VERSION_KEY).as_deref(), Some("2"));
        for (key, value) in [
            ("app.capture_files", "true"),
            ("app.capture_rich_text", "true"),
            ("app.rich_text_snapshot_preview", "false"),
            ("app.move_to_top_after_paste", "false"),
            ("app.sequential_mode", "true"),
            ("app.web_ai_paste_delay_ms", "3000"),
            ("app.show_search_box", "false"),
            ("app.emoji_panel_enabled", "true"),
            ("app.sound_volume", "0.7"),
            ("file_server_enabled", "false"),
            ("file_server_port", "12345"),
            ("app.hotkey", "Alt+C"),
        ] {
            assert_eq!(get(&conn, key).as_deref(), Some(value), "{key}");
        }
    }
    #[test]
    fn existing_prompts_without_version_still_upgrade() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []).unwrap();
        let legacy = r#"[{"id":1,"name":"翻译","url":"https://chat.deepseek.com/","template":"将以下内容翻译成英文（回复只需给出译文）：\n{content}","autoSend":false}]"#;
        conn.execute("INSERT INTO settings VALUES (?1, ?2)", rusqlite::params![WEB_AI_PROMPTS_KEY, legacy]).unwrap();
        seed_defaults(&conn).unwrap();
        assert_eq!(get(&conn, WEB_AI_PRESETS_VERSION_KEY), None, "seed must not stamp an existing install");
        migrate_web_ai_presets(&conn);
        let prompts: Vec<serde_json::Value> =
            serde_json::from_str(&get(&conn, WEB_AI_PROMPTS_KEY).unwrap()).unwrap();
        assert!(prompts.iter().any(|p| p["name"] == "说人话"));
        assert_eq!(get(&conn, WEB_AI_PRESETS_VERSION_KEY).as_deref(), Some("2"));
    }
    #[test]
    fn seeding_never_overwrites_saved_off_preferences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []).unwrap();
        for key in KEYS { conn.execute("INSERT INTO settings VALUES (?1,'false')", [key]).unwrap(); }
        seed_defaults(&conn).unwrap();
        seed_defaults(&conn).unwrap();
        for key in KEYS {
            let value: String = conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).unwrap();
            assert_eq!(value, "false", "{key}");
        }
    }
}
