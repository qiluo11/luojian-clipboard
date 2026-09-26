//! Windows Explorer access-history repository ("最近打开" tab backend,
//! formerly labeled "路径").
//!
//! Lives in its own table (`explorer_history`, Migration 13) and is
//! deliberately independent from `clipboard_history`: history cleanup,
//! delete-after-paste, cloud sync etc. never touch it, and path collection
//! never writes into the clipboard pipeline.
//!
//! Case-insensitive uniqueness (Windows paths) is handled by
//! `path TEXT UNIQUE COLLATE NOCASE` — mirroring tuna's OrdinalIgnoreCase.

use crate::domain::models::ExplorerHistoryEntry;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Max non-pinned rows kept (mirrors tuna's cap; older entries are pruned).
pub const MAX_UNPINNED_ENTRIES: i64 = 300;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Normalize a Windows path for storage: forward slashes → backslashes,
/// trim trailing separators (but keep "C:\" roots), uppercase the drive letter.
/// Case *equality* is handled by the NOCASE unique index; this only keeps the
/// displayed form consistent.
pub fn normalize_path(raw: &str) -> String {
    let mut p = raw.trim().replace('/', "\\");
    // Trim trailing backslashes, but never below a drive root ("C:\").
    while p.len() > 3 && p.ends_with('\\') {
        p.pop();
    }
    let bytes = p.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let mut b = p.clone().into_bytes();
        b[0] = b[0].to_ascii_uppercase();
        p = String::from_utf8(b).unwrap_or(p);
    }
    p
}

/// File name (last segment) of a normalized path.
pub fn path_name(p: &str) -> String {
    p.rsplit(['\\', '/'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(p)
        .to_string()
}

pub trait ExplorerHistoryRepository {
    /// Record a visit: insert, or bump `last_visited` + `visit_count` on the
    /// existing (case-insensitive) row. Prunes unpinned overflow afterwards.
    fn record_visit(&self, path: &str, kind: &str, visited_at: i64) -> Result<(), String>;
    /// Seed a visit only when the path is unknown (first-run Recent import;
    /// never overwrites live-captured rows). Returns true when a row was added.
    fn seed_visit(&self, path: &str, kind: &str, visited_at: i64) -> Result<bool, String>;
    /// `is_pinned DESC, sort_order DESC, last_visited DESC`, capped at `limit`.
    fn list(&self, limit: i64) -> Result<Vec<ExplorerHistoryEntry>, String>;
    /// Drag-reorder ("manual" mode): `ids` = the full new display order
    /// (array front = top). Writes `sort_order = len - index` DESC, matching
    /// `list()` above (pinned-first stays enforced by `is_pinned DESC`).
    fn reorder(&self, ids: &[i64]) -> Result<(), String>;
    fn toggle_pin(&self, id: i64) -> Result<(), String>;
    fn delete(&self, id: i64) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

pub struct SqliteExplorerRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteExplorerRepository {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        f(&conn)
    }
}

fn upsert_sql() -> &'static str {
    // `ON CONFLICT(path)` matches through the UNIQUE COLLATE NOCASE index,
    // so "C:\Foo" and "c:\foo" land on the same row. A NEW row takes
    // MAX(sort_order)+1 (leads in manual mode); a repeat visit deliberately
    // leaves sort_order untouched — manual order is only churned by drags.
    "INSERT INTO explorer_history (path, name, kind, last_visited, visit_count, is_pinned, sort_order)
     VALUES (?1, ?2, ?3, ?4, 1, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM explorer_history))
     ON CONFLICT(path) DO UPDATE SET
         last_visited = excluded.last_visited,
         visit_count  = explorer_history.visit_count + 1"
}

const EXPLORER_COLUMNS: &str =
    "id, path, name, kind, last_visited, visit_count, is_pinned, sort_order";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<ExplorerHistoryEntry> {
    Ok(ExplorerHistoryEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        last_visited: row.get(4)?,
        visit_count: row.get(5)?,
        is_pinned: row.get::<_, i64>(6)? != 0,
        sort_order: row.get(7)?,
    })
}

impl ExplorerHistoryRepository for SqliteExplorerRepository {
    fn record_visit(&self, path: &str, kind: &str, visited_at: i64) -> Result<(), String> {
        let path = normalize_path(path);
        if path.is_empty() || !matches!(kind, "folder" | "file") {
            return Ok(());
        }
        let name = path_name(&path);
        let ts = if visited_at > 0 { visited_at } else { now_ms() };
        self.with_conn(|conn| {
            conn.execute(upsert_sql(), params![path, name, kind, ts])
                .map_err(|e| e.to_string())?;
            // Keep at most MAX_UNPINNED_ENTRIES non-pinned rows (prune oldest).
            conn.execute(
                "DELETE FROM explorer_history
                 WHERE is_pinned = 0 AND id NOT IN (
                     SELECT id FROM explorer_history
                     WHERE is_pinned = 0
                     ORDER BY last_visited DESC
                     LIMIT ?1
                 )",
                params![MAX_UNPINNED_ENTRIES],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn seed_visit(&self, path: &str, kind: &str, visited_at: i64) -> Result<bool, String> {
        let path = normalize_path(path);
        if path.is_empty() || !matches!(kind, "folder" | "file") {
            return Ok(false);
        }
        let name = path_name(&path);
        let ts = if visited_at > 0 { visited_at } else { now_ms() };
        self.with_conn(|conn| {
            let changed = conn
                .execute(
                    "INSERT OR IGNORE INTO explorer_history (path, name, kind, last_visited, visit_count, is_pinned)
                     VALUES (?1, ?2, ?3, ?4, 1, 0)",
                    params![path, name, kind, ts],
                )
                .map_err(|e| e.to_string())?;
            Ok(changed > 0)
        })
    }

    fn list(&self, limit: i64) -> Result<Vec<ExplorerHistoryEntry>, String> {
        self.with_conn(|conn| {
            let limit = if limit > 0 { limit } else { 300 };
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {} FROM explorer_history
                     ORDER BY is_pinned DESC, sort_order DESC, last_visited DESC
                     LIMIT ?1",
                    EXPLORER_COLUMNS
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![limit], map_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    fn reorder(&self, ids: &[i64]) -> Result<(), String> {
        self.with_conn(|conn| {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let len = ids.len() as i64;
            for (index, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE explorer_history SET sort_order = ?1 WHERE id = ?2",
                    params![len - index as i64, id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn toggle_pin(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE explorer_history SET is_pinned = CASE is_pinned WHEN 0 THEN 1 ELSE 0 END WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn delete(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM explorer_history WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn clear(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM explorer_history", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::repository::migrations::run_migrations;

    fn setup() -> SqliteExplorerRepository {
        // Run the REAL migrations so these tests also validate Migration 13 SQL.
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        SqliteExplorerRepository::new(Arc::new(Mutex::new(conn)))
    }

    #[test]
    fn explorer_migrations_create_tables() {
        let repo = setup();
        assert!(repo.list(300).unwrap().is_empty());
    }

    #[test]
    fn normalize_path_rules() {
        assert_eq!(normalize_path("c:/users/x/docs\\"), "C:\\users\\x\\docs");
        assert_eq!(normalize_path("C:\\"), "C:\\");
        assert_eq!(normalize_path("  \\\\srv\\share  "), "\\\\srv\\share");
        assert_eq!(path_name("C:\\a\\b.txt"), "b.txt");
        assert_eq!(path_name("C:\\"), "C:\\");
    }

    #[test]
    fn record_visit_upserts_case_insensitive() {
        let repo = setup();
        repo.record_visit("C:\\Users\\x\\Proj", "folder", 1000).unwrap();
        repo.record_visit("c:\\users\\x\\proj", "folder", 2000).unwrap();

        let all = repo.list(300).unwrap();
        // Same path modulo case → single row with bumped count/latest visit.
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].visit_count, 2);
        assert_eq!(all[0].last_visited, 2000);
        assert_eq!(all[0].kind, "folder");
    }

    #[test]
    fn seed_visit_does_not_overwrite_existing() {
        let repo = setup();
        repo.record_visit("C:\\Seed", "folder", 5000).unwrap();
        assert!(!repo.seed_visit("c:\\seed\\", "folder", 100).unwrap());
        let all = repo.list(300).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].last_visited, 5000);
        assert_eq!(all[0].visit_count, 1);

        assert!(repo.seed_visit("C:\\Other", "folder", 400).unwrap());
        assert_eq!(repo.list(300).unwrap().len(), 2);
    }

    #[test]
    fn list_orders_pinned_then_recent() {
        let repo = setup();
        repo.record_visit("C:\\a", "folder", 1).unwrap();
        repo.record_visit("C:\\b", "folder", 2).unwrap();
        repo.record_visit("C:\\c", "file", 3).unwrap();
        let all = repo.list(300).unwrap();
        assert_eq!(all[0].path, "C:\\c");
        assert_eq!(all[2].path, "C:\\a");

        repo.toggle_pin(all[2].id).unwrap(); // pin C:\a
        let all = repo.list(300).unwrap();
        assert_eq!(all[0].path, "C:\\a");
        assert!(all[0].is_pinned);
        repo.toggle_pin(all[0].id).unwrap();
        assert!(!repo.list(300).unwrap()[0].is_pinned);
    }

    #[test]
    fn unpinned_overflow_pruned_pinned_kept() {
        let repo = setup();
        for i in 0..(MAX_UNPINNED_ENTRIES + 20) {
            repo.record_visit(&format!("C:\\pools\\{}", i), "folder", i + 1)
                .unwrap();
        }
        let all = repo.list(1000).unwrap();
        assert_eq!(all.len() as i64, MAX_UNPINNED_ENTRIES);
        // Oldest (i = 0..) were pruned; newest kept.
        assert_eq!(all[0].last_visited, MAX_UNPINNED_ENTRIES + 20);

        // Pinned rows survive pruning beyond the cap.
        repo.toggle_pin(all[0].id).unwrap();
        for i in 0..30 {
            repo.record_visit(&format!("C:\\new\\{}", i), "folder", 10_000 + i)
                .unwrap();
        }
        let all = repo.list(1000).unwrap();
        assert!(all[0].is_pinned);
        assert_eq!(
            all.iter().filter(|e| !e.is_pinned).count() as i64,
            MAX_UNPINNED_ENTRIES
        );
    }

    #[test]
    fn delete_and_clear() {
        let repo = setup();
        repo.record_visit("C:\\x", "file", 1).unwrap();
        repo.record_visit("C:\\y", "file", 2).unwrap();
        let all = repo.list(300).unwrap();
        repo.delete(all[0].id).unwrap();
        assert_eq!(repo.list(300).unwrap().len(), 1);
        repo.clear().unwrap();
        assert!(repo.list(300).unwrap().is_empty());
    }

    #[test]
    fn invalid_kind_rejected() {
        let repo = setup();
        repo.record_visit("C:\\x", "drive", 1).unwrap();
        repo.record_visit("", "folder", 1).unwrap();
        assert!(repo.list(300).unwrap().is_empty());
    }

    #[test]
    fn new_visits_take_max_sort_order_and_revisits_keep_slot() {
        let repo = setup();
        repo.record_visit("C:\\a", "folder", 1).unwrap(); // sort_order 1
        repo.record_visit("C:\\b", "folder", 2).unwrap(); // sort_order 2
        // Re-visiting "a" bumps recency/count but NOT its manual slot.
        repo.record_visit("C:\\a", "folder", 99).unwrap();
        let all = repo.list(300).unwrap();
        assert_eq!(all[0].path, "C:\\b"); // sort_order 2 still leads
        assert_eq!(all[0].sort_order, 2);
        assert_eq!(all[1].path, "C:\\a");
        assert_eq!(all[1].sort_order, 1);
        assert_eq!(all[1].last_visited, 99);
        assert_eq!(all[1].visit_count, 2);
    }

    #[test]
    fn explorer_reorder_writes_descending_and_pins_stay_first() {
        let repo = setup();
        repo.record_visit("C:\\a", "folder", 1).unwrap();
        repo.record_visit("C:\\b", "folder", 2).unwrap();
        repo.record_visit("C:\\c", "folder", 3).unwrap();
        let all = repo.list(300).unwrap();
        // Current order (sort DESC): c, b, a. Drag to c, a, b.
        let (c, b, a) = (all[0].id, all[1].id, all[2].id);
        repo.reorder(&[c, a, b]).unwrap();
        let paths: Vec<String> = repo.list(300).unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["C:\\c", "C:\\a", "C:\\b"]);

        // Pinning the last row floats it to the top regardless of sort_order.
        let b_id = repo
            .list(300)
            .unwrap()
            .into_iter()
            .find(|e| e.path == "C:\\b")
            .unwrap()
            .id;
        repo.toggle_pin(b_id).unwrap();
        let all = repo.list(300).unwrap();
        assert!(all[0].is_pinned);
        assert_eq!(all[0].path, "C:\\b");
    }
}
