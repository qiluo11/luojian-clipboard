use tauri_plugin_window_state::StateFlags;

/// An explicit background launch takes precedence over the ordinary silent-start
/// preference. Preserve the existing --minimized / --autostart semantics.
pub(crate) fn should_show_main_window(silent_start: bool, args: &[String]) -> bool {
    !silent_start
        && !args
            .iter()
            .any(|arg| matches!(arg.as_str(), "--minimized" | "--autostart"))
}

/// Visibility belongs to setup, never to the last session's window-state cache.
/// On a hidden launch, maximizing a Win32 window can also make it visible, so
/// restore only geometry/decorations. Ordinary visible launches retain max/fullscreen.
pub(crate) fn startup_restore_flags(show_on_startup: bool) -> StateFlags {
    let mut flags = StateFlags::all();
    flags.remove(StateFlags::VISIBLE);
    if !show_on_startup {
        flags.remove(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN);
    }
    flags
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn silent_start_manual_launch_honors_setting() {
        assert!(!should_show_main_window(true, &[]));
        assert!(should_show_main_window(false, &[]));
    }

    #[test]
    fn silent_start_minimized_launch_is_always_hidden() {
        for setting in [false, true] {
            assert!(!should_show_main_window(setting, &args(&["--minimized"])));
        }
    }

    #[test]
    fn silent_start_legacy_autostart_launch_is_always_hidden() {
        for setting in [false, true] {
            assert!(!should_show_main_window(setting, &args(&["--autostart"])));
        }
    }

    #[test]
    fn silent_start_background_flags_can_appear_among_other_args() {
        assert!(!should_show_main_window(
            false,
            &args(&["--other", "--minimized", "--autostart"]),
        ));
    }

    #[test]
    fn silent_start_only_exact_background_flags_are_recognized() {
        assert!(should_show_main_window(
            false,
            &args(&["--other", "--minimized=false", "path/--autostart"]),
        ));
    }

    #[test]
    fn silent_start_saved_visibility_never_overrides_launch_policy() {
        for show in [false, true] {
            assert!(!startup_restore_flags(show).contains(StateFlags::VISIBLE));
        }
    }

    #[test]
    fn silent_start_hidden_restore_cannot_maximize_or_go_fullscreen() {
        let flags = startup_restore_flags(false);
        assert!(!flags.intersects(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN));
    }

    #[test]
    fn silent_start_keeps_geometry_and_normal_launch_window_modes() {
        for show in [false, true] {
            assert!(startup_restore_flags(show)
                .contains(StateFlags::SIZE | StateFlags::POSITION | StateFlags::DECORATIONS));
        }
        assert!(startup_restore_flags(true)
            .contains(StateFlags::MAXIMIZED | StateFlags::FULLSCREEN));
    }

    #[test]
    fn silent_start_main_window_is_created_hidden_before_settings_load() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "main")
            .unwrap();
        assert_eq!(main["visible"], false);
    }

    #[test]
    fn silent_start_entrypoint_defers_main_window_state_restore() {
        // Wiring guard: automatic restore runs before setup has read the setting.
        // This is not a substitute for an actual Windows login acceptance test.
        let entrypoint = include_str!("../main.rs");
        assert!(entrypoint.contains(".skip_initial_state(\"main\")"));
    }
}
