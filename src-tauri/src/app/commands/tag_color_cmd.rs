use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::tag_repo::TagRepository;
use crate::services::auto_tag::{MAX_RULES_PER_TAG, MAX_TOTAL_RULES};
use regex::RegexBuilder;
use std::collections::{HashMap, HashSet};
use tauri::State;

#[tauri::command]
pub fn set_tag_color(
    state: State<'_, DbState>,
    name: String,
    color: Option<String>,
) -> AppResult<()> {
    state
        .tag_repo
        .set_color(&name, color)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn get_tag_colors(state: State<'_, DbState>) -> AppResult<HashMap<String, String>> {
    state.tag_repo.get_colors().map_err(AppError::from)
}

/// All tags that have auto-classification rules configured: tag -> regex list.
#[tauri::command]
pub fn get_tag_auto_rules(state: State<'_, DbState>) -> AppResult<HashMap<String, Vec<String>>> {
    state.tag_repo.get_auto_rules().map_err(AppError::from)
}

/// Persist one tag's auto-classification rules (regex pattern list).
/// Validation here mirrors the frontend's inline checks so the DB only ever
/// holds patterns the capture pipeline can compile. Rule hits only TAG new
/// captures; they never trigger masking.
#[tauri::command]
pub fn set_tag_auto_rules(
    state: State<'_, DbState>,
    name: String,
    rules: Vec<String>,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::from("tag name is empty".to_string()));
    }

    // Trim, drop empties, de-duplicate while preserving order.
    let mut seen: HashSet<String> = HashSet::new();
    let cleaned: Vec<String> = rules
        .into_iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty() && seen.insert(r.clone()))
        .collect();

    if cleaned.len() > MAX_RULES_PER_TAG {
        return Err(AppError::from(format!(
            "too many rules for tag '{}': {} (max {})",
            name,
            cleaned.len(),
            MAX_RULES_PER_TAG
        )));
    }

    // Total budget across all tags, excluding this tag's previous rules.
    let mut total: usize = cleaned.len();
    let existing = state.tag_repo.get_auto_rules()?;
    for (tag, list) in &existing {
        if tag != &name {
            total += list.len().min(MAX_RULES_PER_TAG);
        }
    }
    if total > MAX_TOTAL_RULES {
        return Err(AppError::from(format!(
            "too many rules overall: {} (max {})",
            total, MAX_TOTAL_RULES
        )));
    }

    // Every stored pattern must compile (case-insensitive, same as capture).
    for (idx, pattern) in cleaned.iter().enumerate() {
        RegexBuilder::new(pattern)
            .case_insensitive(true)
            .build()
            .map_err(|e| {
                AppError::from(format!("invalid regex on line {}: {} ({})", idx + 1, pattern, e))
            })?;
    }

    let rules_json = if cleaned.is_empty() {
        String::new() // '' = no rules
    } else {
        serde_json::to_string(&cleaned).map_err(|e| AppError::from(e.to_string()))?
    };

    state
        .tag_repo
        .set_auto_rules(&name, &rules_json)
        .map_err(AppError::from)
}
