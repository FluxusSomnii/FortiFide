/**
 * Shared mode-gating helper (Section 22, Prompt 2b.1).
 *
 * Single source of truth for "is this capture mode usable right now".
 * Every gating callsite — TopBar, LiveTranscript, SessionDetail's
 * retranscribe picker — imports this function rather than re-deriving the
 * logic. If the derivation changes (e.g. Deep mode adds a Claude-API gate
 * later) there is exactly one place to update.
 *
 * Why a pure function, not a hook:
 *   - The callsites get `SetupState` from different places (App-level prop
 *     drilling, Zustand selectors, or refetched inside a component).
 *   - Pure functions are free to call from anywhere without render-cycle
 *     coupling or dependency-array worries.
 *   - If the ergonomics warrant it later, `useModeAvailability()` can wrap
 *     this without moving the logic.
 */
import type { SetupState } from "../components/setup/setupTypes";

/**
 * Internal capture-mode keys. Per CLAUDE.md these are historical names —
 * the user-facing labels are Transcribe / Speakers / Deep, but the code
 * and persisted settings still use "capture" / "live" / "deep". Do not
 * rename the internal keys; other code paths (start_audio_capture, session
 * persistence, preset defaults) depend on them.
 */
export type CaptureMode = "capture" | "live" | "deep";

export interface ModeAvailability {
  available: boolean;
  /** Step number (1..=7) to deep-link the wizard to; null when available. */
  blockingStep: number | null;
  /** Short phrase for tooltips; null when available. */
  reason: string | null;
}

const OK: ModeAvailability = { available: true, blockingStep: null, reason: null };

/**
 * Decide whether a given capture mode is usable given the current
 * `SetupState`. When `state` is `null` (engine hasn't returned yet on
 * first paint) every mode is reported available — defaulting to disabled
 * would cause a visible flash of greyed-out pills for a few hundred ms on
 * every launch, which is worse than the one-frame optimistic case where
 * the user might click a disabled mode before the state lands. The wizard
 * still opens automatically on launch when `can_use_transcribe` is false,
 * so users never reach a real capture flow before the state resolves.
 */
export function isModeAvailable(
  mode: CaptureMode,
  state: SetupState | null,
): ModeAvailability {
  if (!state) return OK;

  const { derived } = state;

  if (mode === "capture") {
    return derived.can_use_transcribe
      ? OK
      : {
          available: false,
          blockingStep: derived.blocking_step ?? null,
          reason: "Complete setup to use Transcribe mode",
        };
  }

  // Speakers and Deep both require the full speakers dependency chain:
  // Python 3.11 + pyannote + valid HF token + accepted model licences.
  // Deep additionally uses the Claude API at capture time, but that is a
  // user setting rather than a machine dependency, so we do not gate on
  // it here — the runtime code path handles missing API keys with an
  // in-flow prompt.
  if (mode === "live" || mode === "deep") {
    return derived.can_use_speakers
      ? OK
      : {
          available: false,
          blockingStep: derived.blocking_step ?? null,
          reason:
            mode === "live"
              ? "Complete setup to use Speakers mode"
              : "Complete setup to use Deep mode",
        };
  }

  // Exhaustive check — unreachable, but satisfies TS and guards against a
  // future CaptureMode addition landing without gating rules.
  return OK;
}
