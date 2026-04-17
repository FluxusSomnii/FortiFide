//! The seven dependency checks (spec §22.3).
//!
//! Each submodule exposes a blocking `check(...)` function that returns a
//! `Check<Details>` specific to that step. None of them decide whether they
//! should run; the orchestrator in `super::detect` enforces the strict
//! dependency order.
//!
//! GPU and CUDA are gated behind the `gpu` feature — on a CPU build they
//! are not compiled at all, which keeps the CPU artefact free of Windows
//! `LoadLibraryExW` code paths that aren't reachable anyway.

#[cfg(feature = "gpu")]
pub mod cuda;
#[cfg(feature = "gpu")]
pub mod gpu;
pub mod hf_models;
pub mod hf_token;
pub mod pyannote;
pub mod python;
pub mod whisper;
