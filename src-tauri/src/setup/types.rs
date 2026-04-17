//! Serialisable types for the Guided Setup detection engine.
//!
//! A [`SetupState`] is produced on every call to [`crate::setup::detect`]. It
//! is the single source of truth for machine readiness — the wizard, the
//! Settings panel, and the mode selectors all derive their UI from this
//! struct. There is no persisted "setup_completed" flag; the state is
//! always re-computed live, which is what makes the wizard idempotent
//! (spec §22.4).
//!
//! All statuses serialise as snake_case strings so the TS frontend can match
//! on them without a bespoke decoder.

use serde::Serialize;

/// One of the four status codes a check can produce.
///
/// * `Ok` — the dependency is present and usable.
/// * `Missing` — the dependency is not present at all.
/// * `WrongVersion` — present but at a version the app cannot use.
/// * `Unknown` — the check did not run (an earlier check failed) or ran but
///   could not conclude (e.g. network failure during a remote check). The
///   UI treats these identically: render a muted dash, do not claim failure.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Missing,
    WrongVersion,
    Unknown,
}

/// Result of a single check.
///
/// `details` is check-specific and absent on `Missing` / `Unknown`. `message`
/// is a human-readable note attached to non-Ok statuses so the UI can
/// surface a reason without branching on the failure mode.
#[derive(Debug, Clone, Serialize)]
pub struct Check<D> {
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<D>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<D> Check<D> {
    pub fn ok(details: D) -> Self {
        Self {
            status: Status::Ok,
            details: Some(details),
            message: None,
        }
    }
    pub fn ok_with_note(details: D, message: impl Into<String>) -> Self {
        Self {
            status: Status::Ok,
            details: Some(details),
            message: Some(message.into()),
        }
    }
    pub fn missing(message: impl Into<String>) -> Self {
        Self {
            status: Status::Missing,
            details: None,
            message: Some(message.into()),
        }
    }
    pub fn wrong_version(details: D, message: impl Into<String>) -> Self {
        Self {
            status: Status::WrongVersion,
            details: Some(details),
            message: Some(message.into()),
        }
    }
    pub fn wrong_version_no_details(message: impl Into<String>) -> Self {
        Self {
            status: Status::WrongVersion,
            details: None,
            message: Some(message.into()),
        }
    }
    pub fn unknown() -> Self {
        Self {
            status: Status::Unknown,
            details: None,
            message: None,
        }
    }
    pub fn unknown_with_note(message: impl Into<String>) -> Self {
        Self {
            status: Status::Unknown,
            details: None,
            message: Some(message.into()),
        }
    }
    pub fn is_ok(&self) -> bool {
        matches!(self.status, Status::Ok)
    }
}

// ─── Per-check detail payloads ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct GpuDetails {
    pub name: String,
    pub driver_version: String,
    pub vram_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CudaDetails {
    /// "12.6", "12.1", etc.
    pub version_found: String,
    /// Absolute path to the CUDA `bin` directory. Passed through to the
    /// Whisper loader so cublas/cudart resolve deterministically rather than
    /// via PATH.
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PythonDetails {
    pub version: String,
    /// Absolute path to the Python 3.11 interpreter (`sys.executable`). This
    /// is stored so the sidecar and the wizard's pyannote-install step both
    /// invoke the exact same interpreter, bypassing PATH.
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PyannoteDetails {
    pub version: String,
    /// `torch.cuda.is_available()` at probe time. False means torch is
    /// installed but the CPU-only wheel is active; the wizard's remediation
    /// is to reinstall from the CUDA index.
    pub torch_cuda: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfTokenDetails {
    pub username: String,
}

/// Machine-readable discriminator for Check 6's failure modes (spec §22.3
/// Amendment 3). Distinct from `Status` because the four failure modes below
/// cannot be cleanly expressed by `Missing` / `WrongVersion` / `Unknown`
/// alone — the UI needs to render a different card per `failure_type`, and
/// the mapping is not one-to-one with `Status`.
///
/// Precedence (most severe first): `TokenInvalid` > `NetworkError` >
/// `UnexpectedResponse` > `LicenceNotAccepted`. When the two models probed
/// disagree, we report the more-severe outcome; see
/// `checks::hf_models::combine_failure_types`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HfModelsFailureType {
    /// At least one model returned HTTP 403 — the authenticated user has
    /// not accepted the pyannote licence on huggingface.co.
    LicenceNotAccepted,
    /// At least one model returned HTTP 401 — the token is invalid at
    /// model-check time despite Check 5 having earlier succeeded.
    TokenInvalid,
    /// Any 5xx / timeout / DNS / connection-refused / client-build error.
    NetworkError,
    /// Any 4xx other than 401/403, or other non-200 surprise. Treated as
    /// transient from the UI's perspective but isolated so a future wizard
    /// can render it differently from `NetworkError`.
    UnexpectedResponse,
}

#[derive(Debug, Clone, Serialize)]
pub struct HfModelsDetails {
    pub diarization: bool,
    pub segmentation: bool,
    /// Present on every non-Ok outcome; absent on `Ok`. The single source of
    /// truth the wizard reads to decide which remediation UI to render.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_type: Option<HfModelsFailureType>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WhisperDetails {
    pub path: String,
    pub size_mb: u64,
}

// ─── Derived state ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Derived {
    /// All of checks 1, 2, 7 are `Ok` (on GPU build). On CPU build, checks
    /// 1 and 2 are vacuously satisfied (no GPU stack required).
    pub can_use_transcribe: bool,
    /// Additionally checks 3, 4, 5, 6 are all `Ok`.
    pub can_use_speakers: bool,
    /// 1-based index (1..=7) of the first non-Ok check in the strict
    /// dependency order (GPU → CUDA → Python → pyannote → HF token →
    /// HF models → Whisper), or `None` when every applicable check is Ok.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocking_step: Option<u8>,
    /// "gpu" or "cpu" — the compile-time build variant. Tells the UI whether
    /// to render the GPU/CUDA rows at all.
    pub build_variant: &'static str,
}

// ─── Top-level state ──────────────────────────────────────────────────

/// The single object returned by the detection engine.
///
/// On a CPU build, `gpu` and `cuda` are `None` and omitted from JSON (skipped
/// via `skip_serializing_if`). The other five checks are always present.
#[derive(Debug, Clone, Serialize)]
pub struct SetupState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<Check<GpuDetails>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cuda: Option<Check<CudaDetails>>,
    pub python: Check<PythonDetails>,
    pub pyannote: Check<PyannoteDetails>,
    pub hf_token: Check<HfTokenDetails>,
    pub hf_models: Check<HfModelsDetails>,
    pub whisper: Check<WhisperDetails>,
    pub derived: Derived,
}
