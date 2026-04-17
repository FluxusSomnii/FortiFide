# Forti Fide — Setup Guide

> Getting Forti Fide running on your machine.

---

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Windows | 10 or 11 | macOS support in progress |
| NVIDIA GPU | Any CUDA-capable card | Required — v0.1.1 ships a GPU-only build |
| CUDA | 12.x | Required — guided setup will help you install it if missing |
| Python | 3.11 | Required for Speakers and Deep modes. Guided setup installs `pyannote.audio` for you. Not needed for Transcribe mode. |
| RAM | 8GB minimum | 16GB recommended for Deep mode |
| Disk space | 4GB free | For Whisper model weights |

> **Which build do I download?** v0.1.1 ships a single GPU-accelerated
> build. It requires an NVIDIA card and CUDA 12.x. If CUDA is missing,
> the guided setup will walk you through installing it. A CPU-only build
> is planned for a later release.

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
> fully. Speakers and Deep modes require the pyannote licence and
> `pyannote.audio` installed in Python 3.11 on your machine. The guided
> setup wizard installs `pyannote.audio` for you — no terminal needed. If
> you want to install it manually, see the fallback at the end of this guide.

---

## Step 3 — First launch

Launch Forti Fide. On first launch it will:

1. Download Whisper large-v3 model weights (~3GB) — this takes a few minutes
2. Download pyannote models if your Hugging Face token is configured
3. Activate CUDA acceleration for Whisper

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
This means CUDA 12.x is not installed. In v0.1.1 the guided setup detects
this automatically and links you to the CUDA download. If the wizard did
not trigger, install the CUDA Toolkit manually:

**developer.nvidia.com/cuda-downloads**
Select Windows → x86_64 → your Windows version → exe (local).
After installing, relaunch Forti Fide. Run `nvidia-smi` in a terminal to
confirm your GPU and driver version are detected.

**Whisper download stuck**
Check your internet connection. The model is hosted on Hugging Face.
If you're behind a proxy, configure it in Settings → Network.

**pyannote models not loading**
Verify your Hugging Face token has read access and that you accepted
both licence agreements (speaker-diarization-3.1 and segmentation-3.0).

**Speakers mode is unavailable or crashes**
Speakers and Deep modes require `pyannote.audio` in your Python 3.11.
Open **Settings → Setup status → Speakers**, or click the disabled
Speakers mode selector, to launch the guided setup. The wizard installs
`pyannote.audio` for you and verifies the pyannote licence is accepted.
If you would rather install manually, see **Manual diarization setup
(fallback)** below.

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

## Manual diarization setup (fallback)

The guided setup wizard in v0.1.1 installs `pyannote.audio` for you, so
most users do not need these steps. Use this only if you prefer a
terminal-driven setup or the wizard cannot run on your machine:

1. Install Python 3.11 from **python.org/downloads**. Check "Add Python
   to PATH" during installation on Windows.
2. Open a terminal and run:
   ```
   py -3.11 -m pip install pyannote.audio
   ```
3. Accept the pyannote licence on Hugging Face (see Step 2 above) and
   paste your Hugging Face token into Forti Fide Settings.
4. Restart Forti Fide. The diarization service starts automatically.

---

## Getting help

- Issues and bug reports: **github.com/FluxusSomnii/FortiFide/issues**
- Documentation: **fortifide.org/docs**

