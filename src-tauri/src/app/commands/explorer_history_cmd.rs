//! Explorer access-history commands ("最近打开" tab, formerly "路径").
//!
//! Local-only by design: like favorites, these deliberately do NOT call
//! and entries never participate in clipboard history
//! cleanup rules.
//!
//! Invoke arg names on the JS side are camelCase (`limit` is plain, ids are
//! `id`).

use crate::database::DbState;
use crate::domain::models::ExplorerHistoryEntry;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::explorer_history_repo::ExplorerHistoryRepository;
use tauri::{AppHandle, Emitter, State};

/// Pinned first, then manual order (`sort_order DESC`), then most-recent
/// visit. `limit` defaults to the storage cap.
#[tauri::command]
pub fn get_explorer_history(
    state: State<'_, DbState>,
    limit: Option<i64>,
) -> AppResult<Vec<ExplorerHistoryEntry>> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    state.explorer_repo.list(limit).map_err(AppError::from)
}

/// Drag-reorder for the "手动" sort mode. `ids` = the full new display order
/// (array front = top); written length-index DESC so it survives restarts and
/// coordinates with `is_pinned DESC, sort_order DESC, last_visited DESC`.
#[tauri::command]
pub fn reorder_explorer_entries(state: State<'_, DbState>, ids: Vec<i64>) -> AppResult<()> {
    state.explorer_repo.reorder(&ids).map_err(AppError::from)
}

#[tauri::command]
pub fn toggle_explorer_pin(state: State<'_, DbState>, id: i64) -> AppResult<()> {
    state.explorer_repo.toggle_pin(id).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_explorer_entry(app_handle: AppHandle, state: State<'_, DbState>, id: i64) -> AppResult<()> {
    state.explorer_repo.delete(id).map_err(AppError::from)?;
    let _ = app_handle.emit(
        crate::services::explorer_history::EXPLORER_HISTORY_CHANGED_EVENT,
        (),
    );
    Ok(())
}

#[tauri::command]
pub fn clear_explorer_history(app_handle: AppHandle, state: State<'_, DbState>) -> AppResult<()> {
    state.explorer_repo.clear().map_err(AppError::from)?;
    let _ = app_handle.emit(
        crate::services::explorer_history::EXPLORER_HISTORY_CHANGED_EVENT,
        (),
    );
    Ok(())
}
