# Forti Fide

> *Forti Fide.* With strong trust.

A local instrument for rhetorical awareness. Open source. Private by default.

## What it is

Forti Fide captures audio from your environment, transcribes it locally using Whisper, detects rhetorical patterns in the transcript, and returns that annotation to you as self-knowledge. All of this happens on your device. Nothing leaves without your explicit choice.

**Truth is never one-sided.**

## What it does

| Function | Description |
|----------|-------------|
| **Captures** | Audio from your microphone or system, transcribed locally by Whisper large-v3 |
| **Annotates** | 28 rhetorical patterns detected and marked in real time |
| **Stores** | Sessions saved locally. Nothing transmitted. |
| **Reflects** | Patterns over time, sovereignty ratio, register map, what has been arriving |

## Installation

Download the latest release for Windows:
**[Forti Fide v0.1.1 — Windows x64 (GPU)](https://github.com/FluxusSomnii/FortiFide/releases/latest)**

System requirements:
- Windows 10 or 11
- NVIDIA GPU with CUDA 12.x (the built-in guided setup will help you install CUDA 12 if it is missing)
- 4GB disk space for Whisper model weights

On first launch, Forti Fide downloads the Whisper large-v3 model (~3GB).
For Speakers and Deep modes (speaker identification), the guided setup
walks you through Python 3.11, `pyannote.audio`, the pyannote licence on
Hugging Face, and your Hugging Face token — see [docs/setup.md](docs/setup.md)
for full instructions.

macOS support is in progress.

## The five registers

Every session is mapped across five rhetorical registers: Fear, Identity, Authority, Intimacy, Rational. The register map shows the emotional character of your information environment — not as a score, not as a judgment, as information.

## The sovereignty principle

Forti Fide does not decide what you should believe or consume. It does not filter your feed or block content. It does not tell you what conclusions to draw. It annotates what arrived and returns that annotation to you. What you do with what you see is entirely and only yours.

## No blocking. No filtering. No cloud processing. No account required. No advertising. No score.

The pattern library is open. The detection logic is auditable. The instrument cannot be tuned to serve undisclosed interests. The glass box is the product.

## Technical

- **Stack:** Tauri v2 + React + Rust + Node.js sidecar + Python diarization
- **Transcription:** Whisper large-v3, GPU-accelerated (CUDA)
- **Diarization:** pyannote (user must accept licence on Hugging Face)
- **Platform:** Windows and macOS desktop application
- **AI Analysis:** Claude API (opt-in, opt-out available, local model configurable)

## Capture modes

| Mode | Description |
|------|-------------|
| **Transcribe** | Whisper transcription + pattern detection |
| **Speakers** | + Speaker identification (pyannote) |
| **Deep** | + AI speaker attribution (Claude API, opt-in) |

## Privacy

All data is stored locally. The only external connection is the Claude API for AI Analysis — opt-in, triggered manually, never automatic. Full privacy policy in `/docs/privacy-policy.md`.

## Status

Active development. v0.1.1 — Guided Setup (Section 22).

## License

GPL v3. The pattern library is open. The detection logic is auditable. No fork may obscure the pattern detection methodology.

[fortifide.org](https://fortifide.org)

## Feedback and contributions

Bug reports and feature requests: [GitHub Issues](https://github.com/FluxusSomnii/FortiFide/issues)

Pattern library contributions welcome — see [docs/pattern-library.md](docs/pattern-library.md)
for the contribution guidelines.
