/**
 * Typed wrappers around Tauri commands that don't fit the HTTP sidecar
 * shaped `api` object in `src/bridge.ts`.
 *
 * The detection engine (spec §22.4) runs entirely on the Rust side and is
 * exposed as a single `get_setup_state` command. Every invocation re-checks
 * the machine — there is no cache to invalidate and no "setup_completed"
 * flag. Callers pay the detection cost each time; the Rust side wraps the
 * blocking work in `spawn_blocking`, so calling this from React is safe.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SetupState } from "../components/setup/setupTypes";

/**
 * Re-run the Guided Setup detection engine and return a fresh snapshot.
 *
 * Typical cost: ~1–2s on a warm machine, up to ~10s on first-run when
 * HuggingFace model-license HEAD requests are cold. The Rust side imposes a
 * 30s timeout on the pyannote probe and 10s on each HF request.
 */
export async function getSetupState(): Promise<SetupState> {
  return invoke<SetupState>("get_setup_state");
}
