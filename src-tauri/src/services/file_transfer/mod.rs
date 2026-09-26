pub mod handlers;
pub mod models;
pub mod utils;
pub mod web_ui;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use base64::Engine;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::app_state::{SessionHistory, SettingsState};
use crate::database::ClipboardEntry;
use crate::database::DbState;
use crate::infrastructure::repository::clipboard_repo::ClipboardRepository;
use crate::infrastructure::repository::settings_repo::SettingsRepository;
pub use models::*;
pub use utils::*;

pub static SERVER_HANDLE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
/// 每次启动服务加一；自动关闭的检查任务发现编号变了就退出。
static SERVER_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// “自动关闭服务”：这么久没有收到文件或消息就关闭（设置里的提示写的是 5 分钟）。
const AUTO_CLOSE_IDLE: std::time::Duration = std::time::Duration::from_secs(5 * 60);
const AUTO_CLOSE_CHECK_EVERY: std::time::Duration = std::time::Duration::from_secs(30);

/// 最后一次活动距离 `now` 是否已经超过 `idle`。没有记录时不算闲置。
pub(crate) fn is_idle(
    last_activity: Option<SystemTime>,
    now: SystemTime,
    idle: std::time::Duration,
) -> bool {
    match last_activity {
        Some(t) => now.duration_since(t).map(|d| d >= idle).unwrap_or(false),
        None => false,
    }
}

/// 启动后台检查：开着“自动关闭服务”且闲置超时，就关闭服务。
fn spawn_auto_close_watcher(app_handle: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(AUTO_CLOSE_CHECK_EVERY).await;
            if SERVER_GENERATION.load(Ordering::SeqCst) != generation {
                break;
            }
            if SERVER_HANDLE.lock().map(|h| h.is_none()).unwrap_or(true) {
                break;
            }
            let enabled = app_handle
                .state::<SettingsState>()
                .file_server_auto_close
                .load(Ordering::Relaxed);
            if !enabled {
                continue;
            }
            let last = app_handle
                .state::<ServerActivityState>()
                .last_activity
                .lock()
                .ok()
                .and_then(|g| *g);
            if is_idle(last, SystemTime::now(), AUTO_CLOSE_IDLE) {
                let _ = stop_file_server(&app_handle);
                break;
            }
        }
    });
}

/// 关闭文件服务并通知界面。开关和自动关闭共用。
pub fn stop_file_server(app_handle: &AppHandle) -> Result<String, String> {
    let mut handle = SERVER_HANDLE.lock().unwrap();
    if let Some(h) = handle.take() {
        h.abort();
        let db_state = app_handle.state::<DbState>();
        let _ = db_state.settings_repo.set("file_server_enabled", "false");
        let server_info = app_handle.state::<ServerInfo>();
        server_info.port.store(0, Ordering::SeqCst);
        {
            let mut ip_guard = server_info.ip.lock().unwrap();
            *ip_guard = String::new();
        }
        let _ = app_handle.emit(
            "file-server-status-changed",
            StatusPayload {
                enabled: false,
                port: 0,
                ip: String::new(),
            },
        );
        Ok("Server stopped".to_string())
    } else {
        Ok("Server not running".to_string())
    }
}

#[tauri::command]
pub fn get_local_ip_addr(app_handle: AppHandle) -> String {
    let server_info = app_handle.state::<ServerInfo>();
    if let Ok(guard) = server_info.ip.lock() {
        if !guard.is_empty() && *guard != "0.0.0.0" {
            return guard.clone();
        }
    }

    let ips = get_available_ips();
    if !ips.is_empty() {
        return ips[0].clone();
    }

    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or("127.0.0.1".to_string())
}

#[tauri::command]
pub fn set_display_ip(app_handle: AppHandle, ip: String) {
    let server_info = app_handle.state::<ServerInfo>();
    {
        let mut guard = server_info.ip.lock().unwrap();
        *guard = ip.clone();
    }
    let port = server_info.port.load(Ordering::Relaxed);
    let _ = app_handle.emit(
        "file-server-status-changed",
        StatusPayload {
            enabled: port != 0,
            port,
            ip,
        },
    );
}

#[tauri::command]
pub fn get_active_file_transfer_path(app_handle: AppHandle) -> String {
    let db_state = app_handle.state::<DbState>();
    let mut dir = app_handle
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    if let Ok(Some(custom)) = db_state.settings_repo.get("file_transfer_path") {
        if !custom.trim().is_empty() {
            dir = std::path::PathBuf::from(custom);
        }
    }
    dir.to_string_lossy().to_string()
}

#[tauri::command]
pub fn send_chat_message(app_handle: AppHandle, msg_type: String, content: String) {
    append_message(&app_handle, "out", &msg_type, &content, "pc", "电脑", None);
}

#[tauri::command]
pub fn get_chat_history(app_handle: AppHandle) -> Vec<Message> {
    if let Ok(msgs) = app_handle.state::<ChatState>().0.lock() {
        return msgs.clone();
    }
    vec![]
}

#[tauri::command]
pub fn send_file_to_client(app_handle: AppHandle, file_path: String) -> Result<(), String> {
    let shared_state = app_handle.state::<SharedFileState>();
    update_activity(&app_handle);

    let token = uuid::Uuid::new_v4().to_string();
    if let Ok(mut map) = shared_state.0.lock() {
        map.insert(token.clone(), file_path.clone());
    }

    let server_info = app_handle.state::<ServerInfo>();
    let port = server_info.port.load(Ordering::Relaxed);
    let ip = server_info.ip.lock().unwrap().clone();

    if port == 0 || ip.is_empty() || ip == "0.0.0.0" {
        return Err("Server not running or IP not detected".to_string());
    }

    let path_lower = file_path.to_lowercase();
    let is_image = path_lower.ends_with(".png")
        || path_lower.ends_with(".jpg")
        || path_lower.ends_with(".jpeg")
        || path_lower.ends_with(".gif")
        || path_lower.ends_with(".webp")
        || path_lower.ends_with(".bmp")
        || path_lower.ends_with(".svg")
        || path_lower.ends_with(".ico");

    let is_video = path_lower.ends_with(".mp4")
        || path_lower.ends_with(".mkv")
        || path_lower.ends_with(".avi")
        || path_lower.ends_with(".mov")
        || path_lower.ends_with(".wmv")
        || path_lower.ends_with(".flv")
        || path_lower.ends_with(".webm");

    let msg_type = if is_image {
        "image"
    } else if is_video {
        "video"
    } else {
        "file"
    };

    append_message(
        &app_handle,
        "out",
        msg_type,
        &file_path,
        "pc",
        "电脑",
        Some(&file_path),
    );

    Ok(())
}

#[tauri::command]
pub fn save_temp_image(app_handle: AppHandle, base64_data: String) -> Result<String, String> {
    use std::io::Write;
    let b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 Error: {}", e))?;
    let save_dir = app_handle
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    if !save_dir.exists() {
        let _ = std::fs::create_dir_all(&save_dir);
    }
    let filename = format!("paste_{}.png", chrono::Utc::now().format("%Y%m%d%H%M%S%f"));
    let path = save_dir.join(&filename);
    let mut file = std::fs::File::create(&path).map_err(|e| format!("File Error: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Write Error: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_download_url(app_handle: AppHandle, file_path: String) -> Result<String, String> {
    let port = {
        let server_info = app_handle.state::<ServerInfo>();
        let p = server_info.port.load(Ordering::Relaxed);
        if p == 0 {
            match toggle_file_server(app_handle.clone(), true, None).await {
                Ok(p_str) => p_str.parse::<u16>().unwrap_or(0),
                Err(_) => 0,
            }
        } else {
            p
        }
    };
    if port == 0 {
        return Err("Failed to start server".to_string());
    }
    let shared_state = app_handle.state::<SharedFileState>();
    let token = format!("fallback_{}", uuid::Uuid::new_v4());
    if let Ok(mut map) = shared_state.0.lock() {
        map.insert(token.clone(), file_path.clone());
    }
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    Ok(format!(
        "/download/{}?name={}",
        token,
        urlencoding::encode(&filename)
    ))
}

#[tauri::command]
pub async fn toggle_file_server(
    app_handle: AppHandle,
    enabled: bool,
    port: Option<u16>,
) -> Result<String, String> {
    if enabled {
        {
            let handle = SERVER_HANDLE.lock().unwrap();
            if handle.is_some() {
                return Ok("Server already running".to_string());
            }
        }
        let target_port = port.unwrap_or(12345);
        let (listener, actual_port) = bind_listener(target_port).await;
        if actual_port == 0 {
            return Err("Failed to bind any port".to_string());
        }
        let actual_ip = get_local_ip_addr(app_handle.clone());
        let server_info = app_handle.state::<ServerInfo>();
        server_info.port.store(actual_port, Ordering::SeqCst);
        {
            let mut ip_guard = server_info.ip.lock().unwrap();
            *ip_guard = actual_ip.clone();
        }
        let app_handle_clone = app_handle.clone();
        let h = tokio::spawn(async move {
            run_server(listener, app_handle_clone).await;
        });
        {
            let mut handle = SERVER_HANDLE.lock().unwrap();
            *handle = Some(h);
        }
        // 启动也算一次活动，然后开始自动关闭检查
        update_activity(&app_handle);
        let generation = SERVER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_auto_close_watcher(app_handle.clone(), generation);
        let _ = app_handle.emit(
            "file-server-status-changed",
            StatusPayload {
                enabled: true,
                port: actual_port,
                ip: if actual_ip.is_empty() || actual_ip.contains("0.0.0.0") {
                    "127.0.0.1".to_string()
                } else {
                    actual_ip
                },
            },
        );
        let db_state = app_handle.state::<DbState>();
        let _ = db_state.settings_repo.set("file_server_enabled", "true");
        let _ = db_state
            .settings_repo
            .set("file_server_port", &actual_port.to_string());
        Ok(format!("{}", actual_port))
    } else {
        stop_file_server(&app_handle)
    }
}

pub async fn run_server(listener: tokio::net::TcpListener, app_handle: AppHandle) {
    let (ws_tx, _) = broadcast::channel::<String>(100);
    {
        let ws_state = app_handle.state::<WsBroadcaster>();
        if let Ok(mut guard) = ws_state.0.lock() {
            *guard = Some(ws_tx.clone());
        };
    }
    let state = Arc::new(AppState {
        app_handle: app_handle.clone(),
        ws_tx: ws_tx.clone(),
    });
    let app = Router::new()
        .route("/", get(handlers::index))
        .route("/ws", get(handlers::ws_handler))
        .route("/poll", get(handlers::poll_messages))
        .route("/upload", post(handlers::upload))
        .route("/upload_chunk", post(handlers::upload_chunk))
        .route("/upload-chunk", post(handlers::upload_chunk))
        .route("/send_text", post(handlers::handle_text))
        .route("/send-text", post(handlers::handle_text))
        .route(
            "/download/{token}",
            get(handlers::handle_file_download_proxy),
        )
        .with_state(state)
        .layer(DefaultBodyLimit::disable());

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Server error: {}", e);
    }

    let server_info = app_handle.state::<ServerInfo>();
    server_info.port.store(0, Ordering::SeqCst);
    {
        let mut ip_guard = server_info.ip.lock().unwrap();
        *ip_guard = String::new();
    }
    let _ = app_handle.emit(
        "file-server-status-changed",
        StatusPayload {
            enabled: false,
            port: 0,
            ip: String::new(),
        },
    );
}

pub fn append_message(
    app: &AppHandle,
    direction: &str,
    msg_type: &str,
    content: &str,
    sender_id: &str,
    sender_name: &str,
    file_path: Option<&str>,
) {
    let chat_state = app.state::<ChatState>();
    let mut msgs = match chat_state.0.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let id = msgs.len() as u64 + 1;
    let mut final_content = content.to_string();
    if (msg_type == "image" || msg_type == "video" || msg_type == "file")
        && !final_content.starts_with("data:")
        && !final_content.starts_with("/download/")
    {
        if let Some(path) = file_path {
            let token = format!(
                "{}_{}",
                chrono::Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4()
            );
            let shared_files = app.state::<SharedFileState>();
            if let Ok(mut map) = shared_files.0.lock() {
                map.insert(token.clone(), path.to_string());
            }
            let filename = std::path::Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            final_content = format!(
                "/download/{}?name={}",
                token,
                urlencoding::encode(&filename)
            );
        }
    }
    let msg = Message {
        id,
        direction: direction.to_string(),
        msg_type: msg_type.to_string(),
        content: final_content,
        timestamp: chrono::Utc::now().timestamp_millis(),
        sender_id: sender_id.to_string(),
        sender_name: sender_name.to_string(),
        file_path: file_path.map(|s| s.to_string()),
    };
    msgs.push(msg.clone());
    drop(msgs);
    if let Some(ws_state) = app.try_state::<WsBroadcaster>() {
        if let Ok(guard) = ws_state.0.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(serde_json::to_string(&msg).unwrap_or_default());
            }
        }
    }
    let _ = app.emit("new-chat-message", msg);
}

pub async fn register_received_file(
    app_handle: &AppHandle,
    final_path: std::path::PathBuf,
    file_name: String,
    content_type: String,
    sender_id: String,
    sender_name: String,
) {
    let settings = app_handle.state::<SettingsState>();
    let session_hist = app_handle.state::<SessionHistory>();
    let is_image = content_type.starts_with("image/");
    let file_name_lower = file_name.to_lowercase();
    let is_video = content_type.starts_with("video/")
        || [".mp4", ".mov", ".mkv", ".avi", ".wmv", ".flv", ".webm"]
            .iter()
            .any(|ext| file_name_lower.ends_with(ext));
    let saved_path = final_path.to_string_lossy().to_string();
    let mut preview = format!("[File] {}", file_name);
    let mut type_enum = "file";
    if is_image {
        preview = "[Image]".to_string();
        type_enum = "image";
    } else if is_video {
        preview = "[Video]".to_string();
        type_enum = "video";
    }
    append_message(
        app_handle,
        "in",
        type_enum,
        &saved_path,
        &sender_id,
        &sender_name,
        Some(&saved_path),
    );
    if settings.auto_copy_file.load(Ordering::Relaxed) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let entry = ClipboardEntry {
            id: 0,
            content_type: type_enum.to_string(),
            content: saved_path.clone(),
            html_content: None,
            source_app: "File Transfer".to_string(),
            source_app_path: None,
            timestamp,
            preview,
            is_pinned: false,
            tags: Vec::new(),
            use_count: 0,
            is_external: false,
            pinned_order: 0,
            file_preview_exists: true,
        };
        if settings.persistent.load(Ordering::Relaxed) {
            let db_state = app_handle.state::<DbState>();
            if let Ok(id) = db_state.repo.save(&entry, None) {
                if id != 0 {
                    let _ = app_handle.emit("clipboard-changed", id);
                }
            }
        } else {
            let id = -(SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros() as i64
                / 1000);
            let mut entry_mem = entry;
            entry_mem.id = id;
            if let Ok(mut session) = session_hist.0.lock() {
                session.push_back(entry_mem);
                if session.len() > 500 {
                    if let Some(removed) = session.pop_front() {
                        let _ = app_handle.emit("clipboard-removed", removed.id);
                    }
                }
            }
            let _ = app_handle.emit("clipboard-changed", id);
        }
    }
    if settings.auto_copy_file.load(Ordering::Relaxed) {
        unsafe {
            let _ = crate::infrastructure::windows_api::win_clipboard::set_clipboard_files(vec![
                saved_path,
            ]);
        }
    }
    let db_state = app_handle.state::<DbState>();
    if let Ok(Some(val)) = db_state.settings_repo.get("file_transfer_auto_open") {
        if val == "true" {
            let parent = final_path.parent().unwrap_or(std::path::Path::new("."));
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("explorer").arg(parent).spawn();
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open").arg(parent).spawn();
        }
    }
}

#[tauri::command]
pub fn get_file_server_status(app_handle: AppHandle) -> StatusPayload {
    let server_info = app_handle.state::<ServerInfo>();
    let port = server_info.port.load(Ordering::Relaxed);
    let ip = server_info.ip.lock().unwrap().clone();
    StatusPayload {
        enabled: port != 0,
        port,
        ip,
    }
}

#[tauri::command]
pub fn get_app_logo(app_handle: AppHandle) -> String {
    get_app_logo_base64(&app_handle)
}

#[cfg(test)]
mod auto_close_tests {
    use super::is_idle;
    use std::time::{Duration, SystemTime};

    #[test]
    fn idle_only_after_timeout() {
        let now = SystemTime::now();
        let five = Duration::from_secs(300);
        assert!(!is_idle(Some(now - Duration::from_secs(299)), now, five));
        assert!(is_idle(Some(now - Duration::from_secs(300)), now, five));
        assert!(is_idle(Some(now - Duration::from_secs(3600)), now, five));
    }

    #[test]
    fn no_record_or_future_time_is_not_idle() {
        let now = SystemTime::now();
        let five = Duration::from_secs(300);
        assert!(!is_idle(None, now, five));
        assert!(!is_idle(Some(now + Duration::from_secs(60)), now, five));
    }
}
