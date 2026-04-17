//! Check 3 — a Python 3.11.x interpreter reachable on this machine
//! (spec §22.3).
//!
//! We specifically require 3.11 rather than any modern Python because
//! pyannote + torch do not publish wheels for every Python version — 3.12
//! support is patchy and 3.14 has none. The friend's install that prompted
//! this section was broken precisely because only Python 3.14 was present.
//!
//! Probe order mirrors the sidecar launcher's so the wizard and the launcher
//! don't disagree on which interpreter they're talking about.

use std::time::Duration;

use super::super::proc::run_capture;
use super::super::types::{Check, PythonDetails};

/// Candidates in preference order. On Windows, `py -3.11` (the Python
/// launcher) is the most reliable — it explicitly targets 3.11 even when
/// `python` on PATH is 3.14. `python3.11` works on Unix where a real
/// binary exists at that name. Bare `python` / `python3` only pass the
/// check if they happen to resolve to a 3.11.
const CANDIDATES: &[(&str, &[&str])] = &[
    ("py", &["-3.11"]),
    ("python3.11", &[]),
    ("python", &[]),
    ("python3", &[]),
];

pub fn check() -> Check<PythonDetails> {
    // Track the "best" non-3.11 version we find so Missing vs. WrongVersion
    // can be distinguished. WrongVersion → "3.11 can coexist with what you
    // have"; Missing → "install Python".
    let mut wrong_version_seen: Option<String> = None;

    for (cmd, args) in CANDIDATES {
        let Some(version) = probe_version(cmd, args) else {
            continue;
        };
        if is_three_eleven(&version) {
            let path = probe_sys_executable(cmd, args).unwrap_or_else(|| cmd.to_string());
            return Check::ok(PythonDetails { version, path });
        }
        // Keep the first non-3.11 version we see — subsequent candidates
        // are likely to be the same interpreter anyway.
        if wrong_version_seen.is_none() {
            wrong_version_seen = Some(version);
        }
    }

    if let Some(v) = wrong_version_seen {
        Check::wrong_version_no_details(format!(
            "Found Python {v} — Forti Fide requires 3.11 for pyannote. 3.11 can be installed alongside the existing version."
        ))
    } else {
        Check::missing("No Python interpreter found. Install Python 3.11 (and check 'Add Python to PATH' during setup).")
    }
}

fn is_three_eleven(v: &str) -> bool {
    v == "3.11" || v.starts_with("3.11.")
}

/// Runs `<cmd> <args> --version` and extracts the version number from the
/// banner ("Python 3.11.9" → "3.11.9"). Returns None on any invocation error.
fn probe_version(cmd: &str, args: &[&str]) -> Option<String> {
    let mut probe_args: Vec<&str> = args.to_vec();
    probe_args.push("--version");
    let output = run_capture(cmd, &probe_args, Duration::from_secs(3))?;
    if !output.status.success() {
        return None;
    }
    // --version writes to stdout on 3.4+, stderr on older; concatenate to be
    // robust to either.
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    let start = combined.find("Python ")?;
    let rest = &combined[start + "Python ".len()..];
    Some(rest.split(|c: char| c.is_whitespace()).next()?.to_string())
}

/// Returns `sys.executable` so downstream checks / sidecar launch can invoke
/// the exact same interpreter rather than re-resolving via PATH.
fn probe_sys_executable(cmd: &str, args: &[&str]) -> Option<String> {
    let mut probe_args: Vec<&str> = args.to_vec();
    probe_args.push("-c");
    probe_args.push("import sys; print(sys.executable)");
    let output = run_capture(cmd, &probe_args, Duration::from_secs(3))?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
