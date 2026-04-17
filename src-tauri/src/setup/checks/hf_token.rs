//! Check 5 — HuggingFace token present in settings and valid (spec §22.3).
//!
//! Reads `huggingFaceToken` from `~/.fides/fides-settings.json` (the same
//! key the Node and Python sidecars read, see
//! `sidecar/rhetorical-server.ts` and `sidecar/diarize_server.py`), then
//! calls HF's `whoami-v2` to confirm the token is live.
//!
//! Returns both the `Check` *and* the raw token so Check 6 can re-use it
//! without re-reading the file.
//!
//! Async intentionally: this is called from the detect() orchestrator which
//! itself runs inside Tauri's async runtime. `reqwest::blocking` cannot be
//! used here — its internal tokio runtime cannot be constructed inside
//! another async context and panics at runtime (see install.rs:187 history
//! for the crash that forced this change).

use std::path::PathBuf;
use std::time::Duration;

use super::super::types::{Check, HfTokenDetails};
use super::super::util::home_dir;

pub async fn check() -> (Check<HfTokenDetails>, Option<String>) {
    // Settings read first, unconditionally. When the file is missing, the
    // key is absent, or the key is present but empty/whitespace, we return
    // `Missing` with the spec-mandated message and skip the HTTP probe.
    // This is the short-circuit spec §22.3 Check 5 requires — it means the
    // wizard's action card sees `Missing` (render the token input) rather
    // than `Unknown` (render the network-error retry state) for a user who
    // has simply never saved a token.
    let token = match load_token() {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            return (Check::missing("Hugging Face token not set"), None);
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return (
                Check::unknown_with_note("Could not build HTTP client to validate HF token."),
                Some(token),
            );
        }
    };

    let response = client
        .get("https://huggingface.co/api/whoami-v2")
        .bearer_auth(&token)
        .send()
        .await;

    match response {
        Ok(r) if r.status().is_success() => {
            let username = r
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            (Check::ok(HfTokenDetails { username }), Some(token))
        }
        Ok(r) if r.status().as_u16() == 401 => (
            Check::wrong_version_no_details(
                "HuggingFace rejected the token (401). Replace it with a current read-scope token.",
            ),
            Some(token),
        ),
        Ok(r) => (
            // Unknown: HF reachable but responded unexpectedly. Don't tell
            // the user their token is bad; we can't conclude that.
            Check::unknown_with_note(format!(
                "HuggingFace returned status {} when validating the token — retry.",
                r.status().as_u16()
            )),
            Some(token),
        ),
        Err(e) => (
            Check::unknown_with_note(format!(
                "Could not reach huggingface.co: {e}. Check network and retry."
            )),
            Some(token),
        ),
    }
}

fn load_token() -> Option<String> {
    let path: PathBuf = home_dir()?.join(".fides").join("fides-settings.json");
    let raw = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("huggingFaceToken")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}
