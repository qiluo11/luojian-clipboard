use super::web_ai_delay_cmd::{resolve_web_ai_delay, web_ai_site_key, SITE_DELAY_SETTING};
use crate::database::DbState;
use crate::infrastructure::repository::settings_repo::SettingsRepository;
use crate::error::{AppError, AppResult};
use crate::services::clipboard_ops;
use tauri::{command, AppHandle, Emitter, State};

/// 组装送往网页版 AI 的完整文本：
/// 模板含 `{content}` 占位符则替换；否则在模板末尾以空行拼接内容。
pub fn compose_web_ai_payload(template: &str, content: &str) -> String {
    if template.contains("{content}") {
        template.replace("{content}", content)
    } else {
        format!("{}\n\n{}", template, content)
    }
}

/// 前台进程白名单校验：仅当窗口属于常见浏览器时才允许模拟按键，
/// 防止 Ctrl+V/Enter 误贴进微信等其它窗口。传入的是进程文件名
/// （含或不含 .exe、含路径前缀均可，大小写不敏感）。
/// 白名单刻意不含 `msedgewebview2`（本程序自身的宿主进程）。
pub fn is_browser_foreground(process_name: &str) -> bool {
    let base = process_name.rsplit(['\\', '/']).next().unwrap_or(process_name);
    let lowered = base.to_lowercase();
    let stem = lowered.strip_suffix(".exe").unwrap_or(&lowered);
    matches!(
        stem,
        "chrome" | "msedge" | "edge" | "firefox" | "brave" | "vivaldi" | "opera"
    )
}

/// 取得当前前台窗口的进程文件名（如 "chrome.exe"），失败返回 None。
#[cfg(target_os = "windows")]
unsafe fn foreground_process_name() -> Option<String> {
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    let hwnd = GetForegroundWindow();
    if hwnd.0.is_null() {
        return None;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return None;
    }
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; 512];
    let mut size = buf.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_FORMAT(0), // PROCESS_NAME_WIN32
        PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);
    result.ok()?;
    let path = String::from_utf16_lossy(&buf[..size.min(buf.len() as u32) as usize]);
    Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

/// 用系统默认方式（ShellExecuteW "open"）打开 URL，交给默认浏览器。
/// 不走 tauri opener 前端插件：整条链在后台线程执行，与前端解耦。
fn open_url(url: &str) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOW;

        let operation = HSTRING::from("open");
        let file = HSTRING::from(url);
        let ret = unsafe {
            ShellExecuteW(
                None,
                PCWSTR::from_raw(operation.as_ptr()),
                PCWSTR::from_raw(file.as_ptr()),
                None,
                None,
                SW_SHOW,
            )
        };
        if (ret.0 as isize) <= 32 {
            return Err(AppError::Internal(format!(
                "ShellExecuteW failed (code {})",
                ret.0 as isize
            )));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to open url: {}", e)))?;
        Ok(())
    }
}

/// 网页版 AI 助手：组装提示词 → 写剪贴板 → 打开站点 → 延迟 → 前台校验 →
/// 模拟 Ctrl+V（可选再回车发送）。命令立即返回，整条链在后台线程执行；
/// 失败/中止通过 "web-ai-status" 事件通知前端 toast。
///
/// 提示词与默认延迟由前端传入；网站延迟覆盖在调用时从设置读取。
#[command]
pub fn web_ai_ask(
    app_handle: AppHandle,
    state: State<'_, DbState>,
    template: String,
    content: String,
    url: String,
    auto_send: bool,
    delay_ms: u64,
) -> AppResult<()> {
    let url = url.trim().to_string();
    if web_ai_site_key(&url).is_none() {
        return Err(AppError::Validation(
            "Expected an HTTP(S) website URL without credentials.".to_string(),
        ));
    }
    // 同网站共享覆盖值；无覆盖则保留调用方默认值（旧配置无需迁移）。
    let site_delays = state.settings_repo.get(SITE_DELAY_SETTING)?;
    let delay_ms = resolve_web_ai_delay(&url, delay_ms, site_delays.as_deref());

    std::thread::spawn(move || {
        let composed = compose_web_ai_payload(&template, &content);

        // 1. 写系统剪贴板（prepare_clipboard_payload 会武装 LAST_APP_SET_HASH
        //    自捕获抑制，不会被历史监听器重复记录一条）。
        if let Err(e) = tauri::async_runtime::block_on(clipboard_ops::prepare_clipboard_payload(
            &composed,
            "text",
            None,
            false,
        )) {
            println!("[WebAI] clipboard prepare failed: {}", e);
            let _ = app_handle.emit("web-ai-status", "clipboard_failed");
            return;
        }

        // 2. 打开提示词绑定的站点（默认浏览器）。
        if let Err(e) = open_url(&url) {
            println!("[WebAI] open url failed: {}", e);
            let _ = app_handle.emit("web-ai-status", "open_failed");
            return;
        }

        // 3. 等待页面加载与输入框自动聚焦。
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));

        // 4. 前台安全校验：焦点不在浏览器则中止按键（绝不发 Ctrl+V）。
        #[cfg(target_os = "windows")]
        {
            let fg_name = unsafe { foreground_process_name() };
            let is_browser = fg_name
                .as_deref()
                .map(is_browser_foreground)
                .unwrap_or(false);
            if !is_browser {
                println!(
                    "[WebAI] aborted, foreground process: {:?}",
                    fg_name.as_deref().unwrap_or("unknown")
                );
                let _ = app_handle.emit("web-ai-status", "aborted_focus");
                return;
            }
        }

        // 5. 粘贴；可选延时后回车发送。
        clipboard_ops::send_paste_keystroke("ctrl_v", None, None);
        if auto_send {
            std::thread::sleep(std::time::Duration::from_millis(600));
            clipboard_ops::send_enter_keystroke();
        }
        let _ = app_handle.emit("web-ai-status", "done");
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_ai_compose_with_placeholder() {
        let out = compose_web_ai_payload("翻译：\n{content}", "hello world");
        assert_eq!(out, "翻译：\nhello world");
    }

    #[test]
    fn web_ai_compose_fallback_append() {
        let out = compose_web_ai_payload("总结下面内容", "line1\nline2");
        assert_eq!(out, "总结下面内容\n\nline1\nline2");
    }

    #[test]
    fn web_ai_placeholder_multiple_occurrences() {
        let out = compose_web_ai_payload("{content} 和 {content}", "x");
        assert_eq!(out, "x 和 x");
    }

    #[test]
    fn web_ai_browser_whitelist() {
        assert!(is_browser_foreground("chrome.exe"));
        assert!(is_browser_foreground("Chrome.EXE"));
        assert!(is_browser_foreground("msedge"));
        assert!(is_browser_foreground("C:\\Program Files\\Firefox\\firefox.exe"));
        assert!(is_browser_foreground("brave.exe"));
        assert!(is_browser_foreground("vivaldi.exe"));
        assert!(is_browser_foreground("opera.exe"));
        assert!(is_browser_foreground("edge.exe"));
    }

    #[test]
    fn web_ai_non_browser_rejected() {
        assert!(!is_browser_foreground("msedgewebview2.exe"));
        assert!(!is_browser_foreground("Weixin.exe"));
        assert!(!is_browser_foreground("explorer.exe"));
        assert!(!is_browser_foreground("luojian.exe"));
        assert!(!is_browser_foreground("chromedriver.exe"));
        assert!(!is_browser_foreground(""));
    }
}
