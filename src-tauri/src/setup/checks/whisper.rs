//! Check 7 — Whisper large-v3 model weights present at the expected path
//! with approximately the expected file size (spec §22.3).
//!
//! File size is checked against a tolerance band rather than an exact
//! checksum: partial downloads (the failure mode we care about) are
//! aggressively smaller than the real file; a correct file should fall
//! comfortably within the band. Tight checksums would require keeping a
//! pinned hash here and churning it whenever ggerganov reissues the file.

use super::super::types::{Check, WhisperDetails};

/// ggml-large-v3.bin is ~3094 MiB. The band allows for any legitimate
/// reissue while excluding obviously-truncated files.
const MIN_SIZE_MB: u64 = 2_800;
const MAX_SIZE_MB: u64 = 3_300;

pub fn check() -> Check<WhisperDetails> {
    let path = crate::audio::model_path();
    let path_str = path.to_string_lossy().into_owned();

    let metadata = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => {
            return Check::missing(format!(
                "Whisper model not found at {path_str}. Download Whisper large-v3 (~3.1GB)."
            ));
        }
    };

    let size_mb = metadata.len() / (1024 * 1024);
    let details = WhisperDetails {
        path: path_str,
        size_mb,
    };

    if size_mb < MIN_SIZE_MB {
        return Check::wrong_version(
            details,
            format!(
                "Model file is only {size_mb}MB — expected ≥ {MIN_SIZE_MB}MB. Partial download; re-download."
            ),
        );
    }
    if size_mb > MAX_SIZE_MB {
        return Check::wrong_version(
            details,
            format!(
                "Model file is {size_mb}MB — expected ≤ {MAX_SIZE_MB}MB. Verify file integrity."
            ),
        );
    }

    Check::ok(details)
}
