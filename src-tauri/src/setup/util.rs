//! Small helpers shared across the setup checks.

use std::path::PathBuf;

/// Platform home directory. Mirrors `audio::dirs_next` so HF-token /
/// Whisper-weight lookups don't drift from the rest of the app.
pub(super) fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}
