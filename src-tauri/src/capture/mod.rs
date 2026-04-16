pub mod accessibility;
pub mod batcher;
pub mod ocr;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;
use uuid::Uuid;
use tauri::Emitter;

use accessibility::get_focused_window_text;

const CAPTURE_INTERVAL_SECS: u64 = 10;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureStatus {
    Idle,
    Capturing,
    Paused,
}

#[derive(serde::Serialize, Clone, Debug)]
struct TranscriptEvent {
    text: String,
    source: String,
    timestamp: u64,
}

pub struct CaptureManager {
    status: CaptureStatus,
    session_id: Option<String>,
    stop_tx: Option<watch::Sender<bool>>,
    task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    app_handle: Option<tauri::AppHandle>,
    focused_windows: Arc<Mutex<Vec<String>>>,
}

impl CaptureManager {
    pub fn new() -> Self {
        Self {
            status: CaptureStatus::Idle,
            session_id: None,
            stop_tx: None,
            task_handle: None,
            app_handle: None,
            focused_windows: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn start(&mut self, app_handle: tauri::AppHandle) {
        if self.status == CaptureStatus::Capturing {
            return;
        }

        let session_id = Uuid::new_v4().to_string();
        self.session_id = Some(session_id.clone());
        self.status = CaptureStatus::Capturing;

        let (stop_tx, stop_rx) = watch::channel(false);
        self.stop_tx = Some(stop_tx);
        self.app_handle = Some(app_handle.clone());

        // Emit status change
        let emit_result = app_handle.emit("fides://capture-status", "capturing");
        println!("[CAPTURE] Emitted fides://capture-status: capturing (result: {emit_result:?})");

        let focused = self.focused_windows.clone();

        let handle = tauri::async_runtime::spawn(async move {
            capture_loop(app_handle, session_id, stop_rx, focused).await;
        });

        self.task_handle = Some(handle);
        println!(
            "[CAPTURE] Started capture session: {}",
            self.session_id.as_deref().unwrap_or("unknown")
        );
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(true);
        }
        self.status = CaptureStatus::Idle;
        self.session_id = None;

        if let Some(app) = &self.app_handle {
            let emit_result = app.emit("fides://capture-status", "idle");
            println!("[CAPTURE] Emitted fides://capture-status: idle (result: {emit_result:?})");
        }

        println!("[CAPTURE] Stopped");
    }

    pub fn is_running(&self) -> bool {
        self.status == CaptureStatus::Capturing
    }

    pub fn status(&self) -> &CaptureStatus {
        &self.status
    }

    pub fn set_focused_windows(&self, windows: Vec<String>) {
        *self.focused_windows.lock().unwrap() = windows;
    }
}

// ─── Smart deduplication ───

fn is_duplicate(new_text: &str, last_text: &str) -> bool {
    if new_text.is_empty() || last_text.is_empty() {
        return false;
    }
    // If length is within 5% of last capture
    let len_ratio = new_text.len() as f64 / last_text.len() as f64;
    if len_ratio < 0.95 || len_ratio > 1.05 {
        return false;
    }
    // And first 200 chars match
    let prefix_len = 200.min(new_text.len()).min(last_text.len());
    new_text[..prefix_len] == last_text[..prefix_len]
}

// ─── Window title helpers (platform-specific) ───

#[cfg(target_os = "windows")]
pub fn get_foreground_window_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

    unsafe {
        let hwnd = GetForegroundWindow();
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_foreground_window_title() -> String {
    String::new()
}

#[cfg(target_os = "windows")]
pub fn enumerate_visible_windows() -> Vec<String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, IsWindowVisible,
    };
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};

    let mut titles: Vec<String> = Vec::new();

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            let skip = [
                "Default IME", "MSCTFIME", "GDI+", "Program Manager",
                "NVIDIA", "Windows Input", "Settings", "IME",
            ];
            if !skip.iter().any(|s| title.contains(s)) && title.len() > 1 {
                let vec = &mut *(lparam.0 as *mut Vec<String>);
                vec.push(title);
            }
        }
        BOOL(1)
    }

    unsafe {
        let lparam = LPARAM(&mut titles as *mut Vec<String> as isize);
        let _ = EnumWindows(Some(enum_callback), lparam);
    }

    titles.sort();
    titles.dedup();
    titles
}

#[cfg(not(target_os = "windows"))]
pub fn enumerate_visible_windows() -> Vec<String> {
    Vec::new()
}

// ─── Async capture loop ───

async fn capture_loop(
    app_handle: tauri::AppHandle,
    session_id: String,
    mut stop_rx: watch::Receiver<bool>,
    focused_windows: Arc<Mutex<Vec<String>>>,
) {
    let mut last_text = String::new();

    println!("[CAPTURE LOOP] Started for session {session_id}");

    loop {
        // Check stop signal
        if *stop_rx.borrow() {
            break;
        }

        // Clone the filter so we don't hold the lock across await
        let filter = focused_windows.lock().unwrap().clone();

        // Capture text and window title (blocking — run on blocking thread)
        let (text, source) = tokio::task::spawn_blocking(move || {
            let title = get_foreground_window_title();

            // If filter is active and current window doesn't match, skip
            if !filter.is_empty()
                && !filter
                    .iter()
                    .any(|w| title.contains(w.as_str()) || w.contains(title.as_str()))
            {
                return (String::new(), title);
            }

            let text = capture_text_from_screen();
            (text, title)
        })
        .await
        .unwrap_or_default();

        // Smart dedup: skip if text is essentially the same as last capture
        if !text.is_empty() && !is_duplicate(&text, &last_text) {
            println!(
                "[CAPTURE LOOP] New text captured, {} chars from '{}'",
                text.len(),
                source
            );

            let event = TranscriptEvent {
                text: text.clone(),
                source: source.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            };
            let _ = app_handle.emit("fides://transcript", &event);
            last_text = text;
        }

        // Wait for next capture interval, but also check stop signal
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(CAPTURE_INTERVAL_SECS)) => {},
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    break;
                }
            }
        }
    }

    println!("[CAPTURE LOOP] Exited for session {session_id}");
}

fn capture_text_from_screen() -> String {
    // Try accessibility first
    match get_focused_window_text() {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => String::new(),
        Err(e) => {
            // Log the error type but not any text content
            match &e {
                accessibility::CaptureError::PermissionDenied(msg) => {
                    eprintln!("[CAPTURE] Permission denied: {msg}");
                }
                accessibility::CaptureError::NotAvailable(msg) => {
                    eprintln!("[CAPTURE] Not available: {msg}");
                }
                accessibility::CaptureError::ExtractionFailed(_) => {
                    // Extraction failures are common — don't spam logs
                }
            }
            // OCR fallback — stub for now
            // TODO: Take screenshot and run OCR
            String::new()
        }
    }
}
