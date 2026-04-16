use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use base64::Engine;
use tauri::Emitter;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Whether diarization is enabled and the server is reachable.
static DIARIZE_AVAILABLE: AtomicBool = AtomicBool::new(true);

/// Current capture mode: 0 = capture, 1 = live, 2 = deep
static CAPTURE_MODE: AtomicU8 = AtomicU8::new(1);

pub fn set_capture_mode(mode: u8) {
    CAPTURE_MODE.store(mode, Ordering::Relaxed);
}

pub fn get_capture_mode() -> u8 {
    CAPTURE_MODE.load(Ordering::Relaxed)
}

/// Transcript event emitted to the frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct TranscriptEvent {
    pub text: String,
    pub source: String,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_overlap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap_speakers: Option<Vec<String>>,
}

/// 30 seconds of 16kHz mono audio = 480,000 samples
const DIARIZE_BUFFER_SAMPLES: usize = 16000 * 30;

/// Archives captured audio to WAV files on disk.
pub struct AudioArchiver {
    writer: Option<std::io::BufWriter<std::fs::File>>,
    samples_written: u64,
    session_dir: std::path::PathBuf,
    filename: String,
}

impl AudioArchiver {
    pub fn new() -> Self {
        Self {
            writer: None,
            samples_written: 0,
            session_dir: std::path::PathBuf::new(),
            filename: "audio.wav".to_string(),
        }
    }

    /// Start recording to a WAV file with the given filename (e.g. "mic.wav", "system.wav").
    pub fn start(&mut self, session_id: &str, filename: &str) -> Result<(), String> {
        let home = super::dirs_next().unwrap_or_else(|| std::path::PathBuf::from("."));
        let session_dir = home.join(".fides").join("sessions").join(session_id);
        std::fs::create_dir_all(&session_dir)
            .map_err(|e| format!("Failed to create session dir: {e}"))?;

        let audio_path = session_dir.join(filename);
        let file = std::fs::File::create(&audio_path)
            .map_err(|e| format!("Failed to create audio file: {e}"))?;

        let mut writer = std::io::BufWriter::new(file);

        let header = encode_wav_header(0, 16000);
        use std::io::Write;
        writer.write_all(&header)
            .map_err(|e| format!("Failed to write WAV header: {e}"))?;

        self.writer = Some(writer);
        self.samples_written = 0;
        self.session_dir = session_dir;
        self.filename = filename.to_string();
        println!("[ARCHIVE] Started recording to {}", audio_path.display());
        Ok(())
    }

    /// Append audio samples to the archive.
    pub fn write_samples(&mut self, audio: &[f32]) {
        if let Some(ref mut writer) = self.writer {
            use std::io::Write;
            for &sample in audio {
                let clamped = sample.max(-1.0).min(1.0);
                let i16_val = (clamped * 32767.0) as i16;
                match writer.write_all(&i16_val.to_le_bytes()) {
                    Ok(()) => self.samples_written += 1,
                    Err(e) => {
                        eprintln!("[ARCHIVE] Write error: {e}");
                        break;
                    }
                }
            }
        }
    }

    /// Stop recording and finalize the WAV header.
    /// Uses actual file size to compute data_size — bulletproof against write errors.
    pub fn stop(&mut self) {
        if let Some(mut writer) = self.writer.take() {
            use std::io::Write;
            if let Err(e) = writer.flush() {
                eprintln!("[ARCHIVE] Flush error: {e}");
            }
            drop(writer);

            let audio_path = self.session_dir.join(&self.filename);

            // Compute data size from actual file size (44 = WAV header)
            let file_len = std::fs::metadata(&audio_path).map(|m| m.len()).unwrap_or(44);
            let data_size = (file_len.saturating_sub(44)) as u32;
            let file_size = 36 + data_size;

            if let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(&audio_path) {
                use std::io::Seek;
                let _ = file.seek(std::io::SeekFrom::Start(4));
                let _ = std::io::Write::write_all(&mut file, &file_size.to_le_bytes());
                let _ = file.seek(std::io::SeekFrom::Start(40));
                let _ = std::io::Write::write_all(&mut file, &data_size.to_le_bytes());
            }

            let duration = data_size as f64 / (16000.0 * 2.0); // 16-bit = 2 bytes/sample
            let size_mb = data_size as f64 / (1024.0 * 1024.0);
            println!("[ARCHIVE] Saved: {} ({duration:.1}s, {size_mb:.1} MB)", audio_path.display());
        }
        self.samples_written = 0;
    }
}

/// Wraps a loaded Whisper model and emits transcript events.
pub struct Transcriber {
    ctx: Mutex<WhisperContext>,
    app_handle: tauri::AppHandle,
    last_text: Mutex<String>,
    /// Rolling 30-second audio buffer for diarization.
    diarize_buffer: Mutex<Vec<f32>>,
    /// Mic audio archiver (writes mic.wav).
    pub mic_archiver: Mutex<AudioArchiver>,
    /// System audio archiver (writes system.wav).
    pub sys_archiver: Mutex<AudioArchiver>,
}

// Safety: WhisperContext is internally thread-safe for read operations
// and we guard mutation with a Mutex.
unsafe impl Send for Transcriber {}
unsafe impl Sync for Transcriber {}

impl Transcriber {
    /// Create a new Transcriber by loading the Whisper model.
    pub fn new(model_path: &str, app_handle: tauri::AppHandle) -> Result<Self, String> {
        // Suppress whisper.cpp and ggml verbose logging by installing
        // a no-op callback. Passing None would restore the default stderr
        // logger, so we pass an explicit empty function instead.
        // The callback signature must match ggml_log_callback exactly:
        // fn(level: ggml_log_level, text: *const c_char, user_data: *mut c_void)
        unsafe extern "C" fn noop_log(
            _level: std::os::raw::c_int,
            _text: *const std::os::raw::c_char,
            _user_data: *mut std::os::raw::c_void,
        ) {
            // Intentionally empty — swallows all whisper/ggml log output
        }
        unsafe {
            whisper_rs::set_log_callback(Some(noop_log), std::ptr::null_mut());
        }

        println!("[WHISPER] Loading model from {model_path}");
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(model_path, params)
            .map_err(|e| format!("Failed to load Whisper model: {e:?}"))?;
        println!("[WHISPER] Model loaded successfully");

        Ok(Self {
            ctx: Mutex::new(ctx),
            app_handle,
            last_text: Mutex::new(String::new()),
            diarize_buffer: Mutex::new(Vec::new()),
            mic_archiver: Mutex::new(AudioArchiver::new()),
            sys_archiver: Mutex::new(AudioArchiver::new()),
        })
    }

    /// Transcribe raw f32 PCM audio at 16kHz mono.
    /// Returns the concatenated transcribed text.
    pub fn transcribe(&self, audio: &[f32]) -> Result<String, String> {
        if audio.is_empty() {
            return Ok(String::new());
        }

        let ctx = self.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {e:?}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_progress(false);
        params.set_print_timestamps(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_debug_mode(false);
        params.set_no_context(true);
        params.set_single_segment(false);
        // Use available CPU threads (Whisper will also use CUDA if built with cuda feature)
        params.set_n_threads(4);

        state
            .full(params, audio)
            .map_err(|e| format!("Transcription failed: {e:?}"))?;

        let mut text = String::new();
        for segment in state.as_iter() {
            if let Ok(seg_text) = segment.to_str_lossy() {
                text.push_str(&seg_text);
                text.push(' ');
            }
        }

        let trimmed = text.trim().to_string();
        Ok(trimmed)
    }

    /// Transcribe and emit a fides://transcript event with the result.
    pub fn transcribe_and_emit(&self, audio: &[f32], source: &str) {
        // Archive ALL audio unconditionally, before any filtering/transcription.
        // Route to the correct archiver based on source.
        if source == "Outgoing Audio" {
            if let Ok(mut a) = self.mic_archiver.lock() { a.write_samples(audio); }
        } else {
            if let Ok(mut a) = self.sys_archiver.lock() { a.write_samples(audio); }
        }

        match self.transcribe(audio) {
            Ok(text) if !text.is_empty() => {
                // Filter out Whisper hallucinations (common with silence)
                let lower = text.to_lowercase();
                if lower.contains("[blank_audio]")
                    || lower.contains("(blank audio)")
                    || lower == "you"
                    || lower == "thanks for watching!"
                    || lower == "thank you."
                    || text.len() < 3
                {
                    return;
                }

                // Deduplicate: skip if text matches last emission
                if let Ok(mut last) = self.last_text.lock() {
                    if is_duplicate(&text, &last) {
                        println!("[WHISPER] Skipped duplicate ({source}): {} chars", text.len());
                        return;
                    }
                    *last = text.clone();
                }

                println!("[WHISPER] Transcribed ({source}): {} chars", text.len());

                let mode = get_capture_mode();
                let is_microphone = source == "Outgoing Audio";

                // Determine speaker label based on mode and source
                let (speaker, has_overlap, overlap_speakers) = if mode == 0 {
                    // Capture mode: no diarization at all
                    (None, false, vec![])
                } else if is_microphone {
                    // Microphone: always "Mic", skip diarization buffer
                    (Some("Mic".to_string()), false, vec![])
                } else {
                    // Loopback: accumulate into diarization buffer and run diarization
                    let diarize_snapshot = if DIARIZE_AVAILABLE.load(Ordering::Relaxed) {
                        if let Ok(mut buf) = self.diarize_buffer.lock() {
                            buf.extend_from_slice(audio);
                            if buf.len() > DIARIZE_BUFFER_SAMPLES {
                                let excess = buf.len() - DIARIZE_BUFFER_SAMPLES;
                                buf.drain(..excess);
                            }
                            Some(buf.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    match diarize_snapshot {
                        Some(buf) => {
                            let chunk_duration_secs = audio.len() as f64 / 16000.0;
                            diarize_audio_windowed(&buf, chunk_duration_secs)
                        }
                        None => (None, false, vec![]),
                    }
                };

                let event = TranscriptEvent {
                    text,
                    source: source.to_string(),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    speaker,
                    has_overlap: if has_overlap { Some(true) } else { None },
                    overlap_speakers: if overlap_speakers.is_empty() { None } else { Some(overlap_speakers) },
                };
                let _ = self.app_handle.emit("fides://transcript", &event);
            }
            Ok(_) => {
                // Empty transcription — silence, skip
            }
            Err(e) => {
                eprintln!("[WHISPER] Transcription error ({source}): {e}");
            }
        }
    }
}

// ─── Deduplication ───

/// Check if new text is a duplicate of the last emitted text.
/// Uses prefix matching + length similarity rather than exact equality,
/// because Whisper may produce minor variations on the same audio.
fn is_duplicate(new_text: &str, last_text: &str) -> bool {
    if new_text.is_empty() || last_text.is_empty() {
        return false;
    }
    // Exact match
    if new_text == last_text {
        return true;
    }
    // Length within 10%
    let len_ratio = new_text.len() as f64 / last_text.len() as f64;
    if len_ratio < 0.90 || len_ratio > 1.10 {
        return false;
    }
    // First 100 chars match (catches overlap-induced duplicates)
    let prefix_len = 100.min(new_text.len()).min(last_text.len());
    new_text[..prefix_len] == last_text[..prefix_len]
}

// ─── Audio format conversion utilities ───

/// Resample audio from any sample rate to 16kHz using linear interpolation.
pub fn resample_to_16k(samples: &[f32], source_rate: u32) -> Vec<f32> {
    if source_rate == 16000 {
        return samples.to_vec();
    }

    let ratio = 16000.0 / source_rate as f64;
    let output_len = (samples.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 / ratio;
        let idx_floor = src_idx.floor() as usize;
        let frac = src_idx - idx_floor as f64;

        let sample = if idx_floor + 1 < samples.len() {
            samples[idx_floor] as f64 * (1.0 - frac) + samples[idx_floor + 1] as f64 * frac
        } else if idx_floor < samples.len() {
            samples[idx_floor] as f64
        } else {
            0.0
        };

        output.push(sample as f32);
    }

    output
}

/// Mix stereo interleaved samples down to mono.
pub fn stereo_to_mono(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(2)
        .map(|pair| {
            if pair.len() == 2 {
                (pair[0] + pair[1]) * 0.5
            } else {
                pair[0]
            }
        })
        .collect()
}

/// Convert i16 PCM to f32 PCM.
pub fn i16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| s as f32 / 32768.0).collect()
}

/// Encode a WAV file header for 16-bit mono PCM at the given sample rate.
fn encode_wav_header(data_size: u32, sample_rate: u32) -> Vec<u8> {
    let mut h = Vec::with_capacity(44);
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let file_size = 36 + data_size;

    // RIFF header
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&file_size.to_le_bytes());
    h.extend_from_slice(b"WAVE");

    // fmt sub-chunk
    h.extend_from_slice(b"fmt ");
    h.extend_from_slice(&16u32.to_le_bytes()); // sub-chunk size
    h.extend_from_slice(&1u16.to_le_bytes());  // PCM format
    h.extend_from_slice(&channels.to_le_bytes());
    h.extend_from_slice(&sample_rate.to_le_bytes());
    h.extend_from_slice(&byte_rate.to_le_bytes());
    h.extend_from_slice(&block_align.to_le_bytes());
    h.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data sub-chunk
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data_size.to_le_bytes());

    h
}

/// Send audio to the diarization server and return (speaker, has_overlap, overlap_speakers).
fn diarize_audio_windowed(buffer: &[f32], chunk_duration_secs: f64) -> (Option<String>, bool, Vec<String>) {
    let bytes: Vec<u8> = buffer.iter().flat_map(|&s| s.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let body = serde_json::json!({
        "audio_b64": encoded,
        "sample_rate": 16000,
        "min_speakers": 1,
        "max_speakers": 5,
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();

    match client.post("http://127.0.0.1:19534/diarize").json(&body).send() {
        Ok(resp) => {
            if !resp.status().is_success() {
                return (None, false, vec![]);
            }
            match resp.json::<serde_json::Value>() {
                Ok(data) => {
                    let segments = data["segments"].as_array();
                    if segments.is_none() || segments.unwrap().is_empty() {
                        return (None, false, vec![]);
                    }

                    let segs = segments.unwrap();
                    let total_duration = buffer.len() as f64 / 16000.0;
                    let chunk_start = (total_duration - chunk_duration_secs).max(0.0);

                    let mut speaker_durations: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
                    let mut overlap_speakers: Vec<String> = vec![];
                    let mut has_overlap = false;

                    for seg in segs {
                        let start = seg["start"].as_f64().unwrap_or(0.0);
                        let end = seg["end"].as_f64().unwrap_or(0.0);
                        let speaker = seg["speaker"].as_str().unwrap_or("Unknown").to_string();

                        if end > chunk_start {
                            let effective_start = start.max(chunk_start);
                            let duration = end - effective_start;
                            *speaker_durations.entry(speaker).or_insert(0.0) += duration;
                        }
                    }

                    if let Some(overlaps) = data["overlaps"].as_array() {
                        for ov in overlaps {
                            let start = ov["start"].as_f64().unwrap_or(0.0);
                            let end = ov["end"].as_f64().unwrap_or(0.0);
                            if end > chunk_start {
                                has_overlap = true;
                                if let Some(speakers) = ov["speakers"].as_array() {
                                    for s in speakers {
                                        if let Some(name) = s.as_str() {
                                            if !overlap_speakers.contains(&name.to_string()) {
                                                overlap_speakers.push(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let dominant = speaker_durations.into_iter()
                        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                        .map(|(speaker, _)| speaker);

                    (dominant, has_overlap, overlap_speakers)
                }
                Err(_) => (None, false, vec![]),
            }
        }
        Err(e) => {
            eprintln!("[DIARIZE] Request failed: {e}");
            DIARIZE_AVAILABLE.store(false, Ordering::Relaxed);
            (None, false, vec![])
        }
    }
}
