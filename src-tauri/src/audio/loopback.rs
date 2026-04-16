use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::watch;

use super::transcriber::{self, Transcriber};

/// Duration of audio to accumulate before sending to Whisper (seconds).
const CHUNK_DURATION_SECS: f32 = 5.0;

/// Target sample rate for Whisper.
const TARGET_RATE: u32 = 16000;

/// WASAPI loopback capture loop.
/// Architecture: a dedicated WASAPI polling thread feeds a shared buffer,
/// while this thread drains it and sends chunks to the transcriber.
/// This prevents WASAPI ring buffer overflow during blocking transcription/diarization.
#[cfg(target_os = "windows")]
pub fn capture_loop(transcriber: Arc<Transcriber>, stop_rx: watch::Receiver<bool>) {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    println!("[LOOPBACK] Starting WASAPI loopback capture");

    // Shared buffer between WASAPI polling thread and this drain thread
    let buffer: Arc<StdMutex<Vec<f32>>> = Arc::new(StdMutex::new(Vec::new()));
    let buffer_for_wasapi = buffer.clone();
    let stop_rx_wasapi = stop_rx.clone();

    // Spawn dedicated WASAPI polling thread — runs continuously, never blocked by transcription
    let wasapi_thread = std::thread::Builder::new()
        .name("fides-wasapi-poll".into())
        .spawn(move || {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                if hr.is_err() { /* May already be initialized */ }

                let enumerator: IMMDeviceEnumerator = match CoCreateInstance(
                    &MMDeviceEnumerator, None, CLSCTX_ALL,
                ) {
                    Ok(e) => e,
                    Err(e) => { eprintln!("[LOOPBACK] Failed to create device enumerator: {e}"); return; }
                };

                let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                    Ok(d) => d,
                    Err(e) => { eprintln!("[LOOPBACK] Failed to get default render endpoint: {e}"); return; }
                };

                println!("[LOOPBACK] Got default render device");

                let audio_client: IAudioClient = match device.Activate(CLSCTX_ALL, None) {
                    Ok(c) => c,
                    Err(e) => { eprintln!("[LOOPBACK] Failed to activate audio client: {e}"); return; }
                };

                let mix_format_ptr = match audio_client.GetMixFormat() {
                    Ok(f) => f,
                    Err(e) => { eprintln!("[LOOPBACK] Failed to get mix format: {e}"); return; }
                };
                let mix_format = &*mix_format_ptr;

                let source_rate = mix_format.nSamplesPerSec;
                let channels = mix_format.nChannels as usize;
                let bits_per_sample = mix_format.wBitsPerSample;
                println!("[LOOPBACK] Mix format: {}Hz, {}ch, {}bit", source_rate, channels, bits_per_sample);

                let buffer_duration = 10_000_000i64; // 1 second in 100ns units
                if let Err(e) = audio_client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                    buffer_duration, 0, mix_format_ptr, None,
                ) {
                    eprintln!("[LOOPBACK] Failed to initialize audio client: {e}");
                    CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
                    return;
                }

                let capture_client: IAudioCaptureClient = match audio_client.GetService() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[LOOPBACK] Failed to get capture client: {e}");
                        CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
                        return;
                    }
                };

                if let Err(e) = audio_client.Start() {
                    eprintln!("[LOOPBACK] Failed to start audio client: {e}");
                    CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
                    return;
                }

                println!("[LOOPBACK] WASAPI polling thread started");

                // Tight polling loop — 15ms sleep keeps WASAPI ring buffer pressure low
                loop {
                    if *stop_rx_wasapi.borrow() { break; }

                    std::thread::sleep(std::time::Duration::from_millis(15));

                    loop {
                        let next_packet_size = match capture_client.GetNextPacketSize() {
                            Ok(s) => s,
                            Err(_) => break,
                        };
                        if next_packet_size == 0 { break; }

                        let mut buffer_ptr: *mut u8 = std::ptr::null_mut();
                        let mut num_frames: u32 = 0;
                        let mut flags: u32 = 0;
                        let mut device_position: u64 = 0;
                        let mut qpc_position: u64 = 0;

                        if capture_client.GetBuffer(
                            &mut buffer_ptr, &mut num_frames, &mut flags,
                            Some(&mut device_position), Some(&mut qpc_position),
                        ).is_err() { break; }

                        if num_frames > 0 && !buffer_ptr.is_null() {
                            let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;

                            let samples = if !is_silent {
                                let frame_samples = num_frames as usize * channels;
                                let float_samples: Vec<f32> = if bits_per_sample == 32 {
                                    let ptr = buffer_ptr as *const f32;
                                    std::slice::from_raw_parts(ptr, frame_samples).to_vec()
                                } else if bits_per_sample == 16 {
                                    let ptr = buffer_ptr as *const i16;
                                    let raw = std::slice::from_raw_parts(ptr, frame_samples);
                                    transcriber::i16_to_f32(raw)
                                } else {
                                    Vec::new()
                                };

                                if !float_samples.is_empty() {
                                    let mono = if channels >= 2 {
                                        float_samples.chunks(channels)
                                            .map(|frame| (frame[0] + frame[1]) * 0.5)
                                            .collect::<Vec<_>>()
                                    } else {
                                        float_samples
                                    };
                                    transcriber::resample_to_16k(&mono, source_rate)
                                } else {
                                    Vec::new()
                                }
                            } else {
                                // Silent frame — write zeros to maintain wall-clock alignment
                                let mono_samples = num_frames as usize;
                                let resampled_len = (mono_samples as f64 * 16000.0 / source_rate as f64) as usize;
                                vec![0.0f32; resampled_len]
                            };

                            if !samples.is_empty() {
                                if let Ok(mut buf) = buffer_for_wasapi.lock() {
                                    buf.extend_from_slice(&samples);
                                }
                            }
                        }

                        let _ = capture_client.ReleaseBuffer(num_frames);
                    }
                }

                // Cleanup WASAPI resources
                let _ = audio_client.Stop();
                CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
                println!("[LOOPBACK] WASAPI polling thread exited");
            }
        })
        .ok();

    // Main drain-and-transcribe loop (mirrors microphone.rs:119-143)
    let chunk_samples = (TARGET_RATE as f32 * CHUNK_DURATION_SECS) as usize;

    loop {
        if *stop_rx.borrow() { break; }

        std::thread::sleep(std::time::Duration::from_millis(250));

        let should_transcribe = {
            let buf = buffer.lock().unwrap();
            buf.len() >= chunk_samples
        };

        if should_transcribe {
            let chunk = {
                let mut buf = buffer.lock().unwrap();
                let chunk: Vec<f32> = buf[..chunk_samples].to_vec();
                *buf = buf[chunk_samples..].to_vec();
                chunk
            };
            transcriber.transcribe_and_emit(&chunk, "Incoming Audio");
        }
    }

    // Flush remaining audio to archiver (too short for Whisper, but keep in recording)
    {
        let buf = buffer.lock().unwrap();
        if !buf.is_empty() {
            println!("[LOOPBACK] Flushing {} residual samples to archiver", buf.len());
            if let Ok(mut a) = transcriber.sys_archiver.lock() {
                a.write_samples(&buf);
            }
        }
    }

    // Wait for WASAPI polling thread to finish
    if let Some(handle) = wasapi_thread {
        let _ = handle.join();
    }

    println!("[LOOPBACK] Capture loop exited");
}

#[cfg(not(target_os = "windows"))]
pub fn capture_loop(transcriber: Arc<Transcriber>, stop_rx: watch::Receiver<bool>) {
    eprintln!("[LOOPBACK] System audio loopback is only supported on Windows");
    // Block until stop signal
    loop {
        if *stop_rx.borrow() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
