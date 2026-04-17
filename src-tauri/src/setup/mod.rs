//! Guided Setup detection engine (spec §22.3 / §22.4).
//!
//! Every invocation re-checks the machine from scratch and returns a
//! [`SetupState`]. The orchestrator enforces strict dependency ordering:
//! a check at position N does not run until checks 1..N-1 are `Ok`; checks
//! that don't run are marked `Unknown`. This is what makes the wizard
//! idempotent — there is no "setup_completed" flag to drift from reality.
//!
//! On the GPU build, seven checks run (GPU → CUDA → Python → pyannote →
//! HF token → HF models → Whisper). On the CPU build, GPU and CUDA are
//! omitted entirely (set to `None` in the resulting state and skipped from
//! JSON).
//!
//! Entry points:
//! * [`detect`] — the pure function, safe to call from any thread.
//! * [`get_setup_state`] — the Tauri command; wraps `detect` in
//!   `spawn_blocking` so it doesn't block the IPC runtime.
//! * [`maybe_run_cli_check`] — invoked from `run()`; if `--check-setup`
//!   is on the command line, print the state as pretty JSON and exit.

pub mod types;

mod checks;
// `pub` so lib.rs's generate_handler! can reference the commands via their
// full path (setup::install::*). We deliberately do *not* re-export the
// command fns here: `#[tauri::command]` generates hidden sibling items
// (`__cmd__<name>`) next to each command, and a function-level `pub use`
// does not pull those helpers through. The handler macro resolves the
// function and its __cmd__ sibling from the same path, so both must live
// in the same module at the call site — hence full-qualified references
// from lib.rs rather than re-exports here.
pub mod install;
mod proc;
mod util;

pub use types::SetupState;
use types::{
    Check, CudaDetails, Derived, GpuDetails, HfModelsDetails, HfTokenDetails,
    PyannoteDetails, PythonDetails, WhisperDetails,
};

use std::sync::{Mutex, OnceLock};

#[cfg(feature = "gpu")]
const BUILD_VARIANT: &str = "gpu";
#[cfg(not(feature = "gpu"))]
const BUILD_VARIANT: &str = "cpu";

// ─── Last-known Python-path cache ──────────────────────────────────────
//
// `detect()` side-effects the resolved Python 3.11 path into this cell on
// every run. The install command reads from it rather than re-running
// `detect()` — see install::start_install for why (re-running pulls in the
// HF checks which require an async context, and the previous implementation
// panicked when called from within the Tauri async command runtime).
//
// The cache is process-global and unsynchronised beyond the Mutex — there
// is at most one detect() in flight at a time in practice (the wizard
// serialises calls) and the cache just needs to reflect "whatever detect()
// most recently saw", not a consistent snapshot across threads.

static LAST_PYTHON_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn python_path_cache() -> &'static Mutex<Option<String>> {
    LAST_PYTHON_PATH.get_or_init(|| Mutex::new(None))
}

/// Returns the most recently resolved Python 3.11 path from a prior
/// `detect()` run, or `None` if detection has never succeeded. The install
/// command uses this instead of re-running detection (which would re-enter
/// the async-unsafe HF probe path from within a Tauri command).
pub(crate) fn cached_python_path() -> Option<String> {
    python_path_cache().lock().ok().and_then(|g| g.clone())
}

fn remember_python_path(path: Option<String>) {
    if let Ok(mut g) = python_path_cache().lock() {
        *g = path;
    }
}

/// Run all applicable checks and return the fully-populated state.
///
/// Async because Checks 5 & 6 use `reqwest::Client` (non-blocking). The
/// synchronous subprocess / filesystem checks (GPU, CUDA, Python, pyannote,
/// Whisper) are still called directly — they block the current task for
/// ~1–3s each, which is acceptable for a one-shot setup probe. Tauri's
/// default runtime is multi-threaded so one worker being blocked is fine;
/// the CLI path (`--check-setup`) builds a current-thread runtime and is
/// single-consumer by construction.
///
/// Never call `reqwest::blocking` from inside this function — it constructs
/// its own internal tokio runtime, which panics when the outer context is
/// already an async runtime (as it is whenever this is reached from a
/// Tauri command). Checks 5 & 6 must stay async.
pub async fn detect() -> SetupState {
    // ── Check 1: GPU (GPU build only) ──
    let gpu_check: Option<Check<GpuDetails>> = {
        #[cfg(feature = "gpu")]
        {
            Some(checks::gpu::check())
        }
        #[cfg(not(feature = "gpu"))]
        {
            None
        }
    };

    // ── Check 2: CUDA 12.x (GPU build only; gated on Check 1) ──
    let cuda_check: Option<Check<CudaDetails>> = {
        #[cfg(feature = "gpu")]
        {
            if gpu_check.as_ref().map(|c| c.is_ok()).unwrap_or(false) {
                Some(checks::cuda::check())
            } else {
                Some(Check::unknown())
            }
        }
        #[cfg(not(feature = "gpu"))]
        {
            None
        }
    };

    // `gpu_stack_ok` is vacuously true on CPU builds (no stack to satisfy)
    // and true on GPU builds iff both GPU and CUDA passed.
    let gpu_stack_ok: bool = match (&gpu_check, &cuda_check) {
        (Some(g), Some(c)) => g.is_ok() && c.is_ok(),
        _ => true,
    };

    // ── Check 3: Python 3.11 ──
    let python_check = if gpu_stack_ok {
        checks::python::check()
    } else {
        Check::unknown()
    };
    let python_path = python_check.details.as_ref().map(|d| d.path.clone());

    // Stash the resolved path so the install command can read it without
    // re-running detect(). See `cached_python_path` above for rationale.
    remember_python_path(python_path.clone());

    // ── Check 4: pyannote + torch CUDA ──
    let pyannote_check = match (python_check.is_ok(), python_path.as_deref()) {
        (true, Some(path)) => checks::pyannote::check(path),
        _ => Check::unknown(),
    };

    // ── Check 5: HF token ──
    // Runs unconditionally. Reading settings.json and (optionally) calling
    // HF's whoami-v2 has no runtime dependency on the Python / pyannote
    // stack; gating it on pyannote's state produced a user-facing bug
    // where "no Python 3.11 installed" surfaced as "network issue with
    // HuggingFace" because the orchestrator marked the check Unknown and
    // the action card interpreted Unknown as a connectivity failure.
    // Spec §22.3 Check 5 requires this check to return `Missing` when no
    // token is saved — which the check's own short-circuit handles — so
    // the orchestrator must actually invoke it.
    let (hf_token_check, token_value) = checks::hf_token::check().await;

    // ── Check 6: HF model licences ──
    let hf_models_check = match (hf_token_check.is_ok(), token_value.as_deref()) {
        (true, Some(tok)) => checks::hf_models::check(tok).await,
        _ => Check::<HfModelsDetails>::unknown(),
    };

    // ── Check 7: Whisper weights ──
    let whisper_check = if hf_models_check.is_ok() {
        checks::whisper::check()
    } else {
        Check::<WhisperDetails>::unknown()
    };

    let derived = derive(
        gpu_check.as_ref(),
        cuda_check.as_ref(),
        &python_check,
        &pyannote_check,
        &hf_token_check,
        &hf_models_check,
        &whisper_check,
    );

    SetupState {
        gpu: gpu_check,
        cuda: cuda_check,
        python: python_check,
        pyannote: pyannote_check,
        hf_token: hf_token_check,
        hf_models: hf_models_check,
        whisper: whisper_check,
        derived,
    }
}

/// Tauri command exposed to the frontend.
///
/// Awaited directly on Tauri's async runtime. The previous implementation
/// used `spawn_blocking(detect)` because `detect()` was a sync function
/// that internally called `reqwest::blocking` — that approach crashed
/// when the same `detect()` was reached through the install command (no
/// `spawn_blocking` wrapper there). Making `detect()` async is the real
/// fix; the spawn_blocking wrapper is now unnecessary and removed.
#[tauri::command]
pub async fn get_setup_state() -> Result<SetupState, String> {
    Ok(detect().await)
}

/// Called very early in [`crate::run`]. If the binary was invoked with
/// `--check-setup`, run detection, print the state as pretty JSON to stdout,
/// and exit 0 — intended for testing without launching the full Tauri UI.
///
/// Builds its own minimal current-thread tokio runtime (enable_all so the
/// HTTP I/O driver is available). This runs *before* Tauri's runtime is
/// constructed; on the `--check-setup` path we exit before Tauri starts,
/// so there is no runtime collision.
pub fn maybe_run_cli_check() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--check-setup") {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Failed to build tokio runtime for --check-setup: {e}");
                std::process::exit(1);
            }
        };
        let state = rt.block_on(detect());
        match serde_json::to_string_pretty(&state) {
            Ok(s) => println!("{s}"),
            Err(e) => eprintln!("Failed to serialize SetupState: {e}"),
        }
        std::process::exit(0);
    }
}

// ─── Derived state ────────────────────────────────────────────────────

fn derive(
    gpu: Option<&Check<GpuDetails>>,
    cuda: Option<&Check<CudaDetails>>,
    python: &Check<PythonDetails>,
    pyannote: &Check<PyannoteDetails>,
    hf_token: &Check<HfTokenDetails>,
    hf_models: &Check<HfModelsDetails>,
    whisper: &Check<WhisperDetails>,
) -> Derived {
    // Transcribe needs checks 1, 2, 7 (GPU + CUDA + Whisper). On CPU, 1 and
    // 2 are absent → vacuously satisfied; only Whisper matters.
    let gpu_ok = gpu.map(|c| c.is_ok()).unwrap_or(true);
    let cuda_ok = cuda.map(|c| c.is_ok()).unwrap_or(true);
    let can_use_transcribe = gpu_ok && cuda_ok && whisper.is_ok();

    // Speakers additionally requires Python + pyannote + HF token + HF
    // models. "Deep" (spec §22.2) is Claude-API-only; outside this engine's
    // scope because it's a user setting rather than a machine dependency.
    let can_use_speakers = can_use_transcribe
        && python.is_ok()
        && pyannote.is_ok()
        && hf_token.is_ok()
        && hf_models.is_ok();

    let blocking_step = find_blocking(
        gpu, cuda, python, pyannote, hf_token, hf_models, whisper,
    );

    Derived {
        can_use_transcribe,
        can_use_speakers,
        blocking_step,
        build_variant: BUILD_VARIANT,
    }
}

fn find_blocking(
    gpu: Option<&Check<GpuDetails>>,
    cuda: Option<&Check<CudaDetails>>,
    python: &Check<PythonDetails>,
    pyannote: &Check<PyannoteDetails>,
    hf_token: &Check<HfTokenDetails>,
    hf_models: &Check<HfModelsDetails>,
    whisper: &Check<WhisperDetails>,
) -> Option<u8> {
    if let Some(g) = gpu {
        if !g.is_ok() {
            return Some(1);
        }
    }
    if let Some(c) = cuda {
        if !c.is_ok() {
            return Some(2);
        }
    }
    if !python.is_ok() {
        return Some(3);
    }
    if !pyannote.is_ok() {
        return Some(4);
    }
    if !hf_token.is_ok() {
        return Some(5);
    }
    if !hf_models.is_ok() {
        return Some(6);
    }
    if !whisper.is_ok() {
        return Some(7);
    }
    None
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use types::*;

    fn ok_gpu() -> Check<GpuDetails> {
        Check::ok(GpuDetails {
            name: "test".into(),
            driver_version: "999.00".into(),
            vram_mb: 8192,
        })
    }
    fn ok_cuda() -> Check<CudaDetails> {
        Check::ok(CudaDetails {
            version_found: "12.6".into(),
            path: "".into(),
        })
    }
    fn ok_python() -> Check<PythonDetails> {
        Check::ok(PythonDetails {
            version: "3.11.9".into(),
            path: "py".into(),
        })
    }
    fn ok_pyannote() -> Check<PyannoteDetails> {
        Check::ok(PyannoteDetails {
            version: "3.1.1".into(),
            torch_cuda: true,
        })
    }
    fn ok_hf_token() -> Check<HfTokenDetails> {
        Check::ok(HfTokenDetails {
            username: "alice".into(),
        })
    }
    fn ok_hf_models() -> Check<HfModelsDetails> {
        Check::ok(HfModelsDetails {
            diarization: true,
            segmentation: true,
            // Amendment 3: Ok outcomes carry no failure_type; only non-Ok
            // results populate it.
            failure_type: None,
        })
    }
    fn ok_whisper() -> Check<WhisperDetails> {
        Check::ok(WhisperDetails {
            path: "".into(),
            size_mb: 3000,
        })
    }

    #[test]
    fn all_ok_on_gpu_build() {
        let d = derive(
            Some(&ok_gpu()),
            Some(&ok_cuda()),
            &ok_python(),
            &ok_pyannote(),
            &ok_hf_token(),
            &ok_hf_models(),
            &ok_whisper(),
        );
        assert!(d.can_use_transcribe);
        assert!(d.can_use_speakers);
        assert!(d.blocking_step.is_none());
    }

    #[test]
    fn all_ok_on_cpu_build() {
        let d = derive(
            None,
            None,
            &ok_python(),
            &ok_pyannote(),
            &ok_hf_token(),
            &ok_hf_models(),
            &ok_whisper(),
        );
        assert!(d.can_use_transcribe);
        assert!(d.can_use_speakers);
        assert!(d.blocking_step.is_none());
    }

    #[test]
    fn cpu_build_transcribe_only_when_speakers_deps_missing() {
        let d = derive(
            None,
            None,
            &Check::<PythonDetails>::missing("x"),
            &Check::<PyannoteDetails>::unknown(),
            &Check::<HfTokenDetails>::unknown(),
            &Check::<HfModelsDetails>::unknown(),
            &ok_whisper(),
        );
        assert!(d.can_use_transcribe);
        assert!(!d.can_use_speakers);
        assert_eq!(d.blocking_step, Some(3));
    }

    #[test]
    fn gpu_build_cuda_missing_blocks_at_2() {
        let d = derive(
            Some(&ok_gpu()),
            Some(&Check::<CudaDetails>::missing("x")),
            &Check::<PythonDetails>::unknown(),
            &Check::<PyannoteDetails>::unknown(),
            &Check::<HfTokenDetails>::unknown(),
            &Check::<HfModelsDetails>::unknown(),
            &Check::<WhisperDetails>::unknown(),
        );
        assert!(!d.can_use_transcribe);
        assert!(!d.can_use_speakers);
        assert_eq!(d.blocking_step, Some(2));
    }

    #[test]
    fn whisper_missing_on_gpu_blocks_at_7_but_all_earlier_ok() {
        let d = derive(
            Some(&ok_gpu()),
            Some(&ok_cuda()),
            &ok_python(),
            &ok_pyannote(),
            &ok_hf_token(),
            &ok_hf_models(),
            &Check::<WhisperDetails>::missing("x"),
        );
        assert!(!d.can_use_transcribe);
        assert!(!d.can_use_speakers);
        assert_eq!(d.blocking_step, Some(7));
    }

    #[test]
    fn hf_token_ok_but_models_unaccepted_blocks_at_6() {
        let d = derive(
            Some(&ok_gpu()),
            Some(&ok_cuda()),
            &ok_python(),
            &ok_pyannote(),
            &ok_hf_token(),
            &Check::<HfModelsDetails>::missing("accept licences"),
            &ok_whisper(),
        );
        // Transcribe only requires checks 1,2,7 — all Ok here.
        assert!(d.can_use_transcribe);
        assert!(!d.can_use_speakers);
        assert_eq!(d.blocking_step, Some(6));
    }
}
