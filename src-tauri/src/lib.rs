use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_shell::ShellExt;

mod audio;
mod bridge;
mod capture;
mod diagnostics;
mod setup;
mod tray;

/// Result of probing the host for a Python that can run the diarization
/// sidecar. The only thing that matters is whether `pyannote.audio` is
/// importable — version numbers are not a reliable gate (pyannote runs on
/// a range of Python versions that varies by install).
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
enum PythonStatusCode {
    /// A Python with pyannote.audio was found.
    Ok,
    /// No Python on this machine can import pyannote.audio.
    NotFound,
}

#[derive(serde::Serialize, Clone, Debug)]
struct PythonStatus {
    /// "ok" | "not_found"
    status: PythonStatusCode,
    /// Version string of the Python that imported pyannote successfully, for
    /// display only ("3.14.2" etc.). None if no compatible interpreter was
    /// found at all.
    version: Option<String>,
}

/// Candidates probed in preference order. Mirrors `start_diarize.cjs` so dev
/// and the UI give consistent answers.
const PY_CANDIDATES: &[(&str, &[&str])] = &[
    ("py", &["-3.11"]),
    ("python3.11", &[]),
    ("python", &[]),
    ("python3", &[]),
];

fn build_command(cmd: &str, args: &[&str]) -> std::process::Command {
    let mut command = std::process::Command::new(cmd);
    command.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

/// Run `<cmd> <args> --version` and return the version string from the banner
/// ("3.14.2" etc.) on success, or None if the invocation fails. Used for the
/// display-only `version` field — does not gate anything.
fn probe_version(cmd: &str, args: &[&str]) -> Option<String> {
    let mut command = build_command(cmd, args);
    command.arg("--version");
    let child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;
    let output = wait_with_timeout(child, Duration::from_secs(3))?;
    if !output.status.success() {
        return None;
    }
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let start = combined.find("Python ")?;
    let rest = &combined[start + 7..];
    Some(rest.split(|c: char| c.is_whitespace()).next()?.to_string())
}

/// Returns true iff the given interpreter can `import pyannote.audio` and
/// print the sentinel to stdout. Any failure mode (interpreter missing,
/// import error, timeout) returns false. Import timeout is generous because
/// pyannote's first import is slow (downloads torch backends, etc.).
fn can_import_pyannote(cmd: &str, args: &[&str]) -> bool {
    let mut command = build_command(cmd, args);
    command.arg("-c").arg("import pyannote.audio; print(\"ok\")");
    let child = match command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let output = match wait_with_timeout(child, Duration::from_secs(15)) {
        Some(o) => o,
        None => return false,
    };
    if !output.status.success() {
        return false;
    }
    // pyannote writes deprecation warnings to stderr; the "ok" sentinel
    // only lands in stdout if the import actually succeeded.
    String::from_utf8_lossy(&output.stdout).contains("ok")
}

/// Wait up to `timeout` for `child` to exit, killing it if it doesn't.
fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> Option<std::process::Output> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

/// Walk the candidate list and return Ok with the first interpreter that can
/// import pyannote. Returns NotFound only if every candidate either doesn't
/// exist or lacks pyannote.
fn detect_python_status() -> PythonStatus {
    for (cmd, args) in PY_CANDIDATES {
        let Some(version) = probe_version(cmd, args) else { continue };
        if can_import_pyannote(cmd, args) {
            return PythonStatus {
                status: PythonStatusCode::Ok,
                version: Some(version),
            };
        }
    }
    PythonStatus {
        status: PythonStatusCode::NotFound,
        version: None,
    }
}

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

/// Stop capture, kill the sidecar, remove crash sentinel, and exit the app.
/// Shared by the tray "Quit" menu item and the main window close event.
fn shutdown(app: &tauri::AppHandle) {
    // Remove crash sentinel FIRST — if anything below panics, the sentinel
    // would incorrectly signal a crash on next launch.
    diagnostics::remove_sentinel();
    diagnostics::log_println("[DIAG] Clean shutdown");
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

/// Return Python detection result. Called by the frontend before allowing
/// Speakers/Deep mode to start. Cached after first probe — the user would
/// have to relaunch the app to change their Python install anyway, so a
/// stale reading isn't possible in practice.
#[tauri::command]
fn get_python_status(state: tauri::State<PythonCache>) -> PythonStatus {
    let mut slot = state.inner.lock().unwrap();
    if let Some(cached) = slot.as_ref() {
        return cached.clone();
    }
    let fresh = detect_python_status();
    *slot = Some(fresh.clone());
    fresh
}

struct PythonCache {
    inner: Mutex<Option<PythonStatus>>,
}

/// Runtime CUDA / NVIDIA-GPU availability plus the compile-time build
/// variant this binary was produced with. The banner in the UI uses both:
///   · GPU build + nvidia-smi ok → no banner (happy path)
///   · GPU build + nvidia-smi fail → banner with "install CUDA or use CPU build"
///   · CPU build → no banner regardless (the user chose CPU)
#[derive(serde::Serialize, Clone, Debug)]
struct CudaStatus {
    /// "gpu" when this binary was built with the `gpu` feature, else "cpu".
    build_variant: &'static str,
    /// Whether nvidia-smi was runnable and returned a GPU. Only meaningful
    /// on the GPU build — on the CPU build this is always false and the UI
    /// should ignore it.
    cuda_available: bool,
}

#[cfg(feature = "gpu")]
const BUILD_VARIANT: &str = "gpu";
#[cfg(not(feature = "gpu"))]
const BUILD_VARIANT: &str = "cpu";

/// Try to run `<exe> --query-gpu=name --format=csv,noheader` with a 3s
/// timeout. Returns true iff it runs successfully and prints a non-empty
/// GPU name. Used as the inner loop of `probe_nvidia_smi` so we can try
/// several candidate paths for nvidia-smi on Windows.
fn try_nvidia_smi(exe: &str) -> bool {
    let mut command = std::process::Command::new(exe);
    command.args(["--query-gpu=name", "--format=csv,noheader"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = match command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let output = match wait_with_timeout(child, Duration::from_secs(3)) {
        Some(o) => o,
        None => return false,
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().any(|l| !l.trim().is_empty())
}

/// Probe for an NVIDIA GPU by running nvidia-smi. On Windows we first try
/// the bare name (resolved via PATH) and fall back to the canonical
/// System32 location — on some constrained shells System32 isn't on the
/// child's PATH even though the binary lives there on every modern
/// NVIDIA-driver install.
fn probe_nvidia_smi() -> bool {
    if try_nvidia_smi("nvidia-smi") {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        if try_nvidia_smi(r"C:\Windows\System32\nvidia-smi.exe") {
            return true;
        }
    }
    false
}

#[tauri::command]
fn get_cuda_status(state: tauri::State<CudaCache>) -> CudaStatus {
    let mut slot = state.inner.lock().unwrap();
    if let Some(cached) = slot.as_ref() {
        return cached.clone();
    }
    let cuda_available = if BUILD_VARIANT == "gpu" {
        probe_nvidia_smi()
    } else {
        false
    };
    let fresh = CudaStatus { build_variant: BUILD_VARIANT, cuda_available };
    *slot = Some(fresh.clone());
    fresh
}

struct CudaCache {
    inner: Mutex<Option<CudaStatus>>,
}

/// Check if the previous session crashed. Called by the frontend on mount
/// to decide whether to show the crash-recovery dialog.
#[tauri::command]
fn check_crash_recovery(state: tauri::State<CrashState>) -> CrashRecoveryStatus {
    let crashed = *state.crashed_last_session.lock().unwrap();
    CrashRecoveryStatus { crashed }
}

/// Package logs + system info into a zip on the Desktop. Returns the path.
#[tauri::command]
fn save_diagnostic_report() -> Result<String, String> {
    diagnostics::package_diagnostic_report()
}

#[derive(serde::Serialize, Clone, Debug)]
struct CrashRecoveryStatus {
    crashed: bool,
}

struct CrashState {
    crashed_last_session: Mutex<bool>,
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
    // Guided Setup CLI flag (spec §22.7). If `--check-setup` is on the
    // command line, print the SetupState JSON and exit before we touch any
    // Tauri plumbing — useful for scripted smoke tests and for debugging
    // dependency problems without launching the full UI.
    setup::maybe_run_cli_check();

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
        .manage(PythonCache { inner: Mutex::new(None) })
        .manage(CudaCache { inner: Mutex::new(None) })
        .manage(CrashState { crashed_last_session: Mutex::new(false) })
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
            get_python_status,
            get_cuda_status,
            check_crash_recovery,
            save_diagnostic_report,
            setup::get_setup_state,
            // Fully-qualified paths here because #[tauri::command] generates
            // hidden __cmd__* siblings that a function-level `pub use` in
            // setup/mod.rs does not capture — generate_handler! needs both
            // the fn and its __cmd__ helper to be reachable from the same
            // path. See the note in setup/mod.rs for the full story.
            setup::install::install_pyannote,
            setup::install::cancel_pyannote_install,
            setup::install::get_pyannote_install_command,
        ])
        .setup(|app| {
            // ── Diagnostics bootstrap ──
            // 1. Init file logger + panic hook (must be first so all subsequent
            //    println!/eprintln! land in the log).
            diagnostics::init();
            // 2. Check if previous session crashed (sentinel file).
            let crashed = diagnostics::check_and_clear_crash();
            *app.state::<CrashState>().crashed_last_session.lock().unwrap() = crashed;
            if crashed {
                diagnostics::log_println("[DIAG] Previous session did not exit cleanly — crash recovery dialog will appear");
            }
            // 3. Write sentinel for THIS session (removed on clean shutdown).
            diagnostics::write_sentinel();
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
