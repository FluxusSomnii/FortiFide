use std::path::PathBuf;
use std::sync::Arc;
use base64::Engine;

use super::transcriber::Transcriber;

/// A segment returned from retranscription.
#[derive(serde::Serialize, Debug, Clone)]
pub struct RetranscribeSegment {
    pub text: String,
    pub speaker: Option<String>,
    pub start: f64,
    pub end: f64,
}

/// Decode a WAV file to f32 PCM samples at 16kHz mono.
fn decode_wav(path: &PathBuf) -> Result<Vec<f32>, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if data.len() < 44 || &data[0..4] != b"RIFF" {
        return Err(format!("Not a valid WAV file: {}", path.display()));
    }

    // Parse WAV header
    let channels = u16::from_le_bytes([data[22], data[23]]) as usize;
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    let bits_per_sample = u16::from_le_bytes([data[34], data[35]]);

    // Find data chunk
    let mut pos = 12;
    let mut data_start = 44;
    let mut data_size = data.len() - 44;
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]) as usize;
        if chunk_id == b"data" {
            data_start = pos + 8;
            data_size = chunk_size.min(data.len() - data_start);
            break;
        }
        pos += 8 + chunk_size;
    }

    let pcm_data = &data[data_start..data_start + data_size];

    // Convert to f32 samples
    let samples: Vec<f32> = if bits_per_sample == 16 {
        pcm_data.chunks(2)
            .map(|c| {
                if c.len() == 2 { i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0 }
                else { 0.0 }
            })
            .collect()
    } else if bits_per_sample == 32 {
        pcm_data.chunks(4)
            .map(|c| {
                if c.len() == 4 { f32::from_le_bytes([c[0], c[1], c[2], c[3]]) }
                else { 0.0 }
            })
            .collect()
    } else {
        return Err(format!("Unsupported bits per sample: {bits_per_sample}"));
    };

    // Mix to mono if stereo+
    let mono = if channels > 1 {
        samples.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples
    };

    // Resample to 16kHz if needed
    if sample_rate != 16000 {
        Ok(super::transcriber::resample_to_16k(&mono, sample_rate))
    } else {
        Ok(mono)
    }
}

/// Transcribe a full audio file in chunks, returning segments with time offsets.
fn transcribe_full(transcriber: &Transcriber, audio: &[f32], chunk_secs: f64) -> Vec<RetranscribeSegment> {
    let chunk_samples = (16000.0 * chunk_secs) as usize;
    let mut segments = Vec::new();
    let mut offset = 0;

    while offset < audio.len() {
        let end = (offset + chunk_samples).min(audio.len());
        let chunk = &audio[offset..end];

        let start_sec = offset as f64 / 16000.0;
        let end_sec = end as f64 / 16000.0;

        match transcriber.transcribe(chunk) {
            Ok(text) if !text.is_empty() && text.len() >= 3 => {
                let lower = text.to_lowercase();
                if !lower.contains("[blank_audio]") && !lower.contains("(blank audio)")
                    && lower != "you" && lower != "thanks for watching!" && lower != "thank you."
                {
                    segments.push(RetranscribeSegment {
                        text,
                        speaker: None,
                        start: start_sec,
                        end: end_sec,
                    });
                }
            }
            _ => {}
        }

        offset = end;
    }

    segments
}

/// Call the diarization server and align speakers with transcript segments.
fn diarize_and_align(audio: &[f32], segments: &mut [RetranscribeSegment]) {
    // Encode audio as raw f32 bytes → base64
    let bytes: Vec<u8> = audio.iter().flat_map(|s| s.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let body = serde_json::json!({
        "audio_b64": encoded,
        "sample_rate": 16000,
        "min_speakers": 1,
        "max_speakers": 5,
    });

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120)) // longer timeout for full audio
        .build()
    {
        Ok(c) => c,
        Err(e) => { eprintln!("[RETRANSCRIBE] Failed to create HTTP client: {e}"); return; }
    };

    let resp = match client.post("http://127.0.0.1:19534/diarize").json(&body).send() {
        Ok(r) => r,
        Err(e) => { eprintln!("[RETRANSCRIBE] Diarization server unreachable: {e}"); return; }
    };

    let data: serde_json::Value = match resp.json() {
        Ok(d) => d,
        Err(e) => { eprintln!("[RETRANSCRIBE] Failed to parse diarization response: {e}"); return; }
    };

    let diar_segments = match data["segments"].as_array() {
        Some(s) if !s.is_empty() => s,
        _ => { println!("[RETRANSCRIBE] No diarization segments returned"); return; }
    };

    let speaker_count = data["speaker_count"].as_u64().unwrap_or(0);
    println!("[RETRANSCRIBE] Got {} diarization segments, {} speakers", diar_segments.len(), speaker_count);

    if speaker_count <= 1 { return; }

    // Align: for each transcript segment, find dominant speaker by overlap
    for seg in segments.iter_mut() {
        let mut speaker_durations: std::collections::HashMap<String, f64> = std::collections::HashMap::new();

        for ds in diar_segments {
            let ds_start = ds["start"].as_f64().unwrap_or(0.0);
            let ds_end = ds["end"].as_f64().unwrap_or(0.0);
            let ds_speaker = ds["speaker"].as_str().unwrap_or("Unknown");

            let overlap_start = seg.start.max(ds_start);
            let overlap_end = seg.end.min(ds_end);
            if overlap_end > overlap_start {
                *speaker_durations.entry(ds_speaker.to_string()).or_insert(0.0) += overlap_end - overlap_start;
            }
        }

        if let Some((speaker, _)) = speaker_durations.into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        {
            seg.speaker = Some(speaker);
        }
    }
}

/// Main retranscribe function: reads WAV files, runs Whisper, optionally diarizes.
pub fn retranscribe(
    transcriber: Arc<Transcriber>,
    session_dir: PathBuf,
    audio_session_id: &str,
    mode: u8,
) -> Result<Vec<RetranscribeSegment>, String> {
    let home = super::dirs_next().unwrap_or_else(|| PathBuf::from("."));
    let audio_dir = home.join(".fides").join("sessions").join(audio_session_id);

    // Find audio files
    let sys_path = audio_dir.join("system.wav");
    let mic_path = audio_dir.join("mic.wav");
    let legacy_path = audio_dir.join("audio.wav");

    let has_sys = sys_path.exists();
    let has_mic = mic_path.exists();
    let has_legacy = legacy_path.exists();

    if !has_sys && !has_mic && !has_legacy {
        return Err(format!("No audio files found in {}", audio_dir.display()));
    }

    println!("[RETRANSCRIBE] Audio dir: {} | sys={} mic={} legacy={}", audio_dir.display(), has_sys, has_mic, has_legacy);

    let mut all_segments: Vec<RetranscribeSegment> = Vec::new();

    // Transcribe system audio
    if has_sys || has_legacy {
        let path = if has_sys { &sys_path } else { &legacy_path };
        println!("[RETRANSCRIBE] Decoding system audio: {}", path.display());
        let audio = decode_wav(path)?;
        println!("[RETRANSCRIBE] System audio: {} samples ({:.1}s)", audio.len(), audio.len() as f64 / 16000.0);

        let mut segs = transcribe_full(&transcriber, &audio, 10.0); // 10s chunks for better context
        println!("[RETRANSCRIBE] System audio: {} segments transcribed", segs.len());

        // Diarize if mode >= 1
        if mode >= 1 && !segs.is_empty() {
            println!("[RETRANSCRIBE] Running diarization on system audio...");
            diarize_and_align(&audio, &mut segs);
        }

        // Tag as incoming
        for seg in &mut segs {
            if seg.speaker.is_none() {
                seg.speaker = Some("Incoming".to_string());
            }
        }

        all_segments.extend(segs);
    }

    // Transcribe mic audio
    if has_mic {
        println!("[RETRANSCRIBE] Decoding mic audio: {}", mic_path.display());
        let audio = decode_wav(&mic_path)?;
        println!("[RETRANSCRIBE] Mic audio: {} samples ({:.1}s)", audio.len(), audio.len() as f64 / 16000.0);

        // Check if mic audio has actual content (not just silence)
        let rms = (audio.iter().map(|s| s * s).sum::<f32>() / audio.len().max(1) as f32).sqrt();
        if rms > 0.005 {
            let mut segs = transcribe_full(&transcriber, &audio, 10.0);
            println!("[RETRANSCRIBE] Mic audio: {} segments transcribed", segs.len());

            for seg in &mut segs {
                seg.speaker = Some("Mic".to_string());
            }

            all_segments.extend(segs);
        } else {
            println!("[RETRANSCRIBE] Mic audio is silence (RMS={:.4}), skipping", rms);
        }
    }

    // Sort all segments by start time
    all_segments.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    println!("[RETRANSCRIBE] Total: {} segments", all_segments.len());
    Ok(all_segments)
}
