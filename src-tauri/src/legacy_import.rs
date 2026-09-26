//! 从原 TieZ（identifier `com.tiez`）复制导入旧数据。
//!
//! 规则：
//! - 只在新数据目录还没有 `clipboard.db`、且从未导入过时执行一次；
//! - 旧目录只读：数据库用 `VACUUM INTO` 生成一致快照（旧程序正在运行也安全），
//!   附件、表情收藏和自定义背景一律复制，不移动、不删除；
//! - 不复制 `datapath.txt`：如果旧版用了自定义数据目录，就从那个目录读取，
//!   但导入结果放在新程序自己的默认目录，避免两个程序共用同一个数据库。

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const LEGACY_IDENTIFIER: &str = "com.tiez";
const MARKER_FILE: &str = "legacy-import.txt";
const DB_FILE: &str = "clipboard.db";
const COPY_DIRS: [&str; 2] = ["attachments", "emoji_favorites"];

#[derive(Debug, PartialEq)]
pub enum ImportOutcome {
    Skipped(&'static str),
    Imported { from: PathBuf },
}

/// 旧数据目录：与新默认目录同级的 `com.tiez`；若其中的 `datapath.txt`
/// 指向一个含数据库的目录，则以该目录为准。找不到数据库时返回 None。
pub fn legacy_data_dir(new_default_dir: &Path) -> Option<PathBuf> {
    let old_default = new_default_dir.parent()?.join(LEGACY_IDENTIFIER);
    resolve_legacy_dir(&old_default)
}

fn resolve_legacy_dir(old_default: &Path) -> Option<PathBuf> {
    if let Ok(content) = std::fs::read_to_string(old_default.join("datapath.txt")) {
        let custom = content.trim();
        if !custom.is_empty() {
            let custom = PathBuf::from(custom);
            if custom.join(DB_FILE).is_file() {
                return Some(custom);
            }
        }
    }
    if old_default.join(DB_FILE).is_file() {
        Some(old_default.to_path_buf())
    } else {
        None
    }
}

pub fn import_if_needed(new_dir: &Path, old_dir: Option<PathBuf>) -> Result<ImportOutcome, String> {
    if new_dir.join(DB_FILE).exists() {
        return Ok(ImportOutcome::Skipped("database already exists"));
    }
    if new_dir.join(MARKER_FILE).exists() {
        return Ok(ImportOutcome::Skipped("already imported once"));
    }
    let Some(old_dir) = old_dir else {
        return Ok(ImportOutcome::Skipped("no legacy data found"));
    };
    if old_dir == new_dir {
        return Ok(ImportOutcome::Skipped("legacy dir equals new dir"));
    }

    std::fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
    let tmp_db = new_dir.join("clipboard.db.importing");
    let result = import_into(&old_dir, new_dir, &tmp_db);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp_db);
        return Err(e);
    }

    std::fs::rename(&tmp_db, new_dir.join(DB_FILE)).map_err(|e| e.to_string())?;
    let marker = format!(
        "imported from: {}\nimported at: {}\n",
        old_dir.display(),
        chrono::Local::now().to_rfc3339()
    );
    let _ = std::fs::write(new_dir.join(MARKER_FILE), marker);
    Ok(ImportOutcome::Imported { from: old_dir })
}

fn import_into(old_dir: &Path, new_dir: &Path, tmp_db: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(tmp_db);

    // 1. 数据库快照（包含 WAL 中尚未合并的内容）
    {
        let src = Connection::open_with_flags(
            old_dir.join(DB_FILE),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("open legacy db: {e}"))?;
        src.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        src.execute("VACUUM INTO ?1", params![tmp_db.to_string_lossy()])
            .map_err(|e| format!("snapshot legacy db: {e}"))?;
    }

    // 2. 附件与表情收藏：复制整个目录
    for name in COPY_DIRS {
        let from = old_dir.join(name);
        if from.is_dir() {
            crate::app::commands::system_cmd::copy_dir_recursive(&from, &new_dir.join(name))
                .map_err(|e| format!("copy {name}: {e}"))?;
        }
    }

    // 3. 数据库里的绝对路径改指新目录
    crate::app::commands::system_cmd::rewrite_attachment_paths_in_db(tmp_db, old_dir, new_dir)
        .map_err(|e| e.to_string())?;
    crate::app::commands::system_cmd::rewrite_emoji_favorites_in_db(tmp_db, old_dir, new_dir)
        .map_err(|e| e.to_string())?;
    copy_custom_background(tmp_db, old_dir, new_dir)?;
    Ok(())
}

/// 自定义背景图位于旧目录内时复制过来并更新设置；位于其他位置则保持原路径。
fn copy_custom_background(db: &Path, old_dir: &Path, new_dir: &Path) -> Result<(), String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let has_settings: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
            [],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !has_settings {
        return Ok(());
    }
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app.custom_background'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(raw) = value else { return Ok(()) };
    let old_path = PathBuf::from(raw.trim());
    let Ok(relative) = old_path.strip_prefix(old_dir) else {
        return Ok(());
    };
    let new_path = new_dir.join(relative);
    if old_path.is_file() {
        if let Some(parent) = new_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&old_path, &new_path).map_err(|e| format!("copy background: {e}"))?;
    }
    conn.execute(
        "UPDATE settings SET value = ?1 WHERE key = 'app.custom_background'",
        params![new_path.to_string_lossy()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("luojian-import-{name}-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_legacy(old: &Path) {
        std::fs::create_dir_all(old.join("attachments")).unwrap();
        std::fs::create_dir_all(old.join("emoji_favorites")).unwrap();
        std::fs::create_dir_all(old.join("backgrounds")).unwrap();
        std::fs::write(old.join("attachments").join("a.png"), b"png").unwrap();
        std::fs::write(old.join("emoji_favorites").join("e.gif"), b"gif").unwrap();
        std::fs::write(old.join("backgrounds").join("bg.jpg"), b"jpg").unwrap();
        let conn = Connection::open(old.join(DB_FILE)).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE clipboard_history (id INTEGER PRIMARY KEY, content TEXT NOT NULL,
                 html_content TEXT, is_external INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        let attach = old.join("attachments").join("a.png");
        conn.execute(
            "INSERT INTO clipboard_history (content, is_external) VALUES (?1, 1)",
            params![attach.to_string_lossy()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO clipboard_history (content, is_external) VALUES ('plain text', 0)",
            [],
        )
        .unwrap();
        let emoji = serde_json::to_string(&vec![old
            .join("emoji_favorites")
            .join("e.gif")
            .to_string_lossy()
            .to_string()])
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app.emoji_favorites', ?1)",
            params![emoji],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app.custom_background', ?1)",
            params![old.join("backgrounds").join("bg.jpg").to_string_lossy()],
        )
        .unwrap();
        // 连接保持打开也要能导入：这里故意不 checkpoint，数据留在 WAL 里
        std::mem::forget(conn);
    }

    #[test]
    fn copies_legacy_data_and_rewrites_paths_without_touching_old_dir() {
        let root = temp_root("copy");
        let old = root.join(LEGACY_IDENTIFIER);
        let new = root.join("io.github.qiluo11.luojian");
        make_legacy(&old);

        let legacy = legacy_data_dir(&new);
        assert_eq!(legacy.as_deref(), Some(old.as_path()));
        let outcome = import_if_needed(&new, legacy).unwrap();
        assert_eq!(outcome, ImportOutcome::Imported { from: old.clone() });

        assert!(new.join(DB_FILE).is_file());
        assert!(new.join(MARKER_FILE).is_file());
        assert!(!new.join("clipboard.db.importing").exists());
        assert!(new.join("attachments").join("a.png").is_file());
        assert!(new.join("emoji_favorites").join("e.gif").is_file());
        assert!(new.join("backgrounds").join("bg.jpg").is_file());
        // 旧目录保持原样
        assert!(old.join(DB_FILE).is_file());
        assert!(old.join("attachments").join("a.png").is_file());
        assert!(old.join("backgrounds").join("bg.jpg").is_file());

        let conn = Connection::open(new.join(DB_FILE)).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let content: String = conn
            .query_row(
                "SELECT content FROM clipboard_history WHERE is_external = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            PathBuf::from(content),
            new.join("attachments").join("a.png")
        );
        let emoji: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app.emoji_favorites'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(emoji.contains("io.github.qiluo11.luojian"), "{emoji}");
        let bg: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app.custom_background'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(PathBuf::from(bg), new.join("backgrounds").join("bg.jpg"));

        // 第二次启动不再导入
        let again = import_if_needed(&new, legacy_data_dir(&new)).unwrap();
        assert_eq!(again, ImportOutcome::Skipped("database already exists"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn follows_legacy_datapath_redirect_but_imports_into_new_default_dir() {
        let root = temp_root("redirect");
        let old_default = root.join(LEGACY_IDENTIFIER);
        let custom = root.join("custom-data");
        let new = root.join("io.github.qiluo11.luojian");
        make_legacy(&custom);
        std::fs::create_dir_all(&old_default).unwrap();
        std::fs::write(old_default.join("datapath.txt"), custom.to_string_lossy().as_bytes())
            .unwrap();

        let legacy = legacy_data_dir(&new);
        assert_eq!(legacy.as_deref(), Some(custom.as_path()));
        import_if_needed(&new, legacy).unwrap();
        assert!(new.join(DB_FILE).is_file());
        assert!(!new.join("datapath.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_when_no_legacy_data() {
        let root = temp_root("none");
        let new = root.join("io.github.qiluo11.luojian");
        assert_eq!(legacy_data_dir(&new), None);
        assert_eq!(
            import_if_needed(&new, None).unwrap(),
            ImportOutcome::Skipped("no legacy data found")
        );
        assert!(!new.join(DB_FILE).exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
