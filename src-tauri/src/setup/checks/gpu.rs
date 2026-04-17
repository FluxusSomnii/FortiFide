//! Check 1 — NVIDIA GPU, driver version, and VRAM (spec §22.3).
//!
//! Runs `nvidia-smi` with a CSV query so we get name/driver/VRAM in a
//! single line without parsing the human-formatted default output.
//! Falls back to the canonical Windows install path when the bare
//! executable isn't on PATH (e.g. constrained child shells), mirroring
//! `probe_nvidia_smi` in `lib.rs`.

use std::time::Duration;

use super::super::proc::run_capture;
use super::super::types::{Check, GpuDetails};

/// CUDA 12.x runtime requires driver ≥ 525 (per NVIDIA's compatibility
/// matrix). Older drivers cannot load the 12.x runtime at all, even if the
/// DLLs are present.
const MIN_DRIVER_MAJOR: u32 = 525;

/// Whisper large-v3 will OOM on cards below 4GB; below 6GB is a soft warning
/// per spec §22.3.
const MIN_VRAM_MB_HARD: u64 = 4_096;
const MIN_VRAM_MB_SOFT: u64 = 6_144;

pub fn check() -> Check<GpuDetails> {
    let args = [
        "--query-gpu=name,driver_version,memory.total",
        "--format=csv,noheader,nounits",
    ];

    let output = run_capture("nvidia-smi", &args, Duration::from_secs(3)).or_else(|| {
        // Some environments (pnpm child shells, installer-spawned processes)
        // don't inherit System32 on PATH. Fall back to the absolute path.
        #[cfg(target_os = "windows")]
        {
            run_capture(
                r"C:\Windows\System32\nvidia-smi.exe",
                &args,
                Duration::from_secs(3),
            )
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    });

    let Some(output) = output else {
        return Check::missing(
            "nvidia-smi not runnable — no NVIDIA driver detected. Install the NVIDIA driver.",
        );
    };
    if !output.status.success() {
        return Check::missing("nvidia-smi returned a non-zero exit code — driver may be unhealthy.");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout.lines().find(|l| !l.trim().is_empty()) else {
        return Check::missing("nvidia-smi returned no GPU entries.");
    };

    // e.g. "NVIDIA GeForce RTX 3080, 546.33, 10240"
    let fields: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if fields.len() < 3 {
        return Check::missing("nvidia-smi output could not be parsed.");
    }
    let name = fields[0].to_string();
    let driver_version = fields[1].to_string();
    let vram_mb: u64 = fields[2].parse().unwrap_or(0);

    let major: u32 = driver_version
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let details = GpuDetails {
        name: name.clone(),
        driver_version: driver_version.clone(),
        vram_mb,
    };

    if major < MIN_DRIVER_MAJOR {
        return Check::wrong_version(
            details,
            format!(
                "Driver {driver_version} is older than {MIN_DRIVER_MAJOR}.x — CUDA 12 runtime requires a newer driver."
            ),
        );
    }
    if vram_mb < MIN_VRAM_MB_HARD {
        return Check::wrong_version(
            details,
            format!(
                "GPU has {vram_mb}MB VRAM — Whisper large-v3 requires at least {MIN_VRAM_MB_HARD}MB."
            ),
        );
    }
    if vram_mb < MIN_VRAM_MB_SOFT {
        // Spec: "warning, but allow continuation". Represent as Ok + note
        // so the wizard can surface it without blocking.
        return Check::ok_with_note(
            details,
            format!(
                "GPU has {vram_mb}MB VRAM — Whisper large-v3 may run out of memory on cards below 6GB."
            ),
        );
    }
    Check::ok(details)
}
