use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::settings_repo::{SettingsRepository, SqliteSettingsRepository};
use rusqlite::Connection;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use tauri::{command, State, Url};

pub const SITE_DELAY_SETTING: &str = "app.web_ai_site_delays_ms";
pub const MAX_WEB_AI_DELAY_MS: u64 = 60_000;

/// Website identity ignores scheme, path, query, fragment and a leading www.
/// Other subdomains and non-default ports remain independent.
pub fn web_ai_site_key(url: &str) -> Option<String> {
    let parsed = Url::parse(url.trim()).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let host = parsed.host_str()?.trim_end_matches('.');
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    Some(match parsed.port() {
        Some(port) => format!("{}:{}", host, port),
        None => host.to_string(),
    })
}

fn valid_site_delays(raw: Option<&str>) -> BTreeMap<String, u64> {
    let entries = raw.and_then(|s| serde_json::from_str::<Map<String, Value>>(s).ok());
    entries.unwrap_or_default().into_iter().filter_map(|(site, value)| {
        let delay = value.as_u64()?;
        if delay > MAX_WEB_AI_DELAY_MS
            || (web_ai_site_key(&format!("https://{site}")).as_deref() != Some(site.as_str())
                && web_ai_site_key(&format!("http://{site}")).as_deref() != Some(site.as_str()))
        {
            return None;
        }
        Some((site, delay))
    }).collect()
}

pub fn resolve_web_ai_delay(url: &str, default_ms: u64, raw: Option<&str>) -> u64 {
    web_ai_site_key(url)
        .and_then(|site| valid_site_delays(raw).get(&site).copied())
        .unwrap_or(default_ms.min(MAX_WEB_AI_DELAY_MS))
}

/// Caller holds the shared DB mutex across read/merge/write, so updating one
/// website cannot erase a simultaneous update to another website.
fn update_site_delay(conn: &Connection, url: &str, delay_ms: Option<u64>) -> AppResult<BTreeMap<String, u64>> {
    let site = web_ai_site_key(url)
        .ok_or_else(|| AppError::Validation("Expected an HTTP(S) website URL without credentials.".into()))?;
    if delay_ms.is_some_and(|ms| ms > MAX_WEB_AI_DELAY_MS) {
        return Err(AppError::Validation("Web AI delay must be between 0 and 60000 ms.".into()));
    }
    let raw = SqliteSettingsRepository::get_raw(conn, SITE_DELAY_SETTING)?;
    // Do not silently destroy a corrupted stored object when editing one site.
    let mut entries = match raw {
        Some(raw) => serde_json::from_str::<Map<String, Value>>(&raw)
            .map_err(|e| AppError::Validation(format!("Invalid Web AI site delays: {e}")))?,
        None => Map::new(),
    };
    match delay_ms {
        Some(ms) => { entries.insert(site, Value::from(ms)); }
        None => { entries.remove(&site); }
    }
    let serialized = Value::Object(entries).to_string();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![SITE_DELAY_SETTING, serialized],
    )?;
    Ok(valid_site_delays(Some(&serialized)))
}

#[command]
pub fn get_web_ai_site_delays(state: State<'_, DbState>) -> AppResult<BTreeMap<String, u64>> {
    let raw = state.settings_repo.get(SITE_DELAY_SETTING)?;
    Ok(valid_site_delays(raw.as_deref()))
}

#[command]
pub fn set_web_ai_site_delay(
    state: State<'_, DbState>,
    url: String,
    delay_ms: Option<u64>,
) -> AppResult<BTreeMap<String, u64>> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    update_site_delay(&conn, &url, delay_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_ai_site_identity_ignores_prompt_path() {
        for url in ["https://www.doubao.com/chat", " http://DOUBAO.COM./?x=1#chat "] {
            assert_eq!(web_ai_site_key(url).as_deref(), Some("doubao.com"));
        }
        assert_eq!(web_ai_site_key("https://chat.deepseek.com/a").as_deref(), Some("chat.deepseek.com"));
        assert_eq!(web_ai_site_key("http://localhost:3000/a").as_deref(), Some("localhost:3000"));
        assert_eq!(web_ai_site_key("https://example.com:443/").as_deref(), Some("example.com"));
        assert_eq!(web_ai_site_key("http://[::1]:3000/").as_deref(), Some("[::1]:3000"));
    }

    #[test]
    fn web_ai_site_identity_rejects_non_web_urls() {
        for url in ["", "doubao.com", "file:///c:/test", "javascript:alert(1)", "https://user:pass@doubao.com"] {
            assert_eq!(web_ai_site_key(url), None, "{url}");
        }
    }

    #[test]
    fn web_ai_site_delay_overrides_default_for_all_prompts() {
        let raw = r#"{"doubao.com":5000,"chat.deepseek.com":1500}"#;
        for url in ["https://www.doubao.com/chat", "https://doubao.com/summary?q=1"] {
            assert_eq!(resolve_web_ai_delay(url, 2000, Some(raw)), 5000);
        }
        assert_eq!(resolve_web_ai_delay("https://chat.deepseek.com/", 2000, Some(raw)), 1500);
        assert_eq!(resolve_web_ai_delay("https://www.kimi.com/", 2000, Some(raw)), 2000);
        assert_eq!(resolve_web_ai_delay("https://other.doubao.com/", 2000, Some(raw)), 2000);
    }

    #[test]
    fn web_ai_site_delay_zero_and_upper_bound_are_valid() {
        for ms in [0, 60_000] {
            let raw = format!(r#"{{"doubao.com":{ms}}}"#);
            assert_eq!(resolve_web_ai_delay("https://doubao.com", 2000, Some(&raw)), ms);
        }
        assert_eq!(resolve_web_ai_delay("https://doubao.com", u64::MAX, None), 60_000);
    }

    #[test]
    fn web_ai_site_delay_invalid_entries_fall_back() {
        for raw in ["", "bad", "[]", "null", r#"{"doubao.com":-1}"#, r#"{"doubao.com":60001}"#,
            r#"{"doubao.com":"5000"}"#, r#"{"doubao.com":1.5}"#, r#"{"doubao.com":null}"#] {
            assert_eq!(resolve_web_ai_delay("https://doubao.com", 2500, Some(raw)), 2500, "{raw}");
        }
    }

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings VALUES ('app.web_ai_prompts', 'keep custom prompts');").unwrap();
        conn
    }

    #[test]
    fn web_ai_site_delay_persists_merges_and_resets() {
        let conn = test_db();
        update_site_delay(&conn, "https://www.doubao.com/", Some(5000)).unwrap();
        update_site_delay(&conn, "https://chat.deepseek.com/", Some(1500)).unwrap();
        let raw = SqliteSettingsRepository::get_raw(&conn, SITE_DELAY_SETTING).unwrap();
        assert_eq!(resolve_web_ai_delay("https://doubao.com/chat", 2000, raw.as_deref()), 5000);
        let next = update_site_delay(&conn, "http://doubao.com/other", None).unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(next["chat.deepseek.com"], 1500);
        let raw = SqliteSettingsRepository::get_raw(&conn, SITE_DELAY_SETTING).unwrap();
        assert_eq!(resolve_web_ai_delay("https://doubao.com", 3000, raw.as_deref()), 3000);
        assert_eq!(SqliteSettingsRepository::get_raw(&conn, "app.web_ai_prompts").unwrap().as_deref(), Some("keep custom prompts"));
    }

    #[test]
    fn web_ai_site_delay_invalid_write_does_not_touch_db() {
        let conn = test_db();
        assert!(update_site_delay(&conn, "https://doubao.com", Some(60_001)).is_err());
        assert!(update_site_delay(&conn, "file:///test", Some(5000)).is_err());
        assert!(SqliteSettingsRepository::get_raw(&conn, SITE_DELAY_SETTING).unwrap().is_none());
    }

    #[test]
    fn web_ai_site_delay_corrupt_json_is_not_overwritten() {
        let conn = test_db();
        conn.execute("INSERT INTO settings VALUES (?1, 'broken-json')", [SITE_DELAY_SETTING]).unwrap();
        assert!(update_site_delay(&conn, "https://doubao.com", Some(5000)).is_err());
        assert_eq!(SqliteSettingsRepository::get_raw(&conn, SITE_DELAY_SETTING).unwrap().as_deref(), Some("broken-json"));
    }
}
