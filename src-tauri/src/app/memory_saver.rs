//! 窗口隐藏时降低 WebView2 内存占用。
//!
//! 落笺大部分时间藏在托盘里，但 WebView2 渲染/GPU 进程会随使用逐渐变大
//! （实测：刚启动 ~150MB，长时间运行后 ~290MB）。这里用一个每秒一次的轻量
//! 轮询观察主窗口可见性：隐藏满 `HIDE_GRACE` 后把
//! `MemoryUsageTargetLevel` 设为 Low，让 WebView2 主动回收内存；窗口一显示
//! 立即恢复 Normal。不需要改动各处 show()/hide() 调用点。
//!
//! 设置环境变量 `LUOJIAN_NO_MEMSAVER=1` 可关闭（用于对比测量）。

#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::Manager;

/// 隐藏多久后才降级，避免快速呼出/隐藏时来回切换。
#[cfg(target_os = "windows")]
const HIDE_GRACE: Duration = Duration::from_secs(5);
#[cfg(target_os = "windows")]
const POLL_INTERVAL: Duration = Duration::from_secs(1);

#[cfg(target_os = "windows")]
fn set_memory_target_low(window: &tauri::WebviewWindow, low: bool) {
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;

        let controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        // ICoreWebView2_19 需要 WebView2 Runtime 1.0.1774+；旧运行时直接跳过。
        let Ok(core19) = core.cast::<ICoreWebView2_19>() else {
            return;
        };
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let _ = core19.SetMemoryUsageTargetLevel(level);
    });
}

#[cfg(target_os = "windows")]
pub fn start(app_handle: AppHandle) {
    if std::env::var_os("LUOJIAN_NO_MEMSAVER").is_some() {
        return;
    }
    std::thread::Builder::new()
        .name("webview-memory-saver".into())
        .spawn(move || {
            let mut hidden_since: Option<Instant> = None;
            let mut is_low = false;
            loop {
                std::thread::sleep(POLL_INTERVAL);
                let Some(window) = app_handle.get_webview_window("main") else {
                    continue;
                };
                let visible = window.is_visible().unwrap_or(true);
                if visible {
                    hidden_since = None;
                    if is_low {
                        set_memory_target_low(&window, false);
                        is_low = false;
                    }
                } else {
                    let since = *hidden_since.get_or_insert_with(Instant::now);
                    if !is_low && since.elapsed() >= HIDE_GRACE {
                        set_memory_target_low(&window, true);
                        is_low = true;
                    }
                }
            }
        })
        .ok();
}

#[cfg(not(target_os = "windows"))]
pub fn start(_app_handle: AppHandle) {}
