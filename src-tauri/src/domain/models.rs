use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardEntry {
    pub id: i64,
    pub content_type: String, // 'text', 'image', 'code', 'file', 'video'
    pub content: String,
    #[serde(default)]
    pub html_content: Option<String>,
    pub source_app: String,
    #[serde(default)]
    pub source_app_path: Option<String>,
    pub timestamp: i64,
    pub preview: String,
    pub is_pinned: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub use_count: i32,
    #[serde(default)]
    pub is_external: bool, // New field to track if content is a file path
    #[serde(default)]
    pub pinned_order: i64, // For manual sorting of pinned items
    #[serde(default = "default_true")]
    pub file_preview_exists: bool, // Transient field: does the file exist on disk?
}

fn default_true() -> bool {
    true
}

/// A named favorites folder ("收藏夹"分组). Stored in `favorite_folders`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteFolder {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
}

/// A single favorite entry. Independent copy of clipboard content, never
/// cleaned up by history rules. `folder_id = 0` means the implicit "默认" group.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteEntry {
    pub id: i64,
    pub folder_id: i64,
    /// User-defined title (None = fall back to `preview`).
    #[serde(default)]
    pub title: Option<String>,
    pub content: String,
    pub content_type: String,
    #[serde(default)]
    pub html_content: Option<String>,
    #[serde(default)]
    pub source_app: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub use_count: i32,
    pub sort_order: i64,
}

/// A single Windows Explorer access-history row (`explorer_history`,
/// Migration 13). Independent from `clipboard_history`: never cleaned up by
/// history rules, never cloud-synced.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExplorerHistoryEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    /// "folder" | "file"
    pub kind: String,
    /// ms since epoch of the most recent visit.
    pub last_visited: i64,
    pub visit_count: i64,
    pub is_pinned: bool,
    /// Manual drag order (Migration 15). NEWER collections bump this to
    /// MAX+1 (so new rows lead in "manual" mode); re-visits never touch it.
    /// `reorder_explorer_entries` rewrites it length-index DESC.
    #[serde(default)]
    pub sort_order: i64,
}

/// Combined payload of `list_favorites` (folders + entries, grouped on the client).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoritesPayload {
    pub folders: Vec<FavoriteFolder>,
    pub favorites: Vec<FavoriteEntry>,
}

/// Full-fidelity metadata for the "properties" panel (Quicker-style).
/// Kept separate from `ClipboardEntry` so list payloads stay lean.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardProperties {
    pub id: i64,
    pub content_type: String,
    pub content: String,
    #[serde(default)]
    pub html_content: Option<String>,
    #[serde(default)]
    pub display_title: Option<String>,
    pub source_app: String,
    pub timestamp: i64,
    /// When the entry content was last edited (ms epoch; NULL for legacy rows).
    #[serde(default)]
    pub updated_at: Option<i64>,
    /// When the entry was last pasted/used (ms epoch; NULL for legacy rows).
    #[serde(default)]
    pub last_used_at: Option<i64>,
    pub use_count: i32,
    pub is_pinned: bool,
}
