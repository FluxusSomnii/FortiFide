pub mod loopback;
pub mod microphone;
pub mod retranscribe;
pub mod transcriber;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::watch;

use transcriber::Transcriber;

/// Which audio source(s) to capture.
#[derive(Debug, Clone, PartialEq)]
pub enum AudioSource {
    Microphone,
    Loopback,
    Both,
}

impl AudioSource {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "microphone" => Some(Self::Microphone),
            "loopback" => Some(Self::Loopback),
            "both" => Some(Self::Both),
            _ => None,
        }
    }
}

/// Progress payload for model download events.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ModelDownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// Status of the Whisper model.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub path: String,
    pub size_mb: u64,
}

/// Manages audio capture threads and the Whisper transcriber.
pub struct AudioManager {
    stop_tx: Option<watch::Sender<bool>>,
    mic_handle: Option<std::thread::JoinHandle<()>>,
    loopback_handle: Option<std::thread::JoinHandle<()>>,
    transcriber: Option<Arc<Transcriber>>,
    is_running: bool,
}

impl AudioManager {
    pub fn new() -> Self {
        Self {
            stop_tx: None,
            mic_handle: None,
            loopback_handle: None,
            transcriber: None,
            is_running: false,
        }
    }

    pub fn is_running(&self) -> bool {
        self.is_running
    }

    /// Get the transcriber (loading model if needed).
    pub fn get_transcriber(&mut self, app_handle: tauri::AppHandle) -> Result<Arc<Transcriber>, String> {
        if self.transcriber.is_none() {
            let model = model_path();
            if !model.exists() {
                return Err("Model not downloaded".into());
            }
            self.load_model(&model.to_string_lossy(), app_handle)?;
        }
        self.transcriber.clone().ok_or_else(|| "Transcriber not available".into())
    }

    pub fn needs_model_load(&self) -> bool {
        self.transcriber.is_none()
    }

    /// Load the Whisper model. Call this before start().
    pub fn load_model(&mut self, model_path: &str, app_handle: tauri::AppHandle) -> Result<(), String> {
        let transcriber = Transcriber::new(model_path, app_handle)
            .map_err(|e| format!("Failed to load Whisper model: {e}"))?;
        self.transcriber = Some(Arc::new(transcriber));
        Ok(())
    }

    /// Start capturing audio from the given source(s).
    pub fn start(&mut self, source: AudioSource, mode: u8, record_audio: bool, mic_device: Option<String>, app_handle: tauri::AppHandle) -> Result<(), String> {
        if self.is_running {
            return Err("Audio capture already running".into());
        }

        let transcriber = self.transcriber.as_ref()
            .ok_or("Model not loaded — call load_model first")?
            .clone();

        // Set the capture mode before starting threads
        transcriber::set_capture_mode(mode);

        let (stop_tx, stop_rx) = watch::channel(false);
        self.stop_tx = Some(stop_tx);

        // Start audio archivers (only if Rec Audio is enabled)
        let audio_session_id = if record_audio {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let session_id = format!("live-{timestamp}");

            // Start mic archiver for mic or both modes
            if source == AudioSource::Microphone || source == AudioSource::Both {
                if let Ok(mut a) = transcriber.mic_archiver.lock() {
                    if let Err(e) = a.start(&session_id, "mic.wav") {
                        eprintln!("[AUDIO] Failed to start mic archiver: {e}");
                    }
                }
            }
            // Start system archiver for loopback or both modes
            if source == AudioSource::Loopback || source == AudioSource::Both {
                if let Ok(mut a) = transcriber.sys_archiver.lock() {
                    if let Err(e) = a.start(&session_id, "system.wav") {
                        eprintln!("[AUDIO] Failed to start system archiver: {e}");
                    }
                }
            }

            Some(session_id)
        } else {
            None
        };

        // Emit capturing status
        let _ = app_handle.emit("fides://capture-status", "capturing");

        // Emit the audio session ID so the frontend can link saved sessions to their audio files
        if let Some(ref aid) = audio_session_id {
            let _ = app_handle.emit("fides://audio-session-id", aid.as_str());
        }

        // Start microphone capture
        if source == AudioSource::Microphone || source == AudioSource::Both {
            let t = transcriber.clone();
            let rx = stop_rx.clone();
            let mic_dev = mic_device.clone();
            let handle = std::thread::Builder::new()
                .name("fides-mic-capture".into())
                .spawn(move || {
                    microphone::capture_loop(t, rx, mic_dev);
                })
                .map_err(|e| format!("Failed to spawn mic thread: {e}"))?;
            self.mic_handle = Some(handle);
            println!("[AUDIO] Microphone capture started");
        }

        // Start loopback capture
        if source == AudioSource::Loopback || source == AudioSource::Both {
            let t = transcriber.clone();
            let rx = stop_rx.clone();
            let handle = std::thread::Builder::new()
                .name("fides-loopback-capture".into())
                .spawn(move || {
                    loopback::capture_loop(t, rx);
                })
                .map_err(|e| format!("Failed to spawn loopback thread: {e}"))?;
            self.loopback_handle = Some(handle);
            println!("[AUDIO] Loopback capture started");
        }

        self.is_running = true;
        Ok(())
    }

    /// Stop all capture threads.
    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(true);
        }

        // Wait for threads to finish (with timeout)
        if let Some(handle) = self.mic_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.loopback_handle.take() {
            let _ = handle.join();
        }

        // Stop both archivers
        if let Some(ref t) = self.transcriber {
            if let Ok(mut a) = t.mic_archiver.lock() { a.stop(); }
            if let Ok(mut a) = t.sys_archiver.lock() { a.stop(); }
        }

        self.is_running = false;
        println!("[AUDIO] All capture stopped");
    }
}

impl Drop for AudioManager {
    fn drop(&mut self) {
        self.stop();
    }
}

// ─── Model download ───

/// Returns the path where the Whisper model should live.
pub fn model_path() -> PathBuf {
    let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    home.join(".fides").join("models").join("ggml-large-v3.bin")
}

/// Platform home directory.
fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Get model status.
pub fn get_model_status() -> ModelStatus {
    let path = model_path();
    let downloaded = path.exists();
    let size_mb = if downloaded {
        std::fs::metadata(&path)
            .map(|m| m.len() / (1024 * 1024))
            .unwrap_or(0)
    } else {
        0
    };
    ModelStatus {
        downloaded,
        path: path.to_string_lossy().into_owned(),
        size_mb,
    }
}

/// Download the Whisper model if it doesn't exist.
/// Emits fides://model-download-progress events.
/// Uses chunked streaming download for progress reporting on a ~3GB file.
pub async fn ensure_model_downloaded(app_handle: tauri::AppHandle) -> Result<PathBuf, String> {
    let path = model_path();

    if path.exists() {
        println!("[AUDIO] Model already downloaded at {}", path.display());
        return Ok(path);
    }

    let models_dir = path.parent().unwrap();
    std::fs::create_dir_all(models_dir)
        .map_err(|e| format!("Failed to create models dir: {e}"))?;

    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin";
    println!("[AUDIO] Downloading model from {url}");

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);

    // Write to a temp file, then rename on success
    let tmp_path = path.with_extension("bin.downloading");
    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    // Stream the response body in chunks using reqwest::Response::chunk()
    let mut downloaded: u64 = 0;
    let mut resp = resp;

    use std::io::Write;
    loop {
        let chunk = resp
            .chunk()
            .await
            .map_err(|e| format!("Download read error: {e}"))?;

        match chunk {
            Some(bytes) => {
                file.write_all(&bytes)
                    .map_err(|e| format!("Failed to write chunk: {e}"))?;
                downloaded += bytes.len() as u64;

                let _ = app_handle.emit(
                    "fides://model-download-progress",
                    &ModelDownloadProgress { downloaded, total },
                );
            }
            None => break,
        }
    }

    drop(file);

    // Rename temp to final
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize model file: {e}"))?;

    println!("[AUDIO] Model download complete: {}", path.display());
    Ok(path)
}