/**
 * Thin wrapper around the Tauri shell plugin's `open()` with a fallback
 * through the invoke bridge (the PythonVersionModal uses the same belt-and-
 * braces approach). Failures are logged but not thrown — the wizard's job is
 * to guide the user, not to block them because shell.open misbehaved.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as pluginOpen } from "@tauri-apps/plugin-shell";

export async function openExternal(url: string): Promise<void> {
  try {
    await pluginOpen(url);
  } catch (e) {
    console.error("[SETUP-WIZARD] shell.open failed, falling back:", e);
    try {
      await invoke("plugin:shell|open", { path: url });
    } catch (ee) {
      console.error("[SETUP-WIZARD] fallback invoke also failed:", ee);
    }
  }
}
