//! Check 4 — `pyannote.audio` and `torch` (CUDA build) importable in the
//! Python 3.11 interpreter resolved by Check 3 (spec §22.3).
//!
//! Invokes the supplied interpreter with a `-c` probe that imports both
//! packages, reports `torch.cuda.is_available()`, and prints the pyannote
//! version. A timeout of 30s is generous but necessary — torch's first
//! import warms up CUDA backends and can take 10–15s on cold disks.

use std::time::Duration;

use super::super::proc::run_capture;
use super::super::types::{Check, PyannoteDetails};

/// Probe script. Prints three lines on success:
///   ok_import
///   True|False         ← torch.cuda.is_available()
///   <pyannote version>
/// Any import error → exit 2 with the repr on stderr.
const PROBE: &str = "\
import sys
try:
    import torch
    import pyannote.audio
except Exception as e:
    sys.stderr.write('import_error:' + repr(e))
    sys.exit(2)
print('ok_import')
print(torch.cuda.is_available())
print(pyannote.audio.__version__)
";

/// `python_path` is the absolute interpreter path from Check 3. Passing it
/// through explicitly means this check verifies the *same* interpreter the
/// sidecar will invoke at runtime, not whatever `python` happens to resolve
/// to from this process's PATH.
pub fn check(python_path: &str) -> Check<PyannoteDetails> {
    let Some(output) = run_capture(python_path, &["-c", PROBE], Duration::from_secs(30)) else {
        return Check::missing(
            "Python did not respond within 30s — pyannote import probe timed out.",
        );
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr
            .lines()
            .find(|l| l.starts_with("import_error:"))
            .map(|l| l.trim_start_matches("import_error:").to_string())
            .unwrap_or_else(|| "package not installed".to_string());
        return Check::missing(format!(
            "pyannote.audio / torch not importable ({reason}). Install torch+torchaudio from the CUDA index, then pyannote.audio."
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let marker = lines.next().unwrap_or("").trim();
    let cuda = lines.next().unwrap_or("").trim() == "True";
    let version = lines.next().unwrap_or("").trim().to_string();

    if marker != "ok_import" || version.is_empty() {
        return Check::missing("pyannote probe produced unexpected output.");
    }

    let details = PyannoteDetails {
        version: version.clone(),
        torch_cuda: cuda,
    };

    if !cuda {
        return Check::wrong_version(
            details,
            "torch was installed without CUDA support. Reinstall from --index-url https://download.pytorch.org/whl/cu121",
        );
    }
    if !meets_min_version(&version, 3, 1) {
        return Check::wrong_version(
            details,
            format!("pyannote.audio {version} is older than 3.1 — upgrade via pip."),
        );
    }
    Check::ok(details)
}

/// True when `v` parses as a dotted version ≥ `(min_major, min_minor)`.
fn meets_min_version(v: &str, min_major: u32, min_minor: u32) -> bool {
    let parts: Vec<u32> = v.split('.').filter_map(|p| p.parse().ok()).collect();
    if parts.is_empty() {
        return false;
    }
    let major = parts.first().copied().unwrap_or(0);
    let minor = parts.get(1).copied().unwrap_or(0);
    (major, minor) >= (min_major, min_minor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_parser_handles_release_and_prerelease() {
        assert!(meets_min_version("3.1.0", 3, 1));
        assert!(meets_min_version("3.2", 3, 1));
        assert!(meets_min_version("4.0.0", 3, 1));
        assert!(!meets_min_version("3.0.9", 3, 1));
        assert!(!meets_min_version("2.99.99", 3, 1));
        assert!(!meets_min_version("", 3, 1));
    }
}
