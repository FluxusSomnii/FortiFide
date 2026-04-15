# Forti Fide — Setup Guide

> Getting Forti Fide running on your machine.

---

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Windows | 10 or 11 | macOS support in progress |
| NVIDIA GPU | Any CUDA-capable card | CPU fallback available but slow |
| CUDA | 12.x | For GPU-accelerated transcription |
| RAM | 8GB minimum | 16GB recommended for Deep mode |
| Disk space | 4GB free | For Whisper model weights |

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

> **Note:** Without this step, Capture mode (Whisper only) still works fully.
> Live and Deep modes require the pyannote licence.

---

## Step 3 — First launch

Launch Forti Fide. On first launch it will:

1. Download Whisper large-v3 model weights (~3GB) — this takes a few minutes
2. Download pyannote models if your Hugging Face token is configured
3. Detect your GPU and configure CUDA acceleration automatically

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
| **Capture** | Transcription + pattern detection | Quick sessions, low resource usage |
| **Live** | + Speaker identification | When knowing who said what matters |
| **Deep** | + AI speaker attribution every 60s | Long sessions, complex conversations |

Start with **Capture** to verify everything is working.

---

## Troubleshooting

**"CUDA not available" — transcription is slow**
Verify your GPU drivers are up to date. Check that CUDA 12.x is installed:
`nvidia-smi` in a terminal should show your GPU and CUDA version.

**Whisper download stuck**
Check your internet connection. The model is hosted on Hugging Face.
If you're behind a proxy, configure it in Settings → Network.

**pyannote models not loading**
Verify your Hugging Face token has read access and that you accepted
both licence agreements (speaker-diarization-3.1 and segmentation-3.0).

**No audio captured**
Check Windows audio permissions: Settings → Privacy → Microphone.
Forti Fide needs microphone access enabled.

**Pattern detection not showing**
Ensure Auto-Analyse is enabled in the toolbar. Patterns appear after
a few seconds of transcription — the model needs context to detect patterns.

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

## Getting help

- Issues and bug reports: **github.com/FluxusSomnii/FortiFide/issues**
- Community forum: **fortifide.org/community**
- Documentation: **fortifide.org/docs**

