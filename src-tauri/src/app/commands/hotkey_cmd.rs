use crate::app_state::SettingsState;
use crate::error::{AppError, AppResult};
use crate::global_state::HOTKEY_STRING;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

static HOTKEY_REGISTRATION_LOCK: Mutex<()> = Mutex::new(());
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

fn register_shortcut(app_handle: &AppHandle, hotkey: &str) {
    if hotkey.is_empty()
        || hotkey.eq_ignore_ascii_case("MouseMiddle")
        || hotkey.eq_ignore_ascii_case("MButton")
    {
        return;
    }

    let normalized = hotkey.replace("Win", "Super");
    if let Ok(shortcut) = normalized.parse::<Shortcut>() {
        let _ = app_handle.global_shortcut().register(shortcut);
    }
}

pub(crate) fn sync_registered_hotkeys(app_handle: &AppHandle) -> AppResult<()> {
    let _guard = HOTKEY_REGISTRATION_LOCK.lock()
        .map_err(|_| AppError::Internal("快捷键注册锁不可用".into()))?;
    let _ = app_handle.global_shortcut().unregister_all();

    let Some(settings) = app_handle.try_state::<SettingsState>() else {
        return Ok(());
    };

    let main_hotkey = settings.main_hotkey.lock().unwrap().clone();
    register_shortcut(app_handle, &main_hotkey);

    let sequential_mode = settings.sequential_mode.load(Ordering::Relaxed);
    let sequential_hotkey = settings.sequential_paste_hotkey.lock().unwrap().clone();
    if sequential_mode {
        register_shortcut(app_handle, &sequential_hotkey);
    }

    let rich_hotkey = settings.rich_paste_hotkey.lock().unwrap().clone();
    register_shortcut(app_handle, &rich_hotkey);

    let search_hotkey = settings.search_hotkey.lock().unwrap().clone();
    register_shortcut(app_handle, &search_hotkey);

    Ok(())
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum HotkeyKind { Main, Sequential, Rich, Search }

fn hotkey_slot(settings: &SettingsState, kind: HotkeyKind) -> (&Mutex<String>, &'static str) {
    match kind {
        HotkeyKind::Main => (&settings.main_hotkey, "app.hotkey"),
        HotkeyKind::Sequential => (&settings.sequential_paste_hotkey, "app.sequential_hotkey"),
        HotkeyKind::Rich => (&settings.rich_paste_hotkey, "app.rich_paste_hotkey"),
        HotkeyKind::Search => (&settings.search_hotkey, "app.search_hotkey"),
    }
}

fn parse_binding(value: &str) -> AppResult<Option<Shortcut>> {
    if value.is_empty() || value.eq_ignore_ascii_case("MouseMiddle") || value.eq_ignore_ascii_case("MButton") {
        return Ok(None);
    }
    value.replace("Win", "Super").parse::<Shortcut>().map(Some)
        .map_err(|_| AppError::Validation("快捷键格式无效".into()))
}

// A rejected candidate must never become the saved/displayed binding. The old
// OS registration stays installed while the new candidate and DB write are tried.
fn register_then_persist(
    needs_registration: bool,
    register: impl FnOnce() -> Result<(), String>,
    persist: impl FnOnce() -> Result<(), String>,
    rollback: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if needs_registration { register()?; }
    if let Err(error) = persist() {
        if needs_registration {
            if let Err(cleanup) = rollback() { return Err(format!("{error}; 清理新绑定失败: {cleanup}")); }
        }
        return Err(error);
    }
    Ok(())
}

pub(crate) fn update_configured_hotkey(
    app: &AppHandle, settings: &SettingsState, kind: HotkeyKind, hotkey: String,
) -> AppResult<()> {
    use crate::database::DbState;
    use crate::infrastructure::repository::settings_repo::SettingsRepository;
    let _guard = HOTKEY_REGISTRATION_LOCK.lock()
        .map_err(|_| AppError::Internal("快捷键注册锁不可用".into()))?;
    let (slot, key) = hotkey_slot(settings, kind);
    let previous = slot.lock().map_err(|_| AppError::Internal("快捷键状态不可用".into()))?.clone();
    let candidate = parse_binding(&hotkey)?;
    let old = parse_binding(&previous).ok().flatten();
    let sequential_active = settings.sequential_mode.load(Ordering::Relaxed);
    let active = kind != HotkeyKind::Sequential || sequential_active;
    let mut other_bindings = Vec::new();
    for other in [HotkeyKind::Main, HotkeyKind::Sequential, HotkeyKind::Rich, HotkeyKind::Search] {
        if other == kind || (other == HotkeyKind::Sequential && !sequential_active) { continue; }
        let value = hotkey_slot(settings, other).0.lock()
            .map_err(|_| AppError::Internal("快捷键状态不可用".into()))?.clone();
        if let Some(binding) = parse_binding(&value).ok().flatten() { other_bindings.push(binding); }
    }
    if active && candidate.as_ref().is_some_and(|next| other_bindings.iter().any(|other| other.id() == next.id())) {
        return Err(AppError::Validation("该组合已用于其他落笺快捷键".into()));
    }
    let needs_registration = active && candidate.as_ref()
        .is_some_and(|next| !app.global_shortcut().is_registered(next.clone()));
    let db = app.state::<DbState>();
    register_then_persist(
        needs_registration,
        || app.global_shortcut().register(candidate.clone().expect("candidate required")).map_err(|e| e.to_string()),
        || db.settings_repo.set(key, &hotkey).map_err(|e| e.to_string()),
        || app.global_shortcut().unregister(candidate.clone().expect("candidate required")).map_err(|e| e.to_string()),
    ).map_err(|e| AppError::Validation(format!("快捷键未保存: {e}")))?;
    *slot.lock().unwrap() = hotkey.clone();
    if kind == HotkeyKind::Main { *HOTKEY_STRING.lock().unwrap() = hotkey; }
    if let Some(old) = old {
        let still_used = candidate.as_ref().is_some_and(|next| next.id() == old.id())
            || other_bindings.iter().any(|other| other.id() == old.id());
        if !still_used && app.global_shortcut().is_registered(old.clone()) {
            // The new binding is already committed. Do not falsely report it as
            // unavailable because an obsolete registration failed to clean up.
            if let Err(error) = app.global_shortcut().unregister(old) {
                eprintln!("[Hotkey] obsolete binding cleanup failed: {error}");
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn register_hotkey(app_handle: AppHandle, hotkey: String) -> AppResult<()> {
    let settings = app_handle.state::<SettingsState>();
    update_configured_hotkey(&app_handle, settings.inner(), HotkeyKind::Main, hotkey)
}

#[tauri::command]
pub fn test_hotkey_available(app_handle: AppHandle, hotkey: String) -> AppResult<bool> {
    if hotkey.is_empty()
        || hotkey.eq_ignore_ascii_case("MouseMiddle")
        || hotkey.eq_ignore_ascii_case("MButton")
    {
        return Ok(true);
    }

    let normalized = hotkey.replace("Win", "Super");
    let shortcut = normalized
        .parse::<Shortcut>()
        .map_err(|_| AppError::Validation("快捷键格式无效".to_string()))?;

    // Serialize with resync so a probe never unregisters a newly installed binding.
    let _guard = HOTKEY_REGISTRATION_LOCK.lock()
        .map_err(|_| AppError::Internal("快捷键注册锁不可用".into()))?;
    probe_shortcut(
        app_handle.global_shortcut().is_registered(shortcut.clone()),
        || app_handle.global_shortcut().register(shortcut.clone()).map_err(|e| e.to_string()),
        || app_handle.global_shortcut().unregister(shortcut.clone()).map_err(|e| e.to_string()),
    ).map_err(|_| AppError::Validation("该快捷键被其他程序占用或系统不支持，请换一个组合".into()))
}

fn probe_shortcut(
    owned: bool,
    register: impl FnOnce() -> Result<(), String>,
    unregister: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    if owned { return Ok(true); }
    register()?;
    unregister()?;
    Ok(true)
}

#[cfg(test)]
mod availability_tests {
    use super::probe_shortcut;
    #[test]
    fn owned_hotkey_does_not_register_or_unregister() {
        assert_eq!(probe_shortcut(true, || panic!("already ours"), || panic!("must not remove own binding")), Ok(true));
    }
    #[test]
    fn free_hotkey_is_probed_then_released() {
        let steps = std::cell::RefCell::new(Vec::new());
        assert_eq!(probe_shortcut(false, || { steps.borrow_mut().push("register"); Ok(()) }, || { steps.borrow_mut().push("release"); Ok(()) }), Ok(true));
        assert_eq!(*steps.borrow(), vec!["register", "release"]);
    }
    #[test]
    fn conflict_does_not_unregister_another_binding() {
        assert!(probe_shortcut(false, || Err("busy".into()), || panic!("not owned")).is_err());
    }
    #[test]
    fn cleanup_failure_is_not_reported_as_available() {
        assert!(probe_shortcut(false, || Ok(()), || Err("cleanup failed".into())).is_err());
    }
}

#[cfg(test)]
mod binding_update_tests {
    use super::register_then_persist;
    #[test]
    fn registration_failure_never_saves() {
        assert!(register_then_persist(true, || Err("occupied".into()), || panic!("must not save"), || panic!("not ours")).is_err());
    }
    #[test]
    fn persistence_failure_releases_only_the_candidate() {
        let actions = std::cell::RefCell::new(Vec::new());
        assert!(register_then_persist(true,
            || { actions.borrow_mut().push("register"); Ok(()) },
            || { actions.borrow_mut().push("save"); Err("disk error".into()) },
            || { actions.borrow_mut().push("rollback"); Ok(()) }).is_err());
        assert_eq!(*actions.borrow(), ["register", "save", "rollback"]);
    }
    #[test]
    fn owned_binding_is_not_removed_on_save_failure() {
        assert!(register_then_persist(false, || panic!("already ours"), || Err("disk error".into()), || panic!("keep own binding")).is_err());
    }
    #[test]
    fn committed_binding_is_not_rolled_back() {
        assert!(register_then_persist(true, || Ok(()), || Ok(()), || panic!("committed")).is_ok());
    }
}
