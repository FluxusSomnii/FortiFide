//! Subprocess automation for Check 4 (spec §22.5 Prompt 2b.2).
//!
//! Provides the `install_pyannote` Tauri command that runs pip against the
//! detected Python 3.11 interpreter, streams stdout/stderr back to the UI
//! as Tauri events, and supports cancellation via `cancel_pyannote_install`.
//!
//! Why a dedicated module rather than an inline command in `mod.rs`:
//!   - mod.rs is already carrying the detection orchestrator and its tests.
//!   - The install path has its own lifecycle (concurrent-install guard,
//!     cancel channel, event emission) that's easier to reason about in
//!     isolation.
//!   - Keeping install data-path constants next to the subprocess logic
//!     that consumes them prevents drift between the auto-install and
//!     the manual-command text shown in the wizard.
//!
//! Security note: this command spawns a subprocess from within Rust using
//! `tokio::process::Command`. It does NOT go through the tauri-plugin-shell
//! scope system, so we do not need `shell:allow-execute` in the app's
//! capability file. The frontend calls `invoke('install_pyannote')`, which
//! dispatches here under Rust's trust boundary; arbitrary shell commands
//! remain gated by the plugin's own permissions (we only added `shell:allow-
//! open` for URL-opening in 2a).
//!
//! The install command itself matches what the wizard's "Show me the
//! command" tab displays — both are derived from `PyannoteInstallConfig`
//! below, so a future version bump is a single-constant change.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW — suppresses the console window that Windows pops
/// for every child process spawned from a GUI app. Without this, users see
/// a flash of cmd.exe every time the install runs.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Install configuration (single source of truth) ─────────────────────

/// Version and channel pins for the pyannote auto-install. These values
/// are displayed verbatim in the "Show me the command" tab of the wizard
/// (via `manual_command_string`) and injected into the auto-install
/// subprocess. Bumping them in one place updates both.
///
/// History: the 2a spec shipped with `cu121` + unpinned torch. Verification
/// on the dev machine showed pip silently replacing CUDA torch with CPU
/// torch when pyannote was installed after torch, and torch 2.8.0 not being
/// hosted on the cu121 channel any more. The current values (torch 2.8.0 on
/// cu126, single `--force-reinstall` invocation) are what actually works.
pub struct PyannoteInstallConfig {
    pub torch_version: &'static str,
    pub torchaudio_version: &'static str,
    /// Empty string on CPU build (no `--extra-index-url` argument).
    pub cuda_channel: &'static str,
    pub pyannote_spec: &'static str,
}

pub const PYANNOTE_INSTALL_GPU: PyannoteInstallConfig = PyannoteInstallConfig {
    torch_version: "2.8.0",
    torchaudio_version: "2.8.0",
    cuda_channel: "cu126",
    pyannote_spec: "pyannote.audio",
};

pub const PYANNOTE_INSTALL_CPU: PyannoteInstallConfig = PyannoteInstallConfig {
    torch_version: "2.8.0",
    torchaudio_version: "2.8.0",
    cuda_channel: "",
    pyannote_spec: "pyannote.audio",
};

/// Compile-time selection of the config for the current build variant.
#[cfg(feature = "gpu")]
pub fn install_config() -> &'static PyannoteInstallConfig {
    &PYANNOTE_INSTALL_GPU
}

#[cfg(not(feature = "gpu"))]
pub fn install_config() -> &'static PyannoteInstallConfig {
    &PYANNOTE_INSTALL_CPU
}

/// Build the pip argument list (everything after the Python executable).
/// Consumed by both the subprocess spawn and `manual_command_string`.
///
/// The CUDA channel is attached via `--extra-index-url`, not `--index-url`.
/// The distinction matters and was an actual runtime bug: `--index-url`
/// *replaces* PyPI entirely, so pip finds torch/torchaudio on the CUDA
/// channel but then cannot resolve pyannote.audio (which lives on PyPI
/// only), producing `No matching distribution found for pyannote.audio`.
/// `--extra-index-url` *adds* the CUDA channel alongside PyPI, and pip
/// resolves each package from whichever index hosts it.
fn pip_args(config: &PyannoteInstallConfig) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-m".into(),
        "pip".into(),
        "install".into(),
        "--force-reinstall".into(),
        format!("torch=={}", config.torch_version),
        format!("torchaudio=={}", config.torchaudio_version),
        config.pyannote_spec.into(),
    ];
    if !config.cuda_channel.is_empty() {
        args.push("--extra-index-url".into());
        args.push(format!(
            "https://download.pytorch.org/whl/{}",
            config.cuda_channel
        ));
    }
    args
}

/// Renders the current install config as a single-line command users can
/// paste into their shell. Prefixed with `py -3.11` rather than the detected
/// absolute path, because the Python launcher form is what works on the
/// widest range of Windows machines regardless of PATH state.
pub fn manual_command_string(config: &PyannoteInstallConfig) -> String {
    let mut parts: Vec<String> = vec!["py".into(), "-3.11".into()];
    parts.extend(pip_args(config));
    parts.join(" ")
}

// ── Concurrent-install guard + cancel channel ──────────────────────────

/// Atomic fast-path guard. Set true for the duration of an install; rejects
/// overlapping invocations even before we try to acquire the mutex.
static INSTALLING: AtomicBool = AtomicBool::new(false);

/// RAII reset for `INSTALLING`. Armed on construction; resets the atomic
/// to `false` on drop — including on panic unwind — unless `disarm()` has
/// been called.
///
/// Ownership model:
///   * Before the subprocess is spawned, the guard owns the reset. Any
///     early return or panic between CAS and spawn restores the atomic.
///   * Once the subprocess and monitor task are live, the monitor task
///     owns the reset (it resets INSTALLING in its own exit path). The
///     caller `disarm()`s the guard at that handoff point so both paths
///     don't race to flip the bit.
///
/// This fixes the pre-patch bug where a panic inside `start_install`
/// (specifically: `reqwest::blocking` constructing a nested runtime from
/// an async context) left INSTALLING stuck true, so every subsequent
/// install click bounced with "Install already in progress" until the
/// process was restarted.
struct InstallGuard {
    armed: bool,
}

impl InstallGuard {
    fn new() -> Self {
        Self { armed: true }
    }
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        if self.armed {
            INSTALLING.store(false, Ordering::Release);
        }
    }
}

struct InstallState {
    /// Some while an install is running; used by `cancel_pyannote_install`
    /// to signal the monitor task to kill the child.
    cancel_tx: Option<oneshot::Sender<()>>,
}

fn install_state() -> &'static Arc<Mutex<InstallState>> {
    static STATE: OnceLock<Arc<Mutex<InstallState>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(InstallState { cancel_tx: None })))
}

// ── Event payload types ────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct InstallLogEvent {
    kind: &'static str, // "stdout" | "stderr"
    line: String,
}

#[derive(Clone, Serialize)]
struct InstallDoneEvent {
    exit_code: i32,
    duration_seconds: u64,
    /// True when the process was terminated by a cancel request rather
    /// than exiting on its own. UI uses this to distinguish "cancelled"
    /// from "failed".
    cancelled: bool,
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Install pyannote + matching torch into the Check-3 Python interpreter.
///
/// Returns `Err(String)` on preflight failures (Python missing, another
/// install already running, subprocess spawn error). Returns `Ok(())` as
/// soon as the subprocess is spawned — the caller then listens for
/// `setup://pyannote-install-log` line events and a terminal
/// `setup://pyannote-install-done` event.
#[tauri::command]
pub async fn install_pyannote(app: AppHandle) -> Result<(), String> {
    // Compare-and-swap rather than plain swap so a concurrent caller can't
    // race to true-true between our check and the set.
    if INSTALLING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Install already in progress".into());
    }

    // Armed RAII guard: resets INSTALLING on drop unless explicitly
    // disarmed. Covers early returns AND panics — the latter is how the
    // atomic got stuck true in the bug that forced this patch.
    let mut guard = InstallGuard::new();

    let result = start_install(app).await;

    if result.is_ok() {
        // Subprocess + monitor task are live; the monitor owns the reset
        // from here. Disarm so the guard doesn't race with it.
        guard.disarm();
    }
    // Err path: guard drops → resets the atomic automatically.
    result
}

async fn start_install(app: AppHandle) -> Result<(), String> {
    // Use the cached Python 3.11 path from the last `detect()` run.
    //
    // The previous implementation called `super::detect()` here to
    // "guarantee-fresh" the path. That re-ran all seven checks including
    // the HF probes — which used `reqwest::blocking` and constructed a
    // nested tokio runtime inside the outer async context, panicking
    // every time. The frontend already has a recent `SetupState` (it's
    // what put the user on step 4's Install button in the first place),
    // so the cached path is as fresh as the user's own view of the
    // wizard. If detection has never been run in this process, fall
    // through to a graceful error — the wizard's normal flow always
    // runs detect() before the Install button is clickable.
    let python_path = super::cached_python_path().ok_or_else(|| {
        "Python 3.11 was not detected. Close and reopen the wizard to re-run detection.".to_string()
    })?;

    let config = install_config();
    let args = pip_args(config);

    let mut cmd = Command::new(&python_path);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn pip: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    // Register cancel channel. Do this before spawning the monitor task so
    // the mutex release-acquire can't race against a fast cancel click.
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        let state_lock = install_state().clone();
        let mut guard = state_lock.lock().await;
        guard.cancel_tx = Some(cancel_tx);
    }

    // Spawn stdout and stderr readers as independent tasks. Each emits
    // line-by-line as `kind: stdout | stderr`. We deliberately do not
    // parse pip's own progress bars — pip's output format shifts across
    // versions and we'd rather stream raw lines reliably.
    let app_out = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit(
                "setup://pyannote-install-log",
                InstallLogEvent { kind: "stdout", line },
            );
        }
    });
    let app_err = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(
                "setup://pyannote-install-log",
                InstallLogEvent { kind: "stderr", line },
            );
        }
    });

    // Monitor task: race child.wait() against the cancel signal.
    let app_done = app.clone();
    tokio::spawn(async move {
        let start = Instant::now();
        let (exit_code, cancelled) = tokio::select! {
            // Child exited on its own.
            result = child.wait() => {
                match result {
                    Ok(status) => (status.code().unwrap_or(-1), false),
                    Err(_) => (-1, false),
                }
            }
            // Cancel signal received — kill the child and reap.
            _ = cancel_rx => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                (-1, true)
            }
        };

        let duration_seconds = start.elapsed().as_secs();

        // Clear the cancel tx before emitting done so a Cancel click
        // after the process exits doesn't dangle a stale channel.
        {
            let state_lock = install_state().clone();
            let mut guard = state_lock.lock().await;
            guard.cancel_tx = None;
        }
        INSTALLING.store(false, Ordering::SeqCst);

        let _ = app_done.emit(
            "setup://pyannote-install-done",
            InstallDoneEvent {
                exit_code,
                duration_seconds,
                cancelled,
            },
        );
    });

    Ok(())
}

/// Kill a running pyannote install. No-op if nothing is running.
///
/// The install task will observe the cancel signal, kill the child, reap
/// it, and emit a terminal `setup://pyannote-install-done` event with
/// `cancelled: true`. The UI transitions through the same done-path it
/// would for an exit.
#[tauri::command]
pub async fn cancel_pyannote_install() -> Result<(), String> {
    let state_lock = install_state().clone();
    let mut guard = state_lock.lock().await;
    if let Some(tx) = guard.cancel_tx.take() {
        // Receiver may already be dropped if the child finished a frame
        // before we got here; that's fine — send() returns Err but the
        // behaviour we want (no-op when there's nothing to cancel) still
        // holds.
        let _ = tx.send(());
    }
    Ok(())
}

/// Returns the exact single-line command the user should paste into a
/// terminal if they prefer running the install manually. UI reads this
/// via `invoke('get_pyannote_install_command')` so there's only one
/// source of truth for the install's version pins.
#[tauri::command]
pub fn get_pyannote_install_command() -> String {
    manual_command_string(install_config())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_manual_command_is_single_line_with_cu126() {
        let s = manual_command_string(&PYANNOTE_INSTALL_GPU);
        assert!(s.contains("py -3.11"), "should start with py -3.11: {s}");
        assert!(s.contains("-m pip install"), "should -m pip install: {s}");
        assert!(s.contains("--force-reinstall"), "missing --force-reinstall: {s}");
        assert!(s.contains("torch==2.8.0"), "missing torch pin: {s}");
        assert!(s.contains("torchaudio==2.8.0"), "missing torchaudio pin: {s}");
        assert!(s.contains("pyannote.audio"), "missing pyannote.audio: {s}");
        assert!(
            s.contains("https://download.pytorch.org/whl/cu126"),
            "missing cu126 index: {s}",
        );
        assert!(!s.contains('\n'), "should be a single line: {s}");
    }

    #[test]
    fn cpu_manual_command_has_no_index_url() {
        let s = manual_command_string(&PYANNOTE_INSTALL_CPU);
        assert!(s.contains("torch==2.8.0"), "missing torch pin: {s}");
        assert!(s.contains("pyannote.audio"), "missing pyannote.audio: {s}");
        assert!(!s.contains("--index-url"), "CPU should not pass --index-url: {s}");
    }

    #[test]
    fn pip_args_contain_force_reinstall() {
        let args = pip_args(&PYANNOTE_INSTALL_GPU);
        assert!(
            args.iter().any(|a| a == "--force-reinstall"),
            "--force-reinstall missing: {args:?}",
        );
    }

    /// Regression pin for the "`No matching distribution found for
    /// pyannote.audio`" bug. `--index-url` replaces PyPI; we need
    /// `--extra-index-url` so pyannote.audio still resolves from PyPI
    /// while torch comes from the CUDA channel. Compared against the
    /// args Vec at element granularity so we don't false-negative on
    /// the "--index-url" substring inside "--extra-index-url".
    #[test]
    fn gpu_pip_args_uses_extra_index_not_replacement() {
        let args = pip_args(&PYANNOTE_INSTALL_GPU);
        assert!(
            args.iter().any(|a| a == "--extra-index-url"),
            "should pass --extra-index-url: {args:?}",
        );
        assert!(
            !args.iter().any(|a| a == "--index-url"),
            "must NOT pass --index-url (replaces PyPI, breaks pyannote resolution): {args:?}",
        );
    }

    /// Same pin at the "Show me the command" tab: the user-facing manual
    /// command must match what the subprocess actually runs. Tokenised on
    /// whitespace so "--extra-index-url" doesn't leak a false match for
    /// the "--index-url" substring.
    #[test]
    fn gpu_manual_command_uses_extra_index() {
        let cmd = manual_command_string(&PYANNOTE_INSTALL_GPU);
        let tokens: Vec<&str> = cmd.split_whitespace().collect();
        assert!(
            tokens.contains(&"--extra-index-url"),
            "should contain --extra-index-url: {cmd}",
        );
        assert!(
            !tokens.contains(&"--index-url"),
            "must NOT contain --index-url as a standalone flag: {cmd}",
        );
    }
}
