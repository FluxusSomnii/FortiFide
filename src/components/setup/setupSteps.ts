/**
 * Canonical step definitions for the Guided Setup wizard.
 *
 * Copy is taken from Section 22.3 of the Forti Fide spec. The wizard filters
 * this array by `build_variant`:
 *   gpu build → 7 steps (all)
 *   cpu build → 5 steps (steps 1 and 2 omitted — no GPU stack on CPU)
 *
 * `number` is the position in the strict dependency order enforced by the
 * Rust engine. When `blocking_step` is set, we match it against `number` to
 * select which step to highlight.
 */

import type { StepDefinition } from "./setupTypes";

export const STEPS: StepDefinition[] = [
  {
    number: 1,
    key: "gpu",
    name: "GPU and driver",
    purpose:
      "Forti Fide uses your NVIDIA GPU to transcribe audio locally at real-time speeds.",
    explanation:
      "Transcription is the Whisper large-v3 model — a ~3GB neural network that runs on your graphics card. On CPU, it would be 2–5x slower than the incoming audio and unusable for live sessions. The GPU check verifies we can see an NVIDIA card and that its driver is new enough to host the CUDA 12 runtime we'll install in the next step. If you don't have an NVIDIA GPU, you can still use the CPU build of Forti Fide for offline analysis of recorded audio.",
    whenToShow: "gpu_build_only",
  },
  {
    number: 2,
    key: "cuda",
    name: "CUDA 12 runtime",
    purpose:
      "The GPU libraries Forti Fide needs to run Whisper and PyTorch on your graphics card.",
    explanation:
      "Forti Fide uses Whisper (for transcription) and PyTorch (for speaker detection), both of which are compiled against the CUDA 12 runtime. If you have CUDA 13 installed, that's fine — they coexist. Forti Fide just needs the CUDA 12 DLLs to be present on your system. This is why we ask you to install CUDA 12 even if you have a newer version.",
    whenToShow: "gpu_build_only",
  },
  {
    number: 3,
    key: "python",
    name: "Python 3.11",
    purpose:
      "The Python interpreter that hosts the speaker-detection sidecar.",
    explanation:
      "Speaker detection (used in Speakers and Deep modes) runs in a small Python sidecar on port 19534. It needs Python 3.11 specifically — the pyannote library pins to this version. If you have a newer Python already installed (3.12, 3.13…), leave it alone; Python 3.11 will coexist. During installation, make sure to check \"Add Python to PATH\" so Forti Fide can find the interpreter without extra configuration.",
    whenToShow: "always",
  },
  {
    number: 4,
    key: "pyannote",
    name: "pyannote speaker model",
    purpose:
      "Installs the pyannote.audio library and its PyTorch dependency into Python 3.11.",
    explanation:
      "pyannote.audio is the neural network that identifies who is speaking. It depends on PyTorch — a large library with a GPU and a CPU build. The GPU build must be installed from NVIDIA's CUDA 12.1 index (cu121); if you grab the default from PyPI, you'll end up with the CPU-only build and speaker detection will run slowly. The install takes 2–4 minutes and downloads about 2GB.",
    whenToShow: "always",
  },
  {
    number: 5,
    key: "hf_token",
    name: "Hugging Face account token",
    purpose:
      "A free read-scope token that lets Forti Fide download the speaker models from Hugging Face.",
    explanation:
      "The pyannote models live on Hugging Face. Downloading them requires a free account and a personal access token with read scope. The token is stored only on your device, in your Forti Fide settings — it's never transmitted anywhere except directly to huggingface.co when fetching the models.",
    whenToShow: "always",
  },
  {
    number: 6,
    key: "hf_models",
    name: "Model licences accepted",
    purpose:
      "Confirms you've accepted the free pyannote model licences on your Hugging Face account.",
    explanation:
      "Both pyannote models (speaker-diarization-3.1 and segmentation-3.0) are free but require you to click \"Accept\" on their Hugging Face pages the first time. This is a one-off step tied to your account, not to the install. Once accepted, Forti Fide can verify access via the Hugging Face API.",
    whenToShow: "always",
  },
  {
    number: 7,
    key: "whisper",
    name: "Whisper transcription model",
    purpose:
      "The ~3GB Whisper large-v3 model that transcribes audio to text.",
    explanation:
      "Whisper large-v3 is the state-of-the-art open-source transcription model. It's a one-time ~3.1GB download that lives on your device from then on. All transcription happens locally — audio never leaves your machine. If the download is interrupted, Forti Fide detects the partial file and offers to resume.",
    whenToShow: "always",
  },
];

/**
 * Filter STEPS against the current build variant. CPU builds drop steps 1
 * and 2 entirely — not greyed out, not shown as "not applicable"; just
 * absent. That's the Section 22.5 invariant.
 */
export function stepsForBuild(variant: "gpu" | "cpu"): StepDefinition[] {
  return STEPS.filter((s) => {
    if (s.whenToShow === "always") return true;
    if (s.whenToShow === "gpu_build_only") return variant === "gpu";
    if (s.whenToShow === "cpu_build_only") return variant === "cpu";
    return true;
  });
}

/** Find the step definition whose `number` matches a blocking index. */
export function stepByNumber(n: number): StepDefinition | undefined {
  return STEPS.find((s) => s.number === n);
}
