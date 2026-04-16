"""
Fides Speaker Diarization Server
HTTP server on port 19534. Receives audio, returns speaker-labeled segments.
Uses pyannote.audio for speaker diarization with optional CUDA acceleration.
"""

import base64
import io
import json
import os
import sys
import threading
import wave
import struct
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Lazy imports — these are heavy, only load when needed
pipeline = None
model_ready = threading.Event()  # Thread-safe signal for model loaded state
HF_TOKEN = None


def get_settings_path():
    home = Path.home()
    return home / ".fides" / "settings.json"


def load_hf_token():
    global HF_TOKEN
    try:
        settings_path = get_settings_path()
        if settings_path.exists():
            with open(settings_path, "r") as f:
                settings = json.load(f)
            # Check fides-settings.json too
            fides_settings_path = settings_path.parent / "fides-settings.json"
            if fides_settings_path.exists():
                with open(fides_settings_path, "r") as f:
                    fides_settings = json.load(f)
                HF_TOKEN = fides_settings.get("huggingFaceToken") or settings.get("huggingFaceToken")
            else:
                HF_TOKEN = settings.get("huggingFaceToken")
    except Exception as e:
        print(f"[DIARIZE] Failed to load HF token: {e}", file=sys.stderr)
        HF_TOKEN = None


def load_pipeline(min_speakers=1, max_speakers=5):
    global pipeline

    if model_ready.is_set() and pipeline is not None:
        return True

    load_hf_token()

    if not HF_TOKEN:
        print("[DIARIZE] No HuggingFace token found. Set huggingFaceToken in settings.", file=sys.stderr)
        return False

    try:
        print("[DIARIZE] Importing torch...")
        import torch
        print(f"[DIARIZE] torch {torch.__version__}, CUDA available: {torch.cuda.is_available()}")

        print("[DIARIZE] Importing pyannote.audio Pipeline...")
        from pyannote.audio import Pipeline as PyannotePipeline

        print(f"[DIARIZE] Calling Pipeline.from_pretrained('pyannote/speaker-diarization-3.1')...")
        sys.stdout.flush()
        pipeline = PyannotePipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=HF_TOKEN,
        )
        print("[DIARIZE] Pipeline.from_pretrained() returned successfully")
        sys.stdout.flush()

        # Use GPU if available
        if torch.cuda.is_available():
            pipeline = pipeline.to(torch.device("cuda"))
            print("[DIARIZE] Using CUDA GPU acceleration")
        else:
            print("[DIARIZE] Using CPU (no CUDA available)")

        model_ready.set()
        print("[DIARIZE] Model loaded successfully — model_ready is SET")
        sys.stdout.flush()
        return True

    except Exception as e:
        import traceback
        print(f"[DIARIZE] Failed to load model: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        return False


def pcm_f32_to_wav_bytes(audio_f32, sample_rate=16000):
    """Convert f32 PCM samples to WAV byte buffer."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        # Convert f32 to i16
        i16_data = b""
        for sample in audio_f32:
            clamped = max(-1.0, min(1.0, sample))
            i16_data += struct.pack("<h", int(clamped * 32767))
        wf.writeframes(i16_data)
    buf.seek(0)
    return buf


def diarize_audio(audio_b64, sample_rate=16000, min_speakers=1, max_speakers=5):
    """Run diarization on base64-encoded audio. Returns speaker segments."""
    global pipeline

    # Always wait for model_ready — even if pipeline looks set, ensure the event fired
    model_ready.wait(timeout=60)

    # Re-read pipeline after wait (thread may have just set it)
    if pipeline is None:
        return {"error": "Pipeline still None after 60s wait"}

    try:
        import torch
        import numpy as np

        # Decode base64 audio into raw samples
        raw_bytes = base64.b64decode(audio_b64)

        if raw_bytes[:4] == b"RIFF":
            # WAV format — decode via wave module
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                sr = wf.getframerate()
                n_frames = wf.getnframes()
                raw_pcm = wf.readframes(n_frames)
                samples = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0
        else:
            # Raw f32 PCM
            samples = np.frombuffer(raw_bytes, dtype=np.float32)
            sr = sample_rate

        # Build waveform tensor: shape (1, num_samples) — mono channel
        waveform = torch.tensor(samples, dtype=torch.float32).unsqueeze(0)

        # Pass pre-loaded waveform dict to avoid torchcodec AudioDecoder
        diarization = pipeline(
            {"waveform": waveform, "sample_rate": sr},
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )

        # Extract annotation from pyannote 4.x DiarizeOutput
        annotation = diarization.speaker_diarization
        segments = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
            })

        # Map raw labels to human-readable names
        speaker_map = {}
        counter = 1
        for seg in segments:
            raw = seg["speaker"]
            if raw not in speaker_map:
                speaker_map[raw] = f"Person {counter}"
                counter += 1
            seg["speaker"] = speaker_map[raw]

        return {"segments": segments, "speaker_count": len(speaker_map)}

    except Exception as e:
        import traceback
        print(f"[DIARIZE] Diarization error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return {"error": str(e)}


class DiarizeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[DIARIZE] {format % args}")

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        if self.path == "/status":
            self._set_headers()
            self.wfile.write(json.dumps({
                "running": True,
                "model_loaded": model_ready.is_set(),
            }).encode())
            return

        if self.path == "/health":
            self._set_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
            return

        self._set_headers(404)
        self.wfile.write(json.dumps({"error": "Not found"}).encode())

    def do_POST(self):
        if self.path == "/diarize":
            # Block until model is ready (up to 60s)
            if not model_ready.is_set():
                print("[DIARIZE] /diarize waiting for model to load...")
                sys.stdout.flush()
                ready = model_ready.wait(timeout=60)
                if ready:
                    print("[DIARIZE] /diarize model became ready, proceeding")
                    sys.stdout.flush()
                else:
                    print("[DIARIZE] /diarize timed out waiting for model (60s)")
                    sys.stdout.flush()
                    self._set_headers(503)
                    self.wfile.write(json.dumps({"error": "Model not loaded after 60s timeout"}).encode())
                    return

            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
                return

            audio_b64 = data.get("audio_b64", "")
            sample_rate = data.get("sample_rate", 16000)
            min_speakers = data.get("min_speakers", 1)
            max_speakers = data.get("max_speakers", 5)

            if not audio_b64:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Missing audio_b64"}).encode())
                return

            result = diarize_audio(audio_b64, sample_rate, min_speakers, max_speakers)

            if "error" in result:
                self._set_headers(500)
            else:
                self._set_headers()

            self.wfile.write(json.dumps(result).encode())
            return

        if self.path == "/load-model":
            success = load_pipeline()
            self._set_headers(200 if success else 500)
            self.wfile.write(json.dumps({
                "ok": success,
                "model_loaded": model_ready.is_set(),
            }).encode())
            return

        self._set_headers(404)
        self.wfile.write(json.dumps({"error": "Not found"}).encode())


def _auto_load_model():
    """Background thread: load pyannote model automatically on startup."""
    import traceback
    try:
        print(f"[DIARIZE] Auto-loading model in background thread ({threading.current_thread().name})...")
        sys.stdout.flush()
        load_hf_token()
        if not HF_TOKEN:
            print("[DIARIZE] No HuggingFace token found — skipping auto-load. "
                  "Set huggingFaceToken in ~/.fides/fides-settings.json.", file=sys.stderr)
            sys.stderr.flush()
            return
        print(f"[DIARIZE] HF token loaded ({HF_TOKEN[:8]}...{HF_TOKEN[-4:]})")
        sys.stdout.flush()
        success = load_pipeline()
        if not success:
            print("[DIARIZE] Auto-load failed. Model can be loaded later via POST /load-model.", file=sys.stderr)
            sys.stderr.flush()
        else:
            print(f"[DIARIZE] Auto-load complete. model_ready={model_ready.is_set()}")
            sys.stdout.flush()
    except Exception as e:
        print(f"[DIARIZE] Auto-load thread crashed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()


def main():
    port = 19534
    server = HTTPServer(("127.0.0.1", port), DiarizeHandler)
    print(f"[DIARIZE] Speaker diarization server listening on http://127.0.0.1:{port}")

    # Auto-load model in a background thread so the server can accept
    # requests (like /status and /health) while the model downloads/loads
    loader = threading.Thread(target=_auto_load_model, name="model-loader", daemon=True)
    loader.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[DIARIZE] Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
