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
| **Annotates** | 60+ rhetorical patterns detected and marked in real time |
| **Stores** | Sessions saved locally. Nothing transmitted. |
| **Reflects** | Patterns over time, sovereignty ratio, register map, what has been arriving |

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
| **Capture** | Manual session recording |
| **Live** | Real-time transcription with live annotation |
| **Deep** | Extended session with full diarization |

## Privacy

All data is stored locally. The only external connection is the Claude API for AI Analysis — opt-in, triggered manually, never automatic. Full privacy policy in `/docs/privacy-policy.md`.

## Status

Active development. OSS release in preparation.

## License

GPL v3. The pattern library is open. The detection logic is auditable. No fork may obscure the pattern detection methodology.

## Part of the Fluxus Somnii ecosystem

Forti Fide is the first instrument in the Fluxus Somnii ecosystem. It sees what the world does to language in your environment.

- **Omnisomnii** — sees what you are inside
- **Hices** — serves what you produce
- **Fluxus Somnii** — what we become when enough of us see clearly together

[fortifide.org](https://fortifide.org) · [fluxussomnii.com](https://fluxussomnii.com)

---

*The instrument does not coerce. It returns awareness. What the user does with that awareness is entirely and only theirs.*
