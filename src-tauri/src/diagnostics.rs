//! Crash diagnostics: file logging, panic hook, crash sentinel, and
//! a zip-packaging command for the React crash-recovery dialog.
//!
//! Design:
//!   - Logs tee to `~/.fides/logs/fortifide-YYYY-MM-DD.log`, capped at 5 files.
//!   - A `.running` sentinel is written on startup, deleted on clean shutdown.
//!     If present on next launch → previous session crashed.
//!   - On crash detection the UI shows a dialog; "Save report" zips
//!     `~/.fides/logs/` + system info to the user's Desktop.
//!   - Nothing is sent anywhere automatically (sovereignty principle).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ─── Paths ──────────────────────────────────────────────────────────────────

fn fides_dir() -> PathBuf {
    let home = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into())
    } else {
        std::env::var("HOME").unwrap_or_else(|_| ".".into())
    };
    PathBuf::from(home).join(".fides")
}

fn logs_dir() -> PathBuf {
    fides_dir().join("logs")
}

fn sentinel_path() -> PathBuf {
    fides_dir().join(".running")
}

fn today_log_path() -> PathBuf {
    let date = chrono_lite_today();
    logs_dir().join(format!("fortifide-{date}.log"))
}

/// Simple YYYY-MM-DD without pulling in the `chrono` crate.
fn chrono_lite_today() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    // Epoch is 1970-01-01. Walk year/month/day.
    let (y, m, d) = epoch_days_to_ymd(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

fn epoch_days_to_ymd(mut days: i64) -> (i32, u32, u32) {
    // Algorithm from Howard Hinnant (public domain).
    days += 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

// ─── File logger ────────────────────────────────────────────────────────────

static LOG_FILE: Mutex<Option<fs::File>> = Mutex::new(None);

/// Initialise the file logger: create the logs dir, open today's log file in
/// append mode, prune old files, install the panic hook. Call once at startup.
pub fn init() {
    let dir = logs_dir();
    let _ = fs::create_dir_all(&dir);

    // Open log file (append mode).
    if let Ok(f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(today_log_path())
    {
        *LOG_FILE.lock().unwrap() = Some(f);
    }

    // Prune: keep only the 5 most recent log files.
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension().and_then(|e| e.to_str()) == Some("log")
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map_or(false, |n| n.starts_with("fortifide-"))
            })
            .collect();
        files.sort();
        while files.len() > 5 {
            if let Some(old) = files.first() {
                let _ = fs::remove_file(old);
            }
            files.remove(0);
        }
    }

    // Install panic hook — writes to the log file before the default handler
    // (which aborts/unwinds). This captures Rust panics; hard crashes
    // (CUDA driver kill, access violation) bypass this but the log file
    // still has everything up to that point.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("[PANIC] {info}");
        eprintln!("{msg}");
        write_log(&msg);
        // Also try to capture a backtrace.
        let bt = std::backtrace::Backtrace::force_capture();
        let bt_msg = format!("[PANIC] Backtrace:\n{bt}");
        eprintln!("{bt_msg}");
        write_log(&bt_msg);
        default_hook(info);
    }));

    println!("[DIAG] Logger initialised at {}", logs_dir().display());
}

/// Append a line to today's log file. Thread-safe, best-effort (never panics
/// or blocks the caller on IO errors).
pub fn write_log(line: &str) {
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(ref mut f) = *guard {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let _ = writeln!(f, "[{ts}] {line}");
            let _ = f.flush();
        }
    }
}

/// Macro-free tee: write a line to both stdout AND the log file.
pub fn log_println(line: &str) {
    println!("{line}");
    write_log(line);
}

/// Same for stderr.
pub fn log_eprintln(line: &str) {
    eprintln!("{line}");
    write_log(line);
}

// ─── Crash sentinel ─────────────────────────────────────────────────────────

/// Returns true if a previous session crashed (sentinel file exists).
/// Clears the sentinel for this session.
pub fn check_and_clear_crash() -> bool {
    let path = sentinel_path();
    let crashed = path.exists();
    if crashed {
        let _ = fs::remove_file(&path);
    }
    crashed
}

/// Write the sentinel. Call at startup after `check_and_clear_crash`.
pub fn write_sentinel() {
    let path = sentinel_path();
    let _ = fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
    let _ = fs::write(&path, format!("pid={}", std::process::id()));
}

/// Remove the sentinel on clean shutdown.
pub fn remove_sentinel() {
    let _ = fs::remove_file(sentinel_path());
}

// ─── System info ────────────────────────────────────────────────────────────

/// Collect system info as a human-readable string.
pub fn collect_system_info() -> String {
    let mut lines = Vec::new();
    lines.push(format!("Forti Fide v{}", env!("CARGO_PKG_VERSION")));
    lines.push(format!("Build variant: {}", super::BUILD_VARIANT));
    lines.push(format!("OS: {}", std::env::consts::OS));
    lines.push(format!("Arch: {}", std::env::consts::ARCH));

    // Windows version
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .output()
        {
            let ver = String::from_utf8_lossy(&out.stdout);
            lines.push(format!("Windows: {}", ver.trim()));
        }
    }

    // GPU
    if let Ok(out) = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"])
        .output()
    {
        let gpu = String::from_utf8_lossy(&out.stdout);
        if !gpu.trim().is_empty() {
            lines.push(format!("GPU: {}", gpu.trim()));
        }
    } else {
        // Try System32 fallback
        #[cfg(target_os = "windows")]
        {
            if let Ok(out) = std::process::Command::new(r"C:\Windows\System32\nvidia-smi.exe")
                .args(["--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"])
                .output()
            {
                let gpu = String::from_utf8_lossy(&out.stdout);
                if !gpu.trim().is_empty() {
                    lines.push(format!("GPU: {}", gpu.trim()));
                }
            }
        }
    }

    // CUDA
    if let Ok(out) = std::process::Command::new("nvcc").arg("--version").output() {
        let cuda = String::from_utf8_lossy(&out.stdout);
        for l in cuda.lines() {
            if l.contains("release") || l.contains("Build") {
                lines.push(format!("CUDA: {}", l.trim()));
            }
        }
    }

    // Python
    if let Ok(out) = std::process::Command::new("python").arg("--version").output() {
        let py = String::from_utf8_lossy(&out.stdout);
        lines.push(format!("Python: {}", py.trim()));
    }

    lines.join("\n")
}

// ─── Zip packager ───────────────────────────────────────────────────────────

/// Package `~/.fides/logs/` + system info into a zip on the user's Desktop.
/// Returns the path to the created zip, or an error string.
pub fn package_diagnostic_report() -> Result<String, String> {
    let logs = logs_dir();
    let desktop = desktop_path();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let zip_name = format!("fortifide-diagnostic-{ts}.zip");
    let zip_path = desktop.join(&zip_name);

    // We use a minimal hand-rolled ZIP writer (store-only, no compression)
    // to avoid adding a crate dependency. Log files are small text — the OS
    // or email client compresses anyway.
    let mut zip = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip: {e}"))?;

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();

    // System info
    entries.push(("system-info.txt".into(), collect_system_info().into_bytes()));

    // Log files (most recent 5, already pruned on startup)
    if let Ok(dir) = fs::read_dir(&logs) {
        for entry in dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("log") {
                if let Ok(content) = fs::read(&path) {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                    entries.push((format!("logs/{name}"), content));
                }
            }
        }
    }

    // Write a minimal ZIP (store-only, no compression).
    write_zip(&mut zip, &entries).map_err(|e| format!("Failed to write zip: {e}"))?;

    Ok(zip_path.to_string_lossy().into_owned())
}

fn desktop_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return PathBuf::from(profile).join("Desktop");
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Desktop");
    }
    PathBuf::from(".")
}

/// Minimal store-only ZIP writer. No external crate.
fn write_zip(out: &mut fs::File, entries: &[(String, Vec<u8>)]) -> std::io::Result<()> {
    // Local file headers + data
    let mut central_dir = Vec::new();
    let mut offset: u32 = 0;

    for (name, data) in entries {
        let name_bytes = name.as_bytes();
        let crc = crc32(data);

        // Local file header (30 bytes + name)
        out.write_all(&[0x50, 0x4b, 0x03, 0x04])?; // signature
        out.write_all(&(20u16).to_le_bytes())?; // version needed
        out.write_all(&(0u16).to_le_bytes())?; // flags
        out.write_all(&(0u16).to_le_bytes())?; // compression: store
        out.write_all(&(0u16).to_le_bytes())?; // mod time
        out.write_all(&(0u16).to_le_bytes())?; // mod date
        out.write_all(&crc.to_le_bytes())?;
        out.write_all(&(data.len() as u32).to_le_bytes())?; // compressed size
        out.write_all(&(data.len() as u32).to_le_bytes())?; // uncompressed size
        out.write_all(&(name_bytes.len() as u16).to_le_bytes())?;
        out.write_all(&(0u16).to_le_bytes())?; // extra field len
        out.write_all(name_bytes)?;
        out.write_all(data)?;

        let local_header_size = 30 + name_bytes.len() as u32 + data.len() as u32;

        // Central directory entry (46 bytes + name)
        central_dir.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02]);
        central_dir.extend_from_slice(&(20u16).to_le_bytes()); // version made by
        central_dir.extend_from_slice(&(20u16).to_le_bytes()); // version needed
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // flags
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // compression
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // mod time
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // mod date
        central_dir.extend_from_slice(&crc.to_le_bytes());
        central_dir.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central_dir.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // extra
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // comment
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // disk number start
        central_dir.extend_from_slice(&(0u16).to_le_bytes()); // internal attrs
        central_dir.extend_from_slice(&(0u32).to_le_bytes()); // external attrs
        central_dir.extend_from_slice(&offset.to_le_bytes()); // local header offset
        central_dir.extend_from_slice(name_bytes);

        offset += local_header_size;
    }

    let cd_offset = offset;
    let cd_size = central_dir.len() as u32;
    out.write_all(&central_dir)?;

    // End of central directory record
    out.write_all(&[0x50, 0x4b, 0x05, 0x06])?;
    out.write_all(&(0u16).to_le_bytes())?; // disk number
    out.write_all(&(0u16).to_le_bytes())?; // disk with cd
    out.write_all(&(entries.len() as u16).to_le_bytes())?;
    out.write_all(&(entries.len() as u16).to_le_bytes())?;
    out.write_all(&cd_size.to_le_bytes())?;
    out.write_all(&cd_offset.to_le_bytes())?;
    out.write_all(&(0u16).to_le_bytes())?; // comment length

    Ok(())
}

/// CRC-32 (ISO 3309 / ZIP). Table-based, no crate.
fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for i in 0..256u32 {
            let mut c = i;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 };
            }
            t[i as usize] = c;
        }
        t
    });
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}
