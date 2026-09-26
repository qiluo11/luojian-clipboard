//! Favorites ("收藏夹") commands — Quicker-style named groups of pinned
//! clipboard content that live outside history and its cleanup rules.
//!
//! Favorites are local-only by design.
//!
//! Invoke arg names on the JS side are camelCase (`historyId`, `folderId`,
//! `deleteItems`, `contentType`, `htmlContent`, `sourceApp`).

use crate::app_state::SessionHistory;
use crate::database::DbState;
use crate::domain::models::{FavoriteEntry, FavoriteFolder, FavoritesPayload};
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::clipboard_repo::ClipboardRepository;
use crate::infrastructure::repository::favorite_repo::{
    FavoriteRepository, DEFAULT_FOLDER_ID,
};
use crate::services::clipboard::{
    build_entry_preview, derive_rich_text_content, truncate_html_for_preview,
};
use tauri::State;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_textish(content_type: &str) -> bool {
    matches!(content_type, "text" | "code" | "url" | "rich_text")
}

/// Add a favorite. The source is either a history entry (`historyId`, negative
/// ids resolve against the in-memory session) or raw clipboard content.
#[tauri::command]
pub fn add_favorite(
    state: State<'_, DbState>,
    session: State<'_, SessionHistory>,
    history_id: Option<i64>,
    content: Option<String>,
    content_type: Option<String>,
    html_content: Option<String>,
    title: Option<String>,
    folder_id: Option<i64>,
    source_app: Option<String>,
) -> AppResult<i64> {
    let (content, content_type, html_content, source_app) = match history_id {
        Some(id) if id > 0 => {
            let (full_content, ctype, html) = state
                .repo
                .get_entry_content_with_html(id)
                .map_err(AppError::from)?
                .ok_or_else(|| AppError::Validation("History entry not found".to_string()))?;
            let source = state
                .repo
                .get_entry_by_id(id)
                .ok()
                .flatten()
                .map(|entry| entry.source_app);
            (full_content, ctype, html, source)
        }
        Some(id) => {
            let session_items = session.inner().0.lock().unwrap();
            let item = session_items
                .iter()
                .find(|i| i.id == id)
                .ok_or_else(|| AppError::Validation("History entry not found".to_string()))?;
            (
                item.content.clone(),
                item.content_type.clone(),
                item.html_content.clone(),
                Some(item.source_app.clone()),
            )
        }
        None => {
            let content = content.ok_or_else(|| {
                AppError::Validation("content or historyId is required".to_string())
            })?;
            let content_type = content_type
                .ok_or_else(|| AppError::Validation("contentType is required".to_string()))?;
            (content, content_type, html_content, source_app)
        }
    };

    if content.trim().is_empty() {
        return Err(AppError::Validation("Content is empty".to_string()));
    }

    // Dedup: re-favoriting identical content just returns the existing favorite.
    if let Some(existing) = state
        .favorite_repo
        .find_by_content(&content_type, &content)
        .map_err(AppError::from)?
    {
        return Ok(existing);
    }

    let preview = build_entry_preview(&content_type, &content, html_content.as_deref());
    let title = title.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let folder_id = folder_id.unwrap_or(DEFAULT_FOLDER_ID);

    let entry = FavoriteEntry {
        id: 0,
        folder_id,
        title,
        content,
        content_type,
        html_content,
        source_app,
        preview,
        created_at: now_ms(),
        use_count: 0,
        sort_order: 0,
    };

    state.favorite_repo.add(&entry).map_err(AppError::from)
}

/// Folders + favorites in one payload (grouping happens on the client).
/// Content/html are truncated for transport like the history list, mirroring
/// `get_clipboard_history`; paste always re-reads full content by id.
#[tauri::command]
pub fn list_favorites(state: State<'_, DbState>) -> AppResult<FavoritesPayload> {
    let folders: Vec<FavoriteFolder> = state.favorite_repo.list_folders().map_err(AppError::from)?;
    let mut favorites = state.favorite_repo.list().map_err(AppError::from)?;

    for item in &mut favorites {
        if item.content_type == "rich_text" {
            let normalized =
                derive_rich_text_content(&item.content, item.html_content.as_deref());
            if !normalized.trim().is_empty() {
                item.content = normalized;
            }
        }

        if is_textish(&item.content_type) && item.content.chars().count() > 2000 {
            item.content = format!(
                "{}... [Truncated for speed]",
                item.content.chars().take(2000).collect::<String>()
            );
        }

        if let Some(ref html) = item.html_content {
            if html.chars().count() > 5000 {
                item.html_content = truncate_html_for_preview(html);
            }
        }

        if is_textish(&item.content_type) {
            item.preview = build_entry_preview(
                &item.content_type,
                &item.content,
                item.html_content.as_deref(),
            );
        }
    }

    Ok(FavoritesPayload { folders, favorites })
}

#[tauri::command]
pub fn remove_favorite(state: State<'_, DbState>, id: i64) -> AppResult<()> {
    state.favorite_repo.delete(id).map_err(AppError::from)
}

/// Set or clear (empty string) the custom title of a favorite.
#[tauri::command]
pub fn rename_favorite(state: State<'_, DbState>, id: i64, title: String) -> AppResult<()> {
    let trimmed = title.trim().to_string();
    let title_opt = if trimmed.is_empty() { None } else { Some(trimmed) };
    state
        .favorite_repo
        .rename(id, title_opt.as_deref())
        .map_err(AppError::from)
}

#[tauri::command]
pub fn move_favorite(state: State<'_, DbState>, id: i64, folder_id: i64) -> AppResult<()> {
    state
        .favorite_repo
        .move_to_folder(id, folder_id)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn create_folder(state: State<'_, DbState>, name: String) -> AppResult<i64> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Folder name is empty".to_string()));
    }
    state.favorite_repo.create_folder(&trimmed).map_err(AppError::from)
}

#[tauri::command]
pub fn rename_folder(state: State<'_, DbState>, id: i64, name: String) -> AppResult<()> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Folder name is empty".to_string()));
    }
    state
        .favorite_repo
        .rename_folder(id, &trimmed)
        .map_err(AppError::from)
}

/// Drag-reorder favorites inside a group. `ids` = the group's new display
/// order (array front = top); the repo writes it length-index DESC so the
/// stored order survives restarts (`ORDER BY sort_order DESC, id DESC`).
#[tauri::command]
pub fn reorder_favorites(state: State<'_, DbState>, ids: Vec<i64>) -> AppResult<()> {
    state.favorite_repo.reorder(&ids).map_err(AppError::from)
}

/// Drag-reorder the folder tabs. `ids` = new tab order (default folder is a
/// client-side sentinel and never participates). Written length-index ASC to
/// match `ORDER BY sort_order, id`.
#[tauri::command]
pub fn reorder_favorite_folders(state: State<'_, DbState>, ids: Vec<i64>) -> AppResult<()> {
    state.favorite_repo.reorder_folders(&ids).map_err(AppError::from)
}

/// Delete a folder. `deleteItems = true` drops its favorites, otherwise they
/// fall back into the default (ungrouped) folder.
#[tauri::command]
pub fn delete_folder(
    state: State<'_, DbState>,
    id: i64,
    delete_items: Option<bool>,
) -> AppResult<()> {
    state
        .favorite_repo
        .delete_folder(id, delete_items.unwrap_or(false))
        .map_err(AppError::from)
}
