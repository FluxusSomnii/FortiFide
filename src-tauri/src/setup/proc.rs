//! Subprocess helpers for the detection engine.
//!
//! Mirrors the Python-probe helpers in `lib.rs` (`build_command`,
//! `wait_with_timeout`). Duplicated rather than shared so the setup module
//! has no upward dependency on `lib.rs`.
//!
//! On Windows, the `CREATE_NO_WINDOW` flag is applied so probes never flash
//! a console window at the user.

use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

pub(crate) fn build_command(cmd: &str, args: &[&str]) -> Command {
    let mut command = Command::new(cmd);
    command.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

/// Convenience wrapper: build, spawn, wait-with-timeout, capture stdout+stderr.
/// Returns `None` on any spawn / timeout / parse error.
pub(crate) fn run_capture(cmd: &str, args: &[&str], timeout: Duration) -> Option<Output> {
    let mut command = build_command(cmd, args);
    let child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    wait_with_timeout(child, timeout)
}

/// Poll-based wait so we don't block on a hung child. 50ms granularity is
/// fine; probes are on the order of seconds.
pub(crate) fn wait_with_timeout(mut child: Child, timeout: Duration) -> Option<Output> {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}
