use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_shell::ShellExt;

mod audio;
mod bridge;
mod capture;
mod tray;

struct SidecarState {
    child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
}

struct CaptureState {
    manager: Arc<Mutex<capture::CaptureManager>>,
}

struct AudioState {
    manager: Arc<Mutex<audio::AudioManager>>,
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Stop capture, kill the sidecar, and exit the app.
/// Shared by the tray "Quit" menu item and the main window close event.
fn shutdown(app: &tauri::AppHandle) {
    {
        let state = app.state::<CaptureState>();
        let mut mgr = state.manager.lock().unwrap();
        if mgr.is_running() {
            mgr.stop();
        }
    }
    let state = app.state::<SidecarState>();
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    app.exit(0);
}

#[tauri::command]
fn get_capture_status(state: tauri::State<CaptureState>) -> String {
    let mgr = state.manager.lock().unwrap();
    match mgr.status() {
        capture::CaptureStatus::Idle => "idle".to_string(),
        capture::CaptureStatus::Capturing => "capturing".to_string(),
        capture::CaptureStatus::Paused => "paused".to_string(),
    }
}

#[tauri::command]
fn get_open_windows() -> Vec<String> {
    capture::enumerate_visible_windows()
}

#[tauri::command]
fn set_focused_windows(state: tauri::State<CaptureState>, windows: Vec<String>) {
    let mgr = state.manager.lock().unwrap();
    mgr.set_focused_windows(windows);
}

#[tauri::command]
fn get_model_status() -> audio::ModelStatus {
    audio::get_model_status()
}

#[tauri::command]
async fn download_model(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = audio::ensure_model_downloaded(app_handle).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn start_audio_capture(
    source: String,
    mode: Option<String>,
    record_audio: Option<bool>,
    mic_device: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<AudioState>,
) -> Result<(), String> {
    let audio_source = audio::AudioSource::from_str(&source)
        .ok_or_else(|| format!("Invalid source: {source}. Use microphone, loopback, or both."))?;

    let mode_u8 = match mode.as_deref() {
        Some("capture") => 0,
        Some("deep") => 2,
        _ => 1, // default: live
    };

    let mut mgr = state.manager.lock().map_err(|e| format!("Lock error: {e}"))?;

    // Stop current capture if running (allows source switching)
    if mgr.is_running() {
        mgr.stop();
    }

    // Load model if not already loaded
    let model = audio::model_path();
    if !model.exists() {
        return Err("Model not downloaded. Call download_model first.".into());
    }
    if mgr.needs_model_load() {
        mgr.load_model(&model.to_string_lossy(), app_handle.clone())?;
    }

    mgr.start(audio_source, mode_u8, record_audio.unwrap_or(false), mic_device, app_handle)?;
    Ok(())
}

#[tauri::command]
fn stop_audio_capture(state: tauri::State<AudioState>) -> Result<(), String> {
    let mut mgr = state.manager.lock().map_err(|e| format!("Lock error: {e}"))?;
    mgr.stop();
    Ok(())
}

#[tauri::command]
fn get_audio_capture_status(state: tauri::State<AudioState>) -> bool {
    let mgr = state.manager.lock().unwrap();
    mgr.is_running()
}

#[tauri::command]
fn retranscribe_session(
    session_id: String,
    audio_session_id: String,
    mode: u8,
    app_handle: tauri::AppHandle,
    state: tauri::State<AudioState>,
) -> Result<Vec<audio::retranscribe::RetranscribeSegment>, String> {
    let mut mgr = state.manager.lock().map_err(|e| format!("Lock error: {e}"))?;
    let transcriber = mgr.get_transcriber(app_handle)?;
    let session_dir = std::path::PathBuf::new(); // not used directly
    audio::retranscribe::retranscribe(transcriber, session_dir, &audio_session_id, mode)
}

#[tauri::command]
fn list_audio_input_devices() -> Vec<String> {
    use cpal::traits::{HostTrait, DeviceTrait};
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for dev in devices {
            if let Ok(name) = dev.name() {
                names.push(name);
            }
        }
    }
    names
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Arc::new(Mutex::new(None)),
        })
        .manage(CaptureState {
            manager: Arc::new(Mutex::new(capture::CaptureManager::new())),
        })
        .manage(AudioState {
            manager: Arc::new(Mutex::new(audio::AudioManager::new())),
        })
        .invoke_handler(tauri::generate_handler![
            get_capture_status,
            get_open_windows,
            set_focused_windows,
            get_model_status,
            download_model,
            start_audio_capture,
            stop_audio_capture,
            get_audio_capture_status,
            list_audio_input_devices,
            retranscribe_session,
        ])
        .setup(|app| {
            // Spawn the bundled sidecar binary (declared as externalBin in tauri.conf.json).
            // In production the binary is shipped alongside the app; in dev the tsx-based
            // sidecar started by `pnpm tauri:dev` is already listening on 19533, so a spawn
            // failure here is harmless (port is already served).
            match app.shell().sidecar("fortifide-sidecar") {
                Ok(cmd) => match cmd.spawn() {
                    Ok((_rx, child)) => {
                        let state = app.state::<SidecarState>();
                        *state.child.lock().unwrap() = Some(child);
                        println!("[SIDECAR] Spawned bundled sidecar");
                    }
                    Err(e) => {
                        eprintln!("[SIDECAR] Failed to spawn (may already be running): {e}");
                    }
                },
                Err(e) => {
                    eprintln!("[SIDECAR] Sidecar resolution failed (dev mode may use tsx-based sidecar): {e}");
                }
            }

            // System tray
            let toggle_i =
                MenuItem::with_id(app, "toggle", "Start Capture", true, None::<&str>)?;
            let open_i =
                MenuItem::with_id(app, "open", "Open Review", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle_i, &open_i, &quit_i])?;

            // Clone the toggle item so we can update its text from the event handler
            let toggle_for_event = toggle_i.clone();

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Fides — Idle")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "toggle" => {
                        let state = app.state::<CaptureState>();
                        let mut mgr = state.manager.lock().unwrap();
                        println!("[TRAY] Toggle capture clicked, is_running: {}", mgr.is_running());
                        if mgr.is_running() {
                            mgr.stop();
                            tray::update_toggle_item(
                                &toggle_for_event,
                                &capture::CaptureStatus::Idle,
                            );
                            tray::update_tray_tooltip(app, &capture::CaptureStatus::Idle);
                        } else {
                            mgr.start(app.clone());
                            tray::update_toggle_item(
                                &toggle_for_event,
                                &capture::CaptureStatus::Capturing,
                            );
                            tray::update_tray_tooltip(app, &capture::CaptureStatus::Capturing);
                        }
                    }
                    "open" => show_window(app),
                    "quit" => shutdown(app),
                    _ => {}
                })
                .build(app)?;

            // Show the main window immediately on launch. The tray icon
            // remains available as a secondary access point.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Closing the main window exits the app (tray is secondary).
                shutdown(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
