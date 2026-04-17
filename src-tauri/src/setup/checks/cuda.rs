//! Check 2 — CUDA 12.x runtime DLLs present and loadable (spec §22.3).
//!
//! Direct filesystem probe at the standard CUDA Toolkit install layout,
//! then `LoadLibraryExW` against the absolute DLL path to confirm Windows
//! can actually load it. PATH is deliberately *not* consulted — when
//! multiple CUDA versions coexist, PATH resolution is unreliable, and the
//! whole reason this check exists is that users with CUDA 13 had Forti Fide
//! pick up the wrong runtime.
//!
//! When no CUDA 12.x is found but some CUDA is installed (the common case
//! that prompted this section — CUDA 13), we surface a distinct
//! `WrongVersion` result so the wizard can say "install 12.6 alongside"
//! rather than "install CUDA Toolkit".

#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};

use super::super::types::{Check, CudaDetails};

#[cfg(target_os = "windows")]
const CUDA_ROOT: &str = r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA";

/// Walk from v12.9 down to v12.0 so the most recent 12.x install wins.
#[cfg(target_os = "windows")]
const MINOR_VERSIONS: &[u32] = &[9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

pub fn check() -> Check<CudaDetails> {
    #[cfg(not(target_os = "windows"))]
    {
        // The GPU build is currently Windows-only; on other hosts we can't
        // verify CUDA layout reliably, so report unknown rather than lie.
        Check::unknown_with_note(
            "CUDA detection is Windows-only in this build.",
        )
    }

    #[cfg(target_os = "windows")]
    {
        for minor in MINOR_VERSIONS {
            let dir = PathBuf::from(CUDA_ROOT)
                .join(format!("v12.{minor}"))
                .join("bin");
            let cublas = dir.join("cublas64_12.dll");
            let cudart = dir.join("cudart64_12.dll");
            if cublas.exists() && cudart.exists() {
                // Filesystem check passed — confirm Windows can actually
                // load the DLL (catches broken installs where a file exists
                // but one of its dependencies is missing from disk).
                let details = CudaDetails {
                    version_found: format!("12.{minor}"),
                    path: dir.to_string_lossy().into_owned(),
                };
                if try_load_exw(&cublas) && try_load_exw(&cudart) {
                    return Check::ok(details);
                } else {
                    return Check::wrong_version(
                        details,
                        format!(
                            "CUDA 12.{minor} DLLs found on disk but could not be loaded — install may be broken."
                        ),
                    );
                }
            }
        }

        // No 12.x found. Is there any CUDA at all? (If yes, the user is the
        // "installed CUDA 13" case the wizard has a specific message for.)
        if let Some(found) = detect_any_cuda_version() {
            Check::wrong_version_no_details(format!(
                "CUDA {found} is installed, but Forti Fide requires CUDA 12.x. Install CUDA 12.6 alongside — it coexists with newer versions."
            ))
        } else {
            Check::missing(
                "CUDA Toolkit 12.x not found. Install CUDA 12.6 from developer.nvidia.com.",
            )
        }
    }
}

/// `LoadLibraryExW` with `LOAD_WITH_ALTERED_SEARCH_PATH` so dependencies
/// (e.g. cublas depending on cudart) resolve from the DLL's own directory
/// rather than from the process's current directory or PATH. This matches
/// how the Whisper loader should resolve CUDA at runtime once Prompt 2's
/// `SetDllDirectoryW` integration lands.
#[cfg(target_os = "windows")]
fn try_load_exw(path: &Path) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};

    let wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        LoadLibraryExW(
            PCWSTR(wide.as_ptr()),
            None,
            LOAD_WITH_ALTERED_SEARCH_PATH,
        )
        .is_ok()
    }
}

/// Scan `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\` for any
/// `v<major>.<minor>` directory and return the highest version string
/// found. Used only to produce a better failure message when 12.x is not
/// installed but some other CUDA is.
#[cfg(target_os = "windows")]
fn detect_any_cuda_version() -> Option<String> {
    let entries = std::fs::read_dir(CUDA_ROOT).ok()?;
    let mut latest: Option<(u32, u32)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(stripped) = name.strip_prefix('v') {
            let parts: Vec<&str> = stripped.split('.').collect();
            if parts.len() == 2 {
                if let (Ok(maj), Ok(min)) =
                    (parts[0].parse::<u32>(), parts[1].parse::<u32>())
                {
                    let key = (maj, min);
                    if latest.map_or(true, |prev| key > prev) {
                        latest = Some(key);
                    }
                }
            }
        }
    }
    latest.map(|(m, n)| format!("{m}.{n}"))
}
