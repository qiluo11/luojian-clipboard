//! Windows Explorer access-history collection (mechanism ported from
//! linhuoxi/tuna).
//!
//! Two independent channels feed the `explorer_history` table (Migration 13):
//!
//! 1. **Recent-folder watcher** — Windows writes/refreshes a `.lnk` into
//!    `%APPDATA%\Microsoft\Windows\Recent\` every time a file or folder is
//!    opened. We watch that directory with `notify` (ReadDirectoryChangesW
//!    behind the scenes), wait ~100 ms for the shortcut metadata to settle,
//!    then resolve the target through COM (`IPersistFile::Load` +
//!    `IShellLinkW::GetPath`) and record it: folder targets become "folder",
//!    file targets "file" (with .dll/.sys/System32 noise filtered out).
//! 2. **Explorer window poller** — every 2 s we enumerate `IShellWindows`
//!    (CLSCTX_LOCAL_SERVER), `QueryInterface` each entry to `IWebBrowser2`,
//!    read `LocationURL` and keep the set of currently-open `file://` paths;
//!    0→1 transitions are recorded as folder visits.
//!
//! Plus a **first-run import**: all existing `.lnk` targets that are folders
//! are seeded (INSERT OR IGNORE) using the shortcut's last-write time as
//! `last_visited`, newest-first, capped at 300.
//!
//! Threading model: one dedicated OS thread per channel. Each thread calls
//! `CoInitializeEx(COINIT_MULTITHREADED)` once (MTA suffices: `IShellWindows`
//! is a local server; the IShellLinkW usage below is self-contained per call)
//! and keeps its COM objects on that thread. Threads observe the shared
//! `SHUTDOWN` flag and additionally die with the process — this mirrors the
//! existing `clipboard_listener`, which likewise has no join machinery.
//!
//! All DB work goes through `SqliteExplorerRepository` on the shared
//! `Arc<Mutex<Connection>>`. Nothing here touches `clipboard_history` or the
//! clipboard capture pipeline. Recording is gated at runtime on the
//! `app.explorer_history_enabled` setting (default true).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub const EXPLORER_HISTORY_CHANGED_EVENT: &str = "explorer-history-changed";

/// Graceful-stop signal for the collector threads.
static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static LAST_EMIT_MS: AtomicU64 = AtomicU64::new(0);

fn shutdown_requested() -> bool {
    SHUTDOWN.load(Ordering::Relaxed)
}

/// Ask the collector threads to stop (idempotent).
pub fn request_shutdown() {
    SHUTDOWN.store(true, Ordering::Relaxed);
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Throttled UI nudge so an open "路径" tab refreshes itself.
fn emit_changed(app_handle: &AppHandle) {
    const MIN_EMIT_INTERVAL_MS: i64 = 1000;
    let now = now_ms() as u64;
    let last = LAST_EMIT_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < MIN_EMIT_INTERVAL_MS as u64 {
        return;
    }
    LAST_EMIT_MS.store(now, Ordering::Relaxed);
    use tauri::Emitter;
    let _ = app_handle.emit(EXPLORER_HISTORY_CHANGED_EVENT, ());
}

fn recent_folder_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("Microsoft").join("Windows").join("Recent"))
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use crate::infrastructure::repository::explorer_history_repo::{
        ExplorerHistoryRepository, SqliteExplorerRepository,
    };
    use crate::infrastructure::repository::settings_repo::{
        SettingsRepository, SqliteSettingsRepository,
    };
    use std::collections::{HashMap, HashSet};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use notify::Watcher;
    use std::sync::mpsc;
    use std::time::Duration;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Variant::{VARIANT, VT_I4};
    use windows::Win32::UI::Shell::{
        IShellLinkW, IShellWindows, IWebBrowser2, ShellLink, ShellWindows,
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(2000);
    /// Wait after a Recent *.lnk event so Windows has finished writing metadata.
    const LNK_SETTLE: Duration = Duration::from_millis(100);
    /// Cap for the first-run Recent import (mirrors tuna).
    const INITIAL_IMPORT_LIMIT: usize = 300;

    fn is_enabled(settings: &SqliteSettingsRepository) -> bool {
        settings
            .get("app.explorer_history_enabled")
            .ok()
            .flatten()
            .map(|v| v != "false")
            .unwrap_or(true)
    }

    /// Resolve a `.lnk` to its (target path, is_dir). Any failure or a
    /// missing target yields `None` (silent skip, like tuna).
    unsafe fn resolve_lnk(lnk_path: &Path) -> Option<(String, bool)> {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        let wide: Vec<u16> = lnk_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;

        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        if len == 0 {
            return None;
        }
        let target = String::from_utf16_lossy(&buf[..len]);
        let meta = std::fs::metadata(&target).ok()?; // target must still exist
        Some((target, meta.is_dir()))
    }

    /// Map a resolved target to a record kind, applying tuna's noise filters.
    fn classify(target: &str, is_dir: bool) -> Option<&'static str> {
        if target.to_lowercase().contains("system32") {
            return None;
        }
        if is_dir {
            return Some("folder");
        }
        let ext = Path::new(target)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "dll" || ext == "sys" {
            return None;
        }
        Some("file")
    }

    /// `file:///C:/x/y` → `C:\x\y`, `file://srv/share` → `\\srv\share`.
    /// Percent-decoded; trailing separators trimmed; existence checked.
    fn file_url_to_path(url: &str) -> Option<String> {
        let rest = url.strip_prefix("file://")?;
        let (body, is_unc) = if let Some(s) = rest.strip_prefix('/') {
            (s.to_string(), false) // local drive URL
        } else {
            (rest.to_string(), true) // UNC host URL
        };
        let decoded = urlencoding::decode(&body)
            .map(|c| c.into_owned())
            .unwrap_or(body);
        let mut path = decoded.replace('/', "\\");
        while path.len() > 3 && path.ends_with('\\') {
            path.pop();
        }
        if path.is_empty() {
            return None;
        }
        if is_unc {
            path = format!("\\\\{}", path);
        }
        if Path::new(&path).exists() {
            Some(path)
        } else {
            None // stale window pointing at a gone folder → noise
        }
    }

    /// One pass of the IShellWindows enumeration → set of open file:// paths.
    unsafe fn collect_open_folders() -> HashSet<String> {
        let mut set = HashSet::new();
        let Ok(shell_windows) =
            CoCreateInstance::<_, IShellWindows>(&ShellWindows, None, CLSCTX_LOCAL_SERVER)
        else {
            return set;
        };
        let Ok(count) = shell_windows.Count() else {
            return set;
        };
        for i in 0..count {
            let mut index = VARIANT::default();
            unsafe {
                // VARIANT_0 (union) → ManuallyDrop<VARIANT_0_0> { vt, .. }
                // → VARIANT_0_0_0 (union) value field.
                let body = <core::mem::ManuallyDrop<_> as std::ops::DerefMut>::deref_mut(
                    &mut index.Anonymous.Anonymous,
                );
                body.vt = VT_I4;
                body.Anonymous.lVal = i;
            }
            let Ok(dispatch) = shell_windows.Item(&index) else {
                continue;
            };
            let Ok(browser) = dispatch.cast::<IWebBrowser2>() else {
                continue;
            };
            let Ok(bstr) = browser.LocationURL() else {
                continue;
            };
            let url = bstr.to_string();
            if !url.starts_with("file:") {
                continue;
            }
            if let Some(p) = file_url_to_path(&url) {
                set.insert(p);
            }
        }
        set
    }

    /// Scan all existing `.lnk` files once and seed folder entries with the
    /// shortcut's last-write time as `last_visited` (newest first, capped).
    fn initial_import(repo: &SqliteExplorerRepository, recent_dir: &Path) {
        let mut candidates: Vec<(i64, PathBuf)> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(recent_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !is_lnk(&path) {
                    continue;
                }
                let mtime = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                candidates.push((mtime, path));
            }
        }
        candidates.sort_by_key(|(mtime, _)| *mtime);
        let mut seeded = 0usize;
        for (mtime, lnk) in candidates.into_iter().rev() {
            if shutdown_requested() || seeded >= INITIAL_IMPORT_LIMIT {
                break;
            }
            let Some((target, true)) = (unsafe { resolve_lnk(&lnk) }) else {
                continue; // folders only; parse failures silently skipped
            };
            if classify(&target, true).is_none() {
                continue;
            }
            if repo.seed_visit(&target, "folder", mtime).unwrap_or(false) {
                seeded += 1;
            }
        }
        crate::info!(">>> [EXPLORER] Recent import seeded {} folders.", seeded);
    }

    fn is_lnk(path: &Path) -> bool {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("lnk"))
            == Some(true)
    }

    /// Channel 1 thread: Recent-directory watcher (+ first-run import).
    pub fn spawn_recent_watcher(
        app_handle: AppHandle,
        conn: Arc<Mutex<rusqlite::Connection>>,
    ) {
        std::thread::spawn(move || {
            unsafe {
                // MTA per-thread init; RPC_E_CHANGED_MODE (already inited on
                // this thread) is ignored. Never uninitialized: the thread
                // lives until process exit.
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let recent_dir = match recent_folder_path() {
                Some(p) if p.is_dir() => p,
                _ => {
                    crate::error!(">>> [EXPLORER] Recent folder not found; watcher disabled.");
                    return;
                }
            };
            let repo = SqliteExplorerRepository::new(conn.clone());
            let settings = SqliteSettingsRepository::new(conn.clone());

            if is_enabled(&settings) {
                initial_import(&repo, &recent_dir);
            }

            let (tx, rx) = mpsc::channel::<PathBuf>();
            let mut watcher = match notify::recommended_watcher(
                move |res: notify::Result<notify::Event>| {
                    if let Ok(event) = res {
                        match event.kind {
                            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {}
                            _ => return,
                        }
                        for p in event.paths {
                            if is_lnk(&p) {
                                let _ = tx.send(p);
                            }
                        }
                    }
                },
            ) {
                Ok(w) => w,
                Err(e) => {
                    crate::error!(">>> [EXPLORER] Failed to create Recent watcher: {}", e);
                    return;
                }
            };
            if let Err(e) = watcher.watch(&recent_dir, notify::RecursiveMode::NonRecursive) {
                crate::error!(">>> [EXPLORER] Failed to watch Recent dir: {}", e);
                return;
            }
            crate::info!(">>> [EXPLORER] Recent watcher started: {:?}", recent_dir);

            // The Created+Changed burst from a single open must count once:
            // remember the last handled (size, mtime) fingerprint per .lnk.
            let mut seen: HashMap<PathBuf, (u64, i64)> = HashMap::new();
            for lnk in rx.iter() {
                if shutdown_requested() {
                    break;
                }
                std::thread::sleep(LNK_SETTLE);
                if !is_enabled(&settings) {
                    continue;
                }
                let Ok(meta) = std::fs::metadata(&lnk) else {
                    seen.remove(&lnk);
                    continue; // deleted between event and handling
                };
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let fingerprint = (meta.len(), mtime);
                if seen.get(&lnk) == Some(&fingerprint) {
                    continue; // same content already handled
                }
                seen.insert(lnk.clone(), fingerprint);
                if seen.len() > 2048 {
                    seen.clear();
                }

                let Some((target, is_dir)) = (unsafe { resolve_lnk(&lnk) }) else {
                    continue; // parse failure / missing target → silent skip
                };
                let Some(kind) = classify(&target, is_dir) else {
                    continue;
                };
                let _ = repo.record_visit(&target, kind, now_ms());
                emit_changed(&app_handle);
            }
            // `watcher` stays alive for the loop's duration and drops on exit.
        });
    }

    /// Channel 2 thread: IShellWindows poller (2 s interval).
    pub fn spawn_window_poller(
        app_handle: AppHandle,
        conn: Arc<Mutex<rusqlite::Connection>>,
    ) {
        std::thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let repo = SqliteExplorerRepository::new(conn.clone());
            let settings = SqliteSettingsRepository::new(conn.clone());
            let mut open_set: HashSet<String> = HashSet::new();
            let mut baseline_needed = true; // first pass = baseline, not visits

            crate::info!(">>> [EXPLORER] IShellWindows poller started (2s interval).");
            while !shutdown_requested() {
                std::thread::sleep(POLL_INTERVAL);
                if shutdown_requested() {
                    break;
                }
                if !is_enabled(&settings) {
                    // Re-enabling later: re-baseline so long-open windows are
                    // not counted as fresh visits.
                    baseline_needed = true;
                    open_set.clear();
                    continue;
                }
                let current = unsafe { collect_open_folders() };
                if !baseline_needed {
                    for p in current.difference(&open_set) {
                        let _ = repo.record_visit(p, "folder", now_ms());
                        emit_changed(&app_handle);
                    }
                }
                open_set = current;
                baseline_needed = false;
            }
        });
    }
}

/// Start both collection channels. On non-Windows the table and commands
/// still exist (harmless empty data), but no threads are spawned.
pub fn start(app_handle: AppHandle, conn: Arc<Mutex<rusqlite::Connection>>) {
    #[cfg(target_os = "windows")]
    {
        win::spawn_recent_watcher(app_handle.clone(), conn.clone());
        win::spawn_window_poller(app_handle, conn);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app_handle, conn);
    }
}
