//! Favorites ("收藏夹") repository.
//!
//! Favorites live in their own tables (`favorites` / `favorite_folders`,
//! Migration 12) and are deliberately independent from `clipboard_history`:
//! history cleanup rules, delete-after-paste and "clear history" never touch
//! them, and they are NOT part of cloud sync (which only walks clipboard_history
//! + settings).

use crate::domain::models::{FavoriteEntry, FavoriteFolder};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// folder_id sentinel for the implicit "默认" (no folder) group.
pub const DEFAULT_FOLDER_ID: i64 = 0;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub trait FavoriteRepository {
    fn create_folder(&self, name: &str) -> Result<i64, String>;
    fn rename_folder(&self, id: i64, name: &str) -> Result<(), String>;
    fn delete_folder(&self, id: i64, delete_items: bool) -> Result<(), String>;
    fn list_folders(&self) -> Result<Vec<FavoriteFolder>, String>;

    /// Insert a favorite; returns its id. Deduplication by (content_type, content)
    /// is left to the caller (the command layer looks up first).
    fn add(&self, entry: &FavoriteEntry) -> Result<i64, String>;
    fn delete(&self, id: i64) -> Result<(), String>;
    fn rename(&self, id: i64, title: Option<&str>) -> Result<(), String>;
    fn move_to_folder(&self, id: i64, folder_id: i64) -> Result<(), String>;
    fn list(&self) -> Result<Vec<FavoriteEntry>, String>;
    /// Drag-reorder favorites: `ids` carries the new order (array front =
    /// displayed first). Writes `sort_order = len - index` so earlier entries
    /// get LARGER values, matching `list()`'s `ORDER BY sort_order DESC, id DESC`.
    fn reorder(&self, ids: &[i64]) -> Result<(), String>;
    /// Drag-reorder folder tabs. Folders are queried with
    /// `ORDER BY sort_order, id` (ASCENDING, opposite of favorites), so
    /// earlier index = SMALLER `sort_order` here.
    fn reorder_folders(&self, ids: &[i64]) -> Result<(), String>;
    fn find_by_content(&self, content_type: &str, content: &str) -> Result<Option<i64>, String>;
    /// Full (un-truncated) payload used by the paste pipeline.
    fn get_for_paste(&self, id: i64) -> Result<Option<(String, String, Option<String>)>, String>;
    fn increment_use_count(&self, id: i64) -> Result<(), String>;
}

pub struct SqliteFavoriteRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteFavoriteRepository {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        f(&conn)
    }
}

fn map_favorite_row(row: &rusqlite::Row) -> rusqlite::Result<FavoriteEntry> {
    Ok(FavoriteEntry {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        content_type: row.get(4)?,
        html_content: row.get(5)?,
        source_app: row.get(6)?,
        preview: row.get(7)?,
        created_at: row.get(8)?,
        use_count: row.get(9)?,
        sort_order: row.get(10)?,
    })
}

const FAVORITE_COLUMNS: &str = "id, folder_id, title, content, content_type, html_content, \
     source_app, preview, created_at, use_count, sort_order";

impl FavoriteRepository for SqliteFavoriteRepository {
    fn create_folder(&self, name: &str) -> Result<i64, String> {
        self.with_conn(|conn| {
            let max_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), 0) FROM favorite_folders",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO favorite_folders (name, sort_order, created_at) VALUES (?1, ?2, ?3)",
                params![name.trim(), max_order + 1, now_ms()],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        })
    }

    fn rename_folder(&self, id: i64, name: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE favorite_folders SET name = ?1 WHERE id = ?2",
                params![name.trim(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn delete_folder(&self, id: i64, delete_items: bool) -> Result<(), String> {
        if id == DEFAULT_FOLDER_ID {
            return Err("Cannot delete the default folder".to_string());
        }
        self.with_conn(|conn| {
            if delete_items {
                conn.execute("DELETE FROM favorites WHERE folder_id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "UPDATE favorites SET folder_id = ?1 WHERE folder_id = ?2",
                    params![DEFAULT_FOLDER_ID, id],
                )
                .map_err(|e| e.to_string())?;
            }
            conn.execute(
                "DELETE FROM favorite_folders WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn list_folders(&self) -> Result<Vec<FavoriteFolder>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT id, name, sort_order, created_at FROM favorite_folders ORDER BY sort_order, id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(FavoriteFolder {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        sort_order: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    fn add(&self, entry: &FavoriteEntry) -> Result<i64, String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO favorites (folder_id, title, content, content_type, html_content, source_app, preview, created_at, use_count, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    entry.folder_id,
                    entry.title,
                    entry.content,
                    entry.content_type,
                    entry.html_content,
                    entry.source_app,
                    entry.preview,
                    entry.created_at,
                    entry.use_count,
                    entry.sort_order,
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        })
    }

    fn delete(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn rename(&self, id: i64, title: Option<&str>) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE favorites SET title = ?1 WHERE id = ?2",
                params![title, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn move_to_folder(&self, id: i64, folder_id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE favorites SET folder_id = ?1 WHERE id = ?2",
                params![folder_id, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn list(&self) -> Result<Vec<FavoriteEntry>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {} FROM favorites ORDER BY sort_order DESC, id DESC",
                    FAVORITE_COLUMNS
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], map_favorite_row).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    fn reorder(&self, ids: &[i64]) -> Result<(), String> {
        self.with_conn(|conn| {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let len = ids.len() as i64;
            for (index, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE favorites SET sort_order = ?1 WHERE id = ?2",
                    params![len - index as i64, id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn reorder_folders(&self, ids: &[i64]) -> Result<(), String> {
        self.with_conn(|conn| {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for (index, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE favorite_folders SET sort_order = ?1 WHERE id = ?2",
                    params![index as i64, id],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn find_by_content(&self, content_type: &str, content: &str) -> Result<Option<i64>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT id FROM favorites WHERE content_type = ?1 AND content = ?2 LIMIT 1",
                params![content_type, content],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    fn get_for_paste(&self, id: i64) -> Result<Option<(String, String, Option<String>)>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT content, content_type, html_content FROM favorites WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    fn increment_use_count(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE favorites SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
                params![now_ms(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::repository::migrations::run_migrations;

    fn setup() -> SqliteFavoriteRepository {
        // Run the REAL migrations so these tests also validate the Migration 12 SQL.
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        SqliteFavoriteRepository::new(Arc::new(Mutex::new(conn)))
    }

    fn sample(folder_id: i64, content: &str) -> FavoriteEntry {
        FavoriteEntry {
            id: 0,
            folder_id,
            title: None,
            content: content.to_string(),
            content_type: "text".to_string(),
            html_content: None,
            source_app: Some("TestApp".to_string()),
            preview: content.to_string(),
            created_at: now_ms(),
            use_count: 0,
            sort_order: 0,
        }
    }

    #[test]
    fn favorites_migrations_create_tables() {
        let repo = setup();
        assert!(repo.list().unwrap().is_empty());
        assert!(repo.list_folders().unwrap().is_empty());
    }

    #[test]
    fn favorite_crud_and_folder_moves() {
        let repo = setup();
        let id1 = repo.add(&sample(DEFAULT_FOLDER_ID, "alpha")).unwrap();
        let id2 = repo.add(&sample(DEFAULT_FOLDER_ID, "beta")).unwrap();
        assert!(id1 > 0 && id2 > 0);

        let folder = repo.create_folder("工作").unwrap();
        assert!(folder > 0);
        repo.move_to_folder(id1, folder).unwrap();

        let all = repo.list().unwrap();
        assert_eq!(all.len(), 2);
        let moved = all.iter().find(|f| f.id == id1).unwrap();
        assert_eq!(moved.folder_id, folder);

        // Deleting a folder WITHOUT items falls back to the default group.
        repo.delete_folder(folder, false).unwrap();
        let all = repo.list().unwrap();
        assert_eq!(
            all.iter().find(|f| f.id == id1).unwrap().folder_id,
            DEFAULT_FOLDER_ID
        );

        // Deleting a folder WITH items drops them.
        repo.move_to_folder(id2, folder).unwrap();
        repo.delete_folder(folder, true).unwrap();
        let all = repo.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, id1);

        // Rename + delete favorite.
        repo.rename(id1, Some("标题")).unwrap();
        assert_eq!(
            repo.list().unwrap()[0].title.as_deref(),
            Some("标题")
        );
        repo.rename(id1, None).unwrap();
        assert!(repo.list().unwrap()[0].title.is_none());
        repo.delete(id1).unwrap();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn favorite_paste_payload_and_use_count() {
        let repo = setup();
        let mut entry = sample(DEFAULT_FOLDER_ID, "hello");
        entry.content_type = "rich_text".to_string();
        entry.html_content = Some("<b>hello</b>".to_string());
        let id = repo.add(&entry).unwrap();

        let (content, content_type, html) = repo.get_for_paste(id).unwrap().unwrap();
        assert_eq!(content, "hello");
        assert_eq!(content_type, "rich_text");
        assert_eq!(html.as_deref(), Some("<b>hello</b>"));
        assert!(repo.get_for_paste(999999).unwrap().is_none());

        repo.increment_use_count(id).unwrap();
        repo.increment_use_count(id).unwrap();
        assert_eq!(repo.list().unwrap()[0].use_count, 2);

        assert_eq!(repo.find_by_content("rich_text", "hello").unwrap(), Some(id));
        assert_eq!(repo.find_by_content("text", "hello").unwrap(), None);
    }

    #[test]
    fn default_folder_cannot_be_deleted() {
        let repo = setup();
        assert!(repo.delete_folder(DEFAULT_FOLDER_ID, true).is_err());
    }

    #[test]
    fn reorder_favorites_matches_descending_query_order() {
        let repo = setup();
        let id1 = repo.add(&sample(DEFAULT_FOLDER_ID, "one")).unwrap();
        let id2 = repo.add(&sample(DEFAULT_FOLDER_ID, "two")).unwrap();
        let id3 = repo.add(&sample(DEFAULT_FOLDER_ID, "three")).unwrap();
        let _ = (id2, id3);

        // New display order: three, one, two → length-index DESC (3,2,1).
        let ids = vec![id3, id1, id2];
        repo.reorder(&ids).unwrap();
        let all = repo.list().unwrap();
        let got: Vec<i64> = all.iter().map(|f| f.id).collect();
        assert_eq!(got, ids);
        assert_eq!(all[0].sort_order, 3);
        assert_eq!(all[2].sort_order, 1);

        // Reordering a subset only rewrites those rows; others keep their value
        // (id3 stays at 3 and therefore floats above the rewritten pair).
        repo.reorder(&[id2, id1]).unwrap();
        let all = repo.list().unwrap();
        assert_eq!(all[0].id, id3); // untouched sort_order 3
        assert_eq!(all[1].id, id2); // rewritten to 2
        assert_eq!(all[2].id, id1); // rewritten to 1
    }

    #[test]
    fn reorder_folders_matches_ascending_query_order() {
        let repo = setup();
        let a = repo.create_folder("A").unwrap();
        let b = repo.create_folder("B").unwrap();
        let c = repo.create_folder("C").unwrap();

        // Folders query is ASCENDING: index 0 must get the smallest value.
        repo.reorder_folders(&[c, a, b]).unwrap();
        let got: Vec<i64> = repo.list_folders().unwrap().iter().map(|f| f.id).collect();
        assert_eq!(got, vec![c, a, b]);
    }
}
