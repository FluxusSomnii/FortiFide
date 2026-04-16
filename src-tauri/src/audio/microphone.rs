use std::sync::Arc;
use tokio::sync::watch;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use super::transcriber::{self, Transcriber};

/// Duration of audio to accumulate before sending to Whisper (seconds).
const CHUNK_DURATION_SECS: f32 = 5.0;

/// Target sample rate for Whisper.
const TARGET_RATE: u32 = 16000;

/// Capture loop: opens a specific or default microphone, accumulates 5s of audio,
/// sends to Whisper for transcription, repeats until stop signal.
pub fn capture_loop(transcriber: Arc<Transcriber>, stop_rx: watch::Receiver<bool>, preferred_device: Option<String>) {
    println!("[MIC] Starting microphone capture loop (preferred: {:?})", preferred_device);

    let host = cpal::default_host();

    // Try to find the preferred device by name, fall back to default
    let device = if let Some(ref name) = preferred_device {
        if name == "none" || name == "None" || name == "disabled" {
            println!("[MIC] Mic capture disabled by settings");
            return;
        }
        host.input_devices()
            .ok()
            .and_then(|mut devs| devs.find(|d| d.name().ok().as_deref() == Some(name.as_str())))
            .or_else(|| {
                eprintln!("[MIC] Preferred device '{}' not found, using default", name);
                host.default_input_device()
            })
    } else {
        host.default_input_device()
    };

    let device = match device {
        Some(d) => d,
        None => {
            eprintln!("[MIC] No input device found");
            return;
        }
    };

    let device_name = device.name().unwrap_or_else(|_| "Unknown".into());
    println!("[MIC] Using input device: {device_name}");

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[MIC] Failed to get default input config: {e}");
            return;
        }
    };

    let source_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    println!("[MIC] Config: {source_rate}Hz, {channels}ch, {:?}", config.sample_format());

    // Shared buffer for accumulating samples (already converted to f32 mono 16kHz)
    let buffer = Arc::new(std::sync::Mutex::new(Vec::<f32>::new()));
    let buffer_for_callback = buffer.clone();

    // Number of 16kHz mono samples for one chunk
    let chunk_samples = (TARGET_RATE as f32 * CHUNK_DURATION_SECS) as usize;

    let err_fn = |err: cpal::StreamError| {
        eprintln!("[MIC] Stream error: {err}");
    };

    // Build stream based on sample format
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let sr = source_rate;
            let ch = channels;
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    process_samples(data, sr, ch, &buffer_for_callback);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let sr = source_rate;
            let ch = channels;
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let f32_data = transcriber::i16_to_f32(data);
                    process_samples(&f32_data, sr, ch, &buffer_for_callback);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let sr = source_rate;
            let ch = channels;
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 / 32768.0) - 1.0)
                        .collect();
                    process_samples(&f32_data, sr, ch, &buffer_for_callback);
                },
                err_fn,
                None,
            )
        }
        fmt => {
            eprintln!("[MIC] Unsupported sample format: {fmt:?}");
            return;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[MIC] Failed to build input stream: {e}");
            return;
        }
    };

    if let Err(e) = stream.play() {
        eprintln!("[MIC] Failed to start stream: {e}");
        return;
    }

    println!("[MIC] Stream started, listening...");

    // Main loop: check buffer size, transcribe when ready
    loop {
        if *stop_rx.borrow() {
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(250));

        let should_transcribe = {
            let buf = buffer.lock().unwrap();
            buf.len() >= chunk_samples
        };

        if should_transcribe {
            let audio_chunk = {
                let mut buf = buffer.lock().unwrap();
                let chunk: Vec<f32> = buf[..chunk_samples].to_vec();
                *buf = buf[chunk_samples..].to_vec();
                chunk
            };

            // Silence detection: compute RMS energy of the chunk
            // If below threshold, skip transcription (mic is muted/off/no input)
            let rms = (audio_chunk.iter().map(|s| s * s).sum::<f32>() / audio_chunk.len() as f32).sqrt();
            if rms < 0.005 {
                // Still archive the audio (silence is valid audio data) but don't transcribe
                if let Ok(mut a) = transcriber.mic_archiver.lock() {
                    a.write_samples(&audio_chunk);
                }
                continue;
            }

            transcriber.transcribe_and_emit(&audio_chunk, "Outgoing Audio");
        }
    }

    // Flush remaining audio buffer to archiver (too short for Whisper, but keep in recording)
    {
        let buf = buffer.lock().unwrap();
        if !buf.is_empty() {
            println!("[MIC] Flushing {} residual samples to archiver", buf.len());
            if let Ok(mut a) = transcriber.mic_archiver.lock() {
                a.write_samples(&buf);
            }
        }
    }

    drop(stream);
    println!("[MIC] Capture loop exited");
}

/// Convert incoming samples to f32 mono 16kHz and append to buffer.
fn process_samples(
    data: &[f32],
    source_rate: u32,
    channels: usize,
    buffer: &std::sync::Mutex<Vec<f32>>,
) {
    if data.is_empty() {
        return;
    }

    // Mix to mono if stereo
    let mono = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect::<Vec<_>>()
    } else {
        data.to_vec()
    };

    // Resample to 16kHz
    let resampled = transcriber::resample_to_16k(&mono, source_rate);

    // Append to shared buffer
    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&resampled);
    }
}
