/**
 * TypeScript mirrors of the Rust SetupState shape (src-tauri/src/setup/types.rs).
 *
 * These types track the serde representation the engine emits, not what the
 * wizard spec describes in the abstract:
 *
 *   - Check.message (not error_message) is the human-readable note.
 *   - Check.details is optional; serde skips it when None, so consumers must
 *     always null-check before reading.
 *   - build_variant lives on Derived, not on SetupState's root.
 *   - SetupState.gpu / SetupState.cuda are absent on CPU builds (serde skips
 *     None), and the engine marks them Unknown when an earlier check blocked
 *     execution on GPU builds. UI treats "absent" and "unknown" differently:
 *     absent → don't render the row; unknown → render as muted dash.
 *
 * The hf_models check (Section 22.3 + Amendment 3) signals its failure mode
 * via Status rather than a dedicated failure_type field — see the engine:
 *     Status::Missing        → at least one licence not accepted (403)
 *     Status::WrongVersion   → token invalid at model-check time (401)
 *     Status::Unknown        → 5xx / network / unexpected (transient)
 * The action card discriminates on status to decide which remediation UI to
 * render; Amendment 3's rule is that network errors must never surface the
 * "accept licence" buttons.
 */

export type CheckStatus = 'ok' | 'missing' | 'wrong_version' | 'unknown';

/** Generic check result. `details` shape is check-specific.
 *
 *  The default was `Record<string, unknown>` for a while, intending to pin
 *  serialisability, but that constraint forced every concrete detail
 *  interface to declare an explicit `[k: string]: unknown` index signature
 *  to be assignable — which they don't, because TypeScript treats
 *  `interface { a: string }` as *not* assignable to `Record<string, unknown>`
 *  under strict mode. Serialisability isn't something we need to express in
 *  the type system (serde handles it Rust-side), so the default is now
 *  `unknown`: the top type, safe for every concrete detail interface. */
export interface CheckResult<D = unknown> {
  status: CheckStatus;
  /** Present on Ok (always) and sometimes on non-Ok when the engine has
   *  partial data worth showing (e.g. hf_models licence breakdown). */
  details?: D | null;
  /** Human-readable note. Present on all non-Ok; absent on plain Ok. */
  message?: string | null;
}

export interface GpuDetails {
  name: string;
  driver_version: string;
  vram_mb: number;
}

export interface CudaDetails {
  version_found: string;
  path: string;
}

export interface PythonDetails {
  version: string;
  path: string;
}

export interface PyannoteDetails {
  version: string;
  torch_cuda: boolean;
}

export interface HfTokenDetails {
  username: string;
}

/**
 * Amendment 3 failure discriminator for Check 6. Mirrors the Rust
 * `HfModelsFailureType` enum's serde-snake_case representation exactly.
 *
 *   licence_not_accepted → show per-model licence buttons (details.diarization
 *                           / segmentation tell us which ones failed).
 *   token_invalid         → route the user back to the token step; do not
 *                           show licence UI.
 *   network_error         → transient; single retry affordance; never show
 *                           licence UI.
 *   unexpected_response   → catch-all for surprising 4xx / malformed
 *                           responses; retry with the engine's raw message
 *                           for context. Never show licence UI.
 */
export type HfModelsFailureType =
  | "licence_not_accepted"
  | "token_invalid"
  | "network_error"
  | "unexpected_response";

export interface HfModelsDetails {
  diarization: boolean;
  segmentation: boolean;
  /** Present on every non-Ok outcome; absent on Ok. This is the wizard's
   *  single source of truth for which action card to render — do not fall
   *  back to branching on `status`, which would re-introduce the
   *  Prompt 2a regression Amendment 3 exists to prevent. */
  failure_type?: HfModelsFailureType;
}

export interface WhisperDetails {
  path: string;
  size_mb: number;
}

export interface DerivedState {
  can_use_transcribe: boolean;
  can_use_speakers: boolean;
  /** 1-based index (1..=7) of first non-Ok check, or absent when all applicable
   *  checks passed. Serde skips None, so treat `undefined` as "all green". */
  blocking_step?: number | null;
  build_variant: 'gpu' | 'cpu';
}

/**
 * Top-level state returned by `invoke('get_setup_state')`.
 *
 * `gpu` and `cuda` are only present on GPU builds; serde drops them on CPU
 * builds via `skip_serializing_if = "Option::is_none"`.
 */
export interface SetupState {
  gpu?: CheckResult<GpuDetails> | null;
  cuda?: CheckResult<CudaDetails> | null;
  python: CheckResult<PythonDetails>;
  pyannote: CheckResult<PyannoteDetails>;
  hf_token: CheckResult<HfTokenDetails>;
  hf_models: CheckResult<HfModelsDetails>;
  whisper: CheckResult<WhisperDetails>;
  derived: DerivedState;
}

/** Keys of SetupState that correspond to a concrete check. */
export type CheckKey =
  | 'gpu'
  | 'cuda'
  | 'python'
  | 'pyannote'
  | 'hf_token'
  | 'hf_models'
  | 'whisper';

/** Mapping from each CheckKey to its concrete Details interface.
 *
 *  Enables per-key narrowing in `getCheck` — callers get `CheckResult<GpuDetails>`
 *  for `'gpu'`, `CheckResult<PythonDetails>` for `'python'`, etc., without
 *  unsafe casts at every action-card boundary. */
export interface CheckDetailsByKey {
  gpu: GpuDetails;
  cuda: CudaDetails;
  python: PythonDetails;
  pyannote: PyannoteDetails;
  hf_token: HfTokenDetails;
  hf_models: HfModelsDetails;
  whisper: WhisperDetails;
}

export interface StepDefinition {
  /** 1..=7 position in the strict dependency order. */
  number: number;
  key: CheckKey;
  /** Short name shown in the left rail and detail heading. */
  name: string;
  /** One-line purpose shown below the heading. */
  purpose: string;
  /** Long-form markdown-ish text for the "Why is this needed?" expander. */
  explanation: string;
  /** Governs whether the step is rendered per build variant. */
  whenToShow: 'gpu_build_only' | 'cpu_build_only' | 'always';
}

/** Narrow SetupState[key] to a properly-typed CheckResult (or null for
 *  absent gpu/cuda on CPU builds). Generic over the key so callers get
 *  the concrete details type: `getCheck(state, 'gpu')` returns
 *  `CheckResult<GpuDetails> | null`, not `CheckResult<unknown> | null`. */
export function getCheck<K extends CheckKey>(
  state: SetupState,
  key: K,
): CheckResult<CheckDetailsByKey[K]> | null {
  // The inner `as` is the unavoidable friction of switch-narrowing under
  // a generic K — TS doesn't propagate the case label into the return type
  // on its own. Each branch returns the correctly-shaped SetupState field,
  // so the cast is sound by construction.
  switch (key) {
    case 'gpu':
      return (state.gpu ?? null) as CheckResult<CheckDetailsByKey[K]> | null;
    case 'cuda':
      return (state.cuda ?? null) as CheckResult<CheckDetailsByKey[K]> | null;
    case 'python':
      return state.python as CheckResult<CheckDetailsByKey[K]>;
    case 'pyannote':
      return state.pyannote as CheckResult<CheckDetailsByKey[K]>;
    case 'hf_token':
      return state.hf_token as CheckResult<CheckDetailsByKey[K]>;
    case 'hf_models':
      return state.hf_models as CheckResult<CheckDetailsByKey[K]>;
    case 'whisper':
      return state.whisper as CheckResult<CheckDetailsByKey[K]>;
  }
}
