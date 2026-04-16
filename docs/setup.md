# Forti Fide — Setup Guide

> Getting Forti Fide running on your machine.

---

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Windows | 10 or 11 | macOS support in progress |
| NVIDIA GPU | Any CUDA-capable card | Optional — CPU mode available but slower |
| CUDA | 12.x | Optional — required for GPU acceleration only |
| Python | Any 3.8+ with pyannote.audio installed | Required for Speakers and Deep modes. Not needed for Transcribe mode. |
| RAM | 8GB minimum | 16GB recommended for Deep mode |
| Disk space | 4GB free | For Whisper model weights |

> **Which build do I download?** The standard Forti Fide installer runs
> Whisper transcription on the CPU — it works on any Windows machine with
> no NVIDIA drivers required. A separate GPU-accelerated build is available
> for machines with an NVIDIA card and CUDA 12.x installed. If unsure,
> start with the standard build.

---

## Step 1 — Download Forti Fide

Download the latest release from:
**github.com/FluxusSomnii/FortiFide/releases**

Run the installer. Forti Fide installs to your user directory.
No administrator privileges required.

---

## Step 2 — Accept the pyannote licence (required for Live and Deep modes)

Forti Fide uses pyannote for speaker diarization in Live and Deep modes.
pyannote requires you to accept its licence directly on Hugging Face.

1. Go to: **huggingface.co/pyannote/speaker-diarization-3.1**
2. Log in or create a free Hugging Face account
3. Click **"Access repository"** and accept the licence terms
4. Go to: **huggingface.co/pyannote/segmentation-3.0**
5. Accept the licence terms there too
6. Go to: **huggingface.co/settings/tokens**
7. Create a new token (read access is sufficient)
8. Copy the token

In Forti Fide: open **Settings → Hugging Face Token** and paste your token.

> **Note:** Without this step, Transcribe mode (Whisper only) still works
> fully. Live and Deep modes require both the pyannote licence and
> `pyannote.audio` installed in a Python interpreter on your machine. See
> the manual diarization setup section below for the one-time v0.1.0 steps.

---

## Step 3 — First launch

Launch Forti Fide. On first launch it will:

1. Download Whisper large-v3 model weights (~3GB) — this takes a few minutes
2. Download pyannote models if your Hugging Face token is configured
3. Run Whisper on the CPU (standard build) or activate CUDA (GPU build)

The download happens once. Subsequent launches are immediate.

---

## Step 4 — Configure the Claude API (optional)

The AI Analysis feature uses the Claude API. It is opt-in and never
runs automatically — you trigger it manually per session.

If you want to use AI Analysis:

1. Go to **anthropic.com/api** and create an account
2. Generate an API key
3. In Forti Fide: open **Settings → Claude API Key** and paste your key

If you prefer not to use the Claude API, all other features work without it.
You can also configure a local model in Settings if you prefer fully offline operation.

---

## Step 5 — Choose your audio source

At the top of the main window, select your audio source:

| Option | What it captures |
|--------|----------------|
| **Mic** | Your microphone only |
| **Incoming** | System audio (what plays through your speakers) |
| **Both** | Microphone and system audio simultaneously |

For meetings and calls: **Both** captures everything.
For podcasts and media: **Incoming** is sufficient.
For your own speech only: **Mic**.

---

## The three capture modes

| Mode | What it does | When to use |
|------|-------------|-------------|
| **Transcribe** | Transcription + pattern detection | Quick sessions, low resource usage |
| **Speakers** | + Speaker identification | When knowing who said what matters |
| **Deep** | + AI speaker attribution every 60s | Long sessions, complex conversations |

Start with **Transcribe** to verify everything is working.

---

## Troubleshooting

**"cublas64_13.dll was not found" error on launch**
This means CUDA is not installed on the machine and you are trying to run
the GPU build. Two options:

1. Install the CUDA Toolkit for GPU acceleration:
   **developer.nvidia.com/cuda-downloads**
   Select Windows → x86_64 → your Windows version → exe (local).
   After installing, relaunch Forti Fide.
2. Download the standard (CPU) build instead. It runs on any Windows
   machine without CUDA, and shows a dismissible "Running in CPU mode"
   banner at the top of the window.

If you see this error and the app still launches, you are already running
in CPU mode and can safely dismiss the banner.

**Transcription is slow on the standard build**
The standard build runs Whisper on the CPU. For faster transcription on
large sessions, download the GPU-accelerated build (requires NVIDIA GPU
with CUDA 12.x installed). Run `nvidia-smi` in a terminal to confirm
your GPU and driver version.

**Whisper download stuck**
Check your internet connection. The model is hosted on Hugging Face.
If you're behind a proxy, configure it in Settings → Network.

**pyannote models not loading**
Verify your Hugging Face token has read access and that you accepted
both licence agreements (speaker-diarization-3.1 and segmentation-3.0).

**Speakers mode is unavailable or crashes**
Speakers and Deep modes require `pyannote.audio` to be importable from a
Python interpreter on your machine. If you see the "Speakers mode
unavailable" modal, install it by running in a terminal:

```
pip install pyannote.audio
```

Then restart Forti Fide. The app will try Python interpreters in this
order: `py -3.11`, `python3.11`, `python`, `python3` — the first one
that can import `pyannote.audio` is used.

In the current release (v0.1.0), the diarization server must be running
before Forti Fide can use Speakers or Deep mode. See **Manual diarization
setup (v0.1.0)** below.

**No audio captured**
Check Windows audio permissions: Settings → Privacy → Microphone.
Forti Fide needs microphone access enabled.

**Pattern detection not showing**
Pattern detection runs automatically as the transcript arrives — there
is no toggle. Patterns appear after a few seconds of speech; the model
needs some context before it can detect anything.

---

## Data and privacy

All data stays on your device. Forti Fide stores sessions at:
`%APPDATA%\fortifide\` on Windows

You have full access to these files at all times. Nothing is transmitted
to any server except:
- Whisper model download (one-time, from Hugging Face)
- pyannote model download (one-time, from Hugging Face)  
- Claude API calls (only when you manually press Analyse, if configured)

See the full privacy policy at: **fortifide.org/privacy**

---

## Manual diarization setup (v0.1.0)

Speakers and Deep modes use pyannote for speaker identification. In v0.1.0
this requires a one-time manual setup:

1. Make sure you have Python (any 3.8 or later) on your machine. If you
   don't, install from **python.org/downloads**. Check "Add Python to
   PATH" during installation on Windows.
2. Open a terminal and run:
   ```
   pip install pyannote.audio
   ```
   If you have multiple Python versions, use the interpreter you want
   Forti Fide to use (e.g. `py -3.11 -m pip install pyannote.audio` on
   Windows to target 3.11 specifically).
3. Accept the pyannote licence on Hugging Face (see Step 2 above).
4. Configure your Hugging Face token in Forti Fide Settings.
5. The diarization service starts automatically when you launch Forti Fide —
   no additional steps needed.

This will be automated in a future release.

---

## Getting help

- Issues and bug reports: **github.com/FluxusSomnii/FortiFide/issues**
- Documentation: **fortifide.org/docs**

