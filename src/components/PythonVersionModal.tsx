import { type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

/**
 * Modal shown when the user tries to switch to Speakers or Deep mode but the
 * Rust-side probe couldn't find any Python interpreter with pyannote.audio.
 *
 * Parent is responsible for invoking `get_python_status` and deciding when
 * to mount this modal.
 */

export type PythonStatusCode = "ok" | "not_found";

export interface PythonStatus {
  status: PythonStatusCode;
  version: string | null;
}

interface Props {
  pythonStatus: PythonStatus;
  onUseCapture: () => void;
  onClose: () => void;
}

// Instructions live in the setup guide — we point there rather than trying
// to render a terminal command inside the modal.
const INSTRUCTIONS_URL =
  "https://github.com/FluxusSomnii/FortiFide/blob/main/docs/setup.md";

// Visual tokens — mirror OnboardingModal for consistency.
const BG = "#0c0c12";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#e4e2dc";
const MUTED = "rgba(228,226,220,0.55)";
const ACCENT = "#AFA9EC";

const TITLE_FONT = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function PythonVersionModal({ pythonStatus, onUseCapture, onClose }: Props) {
  if (pythonStatus.status === "ok") return null;

  const handleOpenInstructions = async () => {
    try {
      await shellOpen(INSTRUCTIONS_URL);
    } catch (e) {
      console.error("[PYTHON-MODAL] shell.open failed:", e);
      try {
        await invoke("plugin:shell|open", { path: INSTRUCTIONS_URL });
      } catch (ee) {
        console.error("[PYTHON-MODAL] fallback invoke also failed:", ee);
      }
    }
  };

  const backdrop: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1100,
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  };

  const surface: CSSProperties = {
    width: "100%",
    maxWidth: 500,
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: "30px 32px 26px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  const title: CSSProperties = {
    fontFamily: TITLE_FONT,
    fontSize: 22,
    fontWeight: 400,
    color: TEXT,
    marginBottom: 14,
  };

  const para: CSSProperties = {
    fontFamily: BODY_FONT,
    fontSize: 13,
    lineHeight: 1.6,
    color: TEXT,
    marginBottom: 16,
  };

  const code: CSSProperties = {
    display: "block",
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 12,
    color: ACCENT,
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "10px 12px",
    marginBottom: 20,
    userSelect: "text",
  };

  const btnBase: CSSProperties = {
    fontFamily: BODY_FONT,
    fontSize: 13,
    padding: "9px 16px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  };
  const btnPrimary: CSSProperties = {
    ...btnBase,
    background: "transparent",
    border: `1px solid ${ACCENT}`,
    color: ACCENT,
  };
  const btnGhost: CSSProperties = {
    ...btnBase,
    background: "transparent",
    border: "1px solid transparent",
    color: MUTED,
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Speakers mode unavailable" style={backdrop}>
      <div style={surface}>
        <h2 style={title}>Speakers mode unavailable</h2>
        <p style={para}>
          Speakers and Deep modes require <code style={{ fontFamily: "inherit", color: TEXT }}>pyannote.audio</code>{" "}
          to be installed. It was not found in any Python installation on your machine.
        </p>
        <p style={{ ...para, marginBottom: 8, color: MUTED, fontSize: 12 }}>
          Install it by running in a terminal:
        </p>
        <code style={code}>pip install pyannote.audio</code>
        <p style={{ ...para, color: MUTED, fontSize: 12, marginBottom: 22 }}>
          Then restart Forti Fide.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              onUseCapture();
              onClose();
            }}
            style={btnGhost}
          >
            Use Transcribe mode instead
          </button>
          <button type="button" onClick={handleOpenInstructions} style={btnPrimary}>
            Open terminal instructions →
          </button>
        </div>
      </div>
    </div>
  );
}
