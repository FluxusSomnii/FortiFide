import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

/**
 * Shown on app mount if the previous session crashed (sentinel file was
 * still present on startup). Offers to save a diagnostic zip to the Desktop
 * or dismiss. Nothing is sent anywhere — the user decides what to do with
 * the file.
 */

// Visual tokens — matches the OnboardingModal / PythonVersionModal palette.
const BG = "#0c0c12";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#e4e2dc";
const MUTED = "rgba(228,226,220,0.55)";
const ACCENT = "#AFA9EC";
const ERR_ACCENT = "#e2786e";

const TITLE_FONT = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function CrashRecoveryDialog() {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<{ crashed: boolean }>("check_crash_recovery")
      .then((r) => {
        if (!cancelled && r.crashed) setShow(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const path = await invoke<string>("save_diagnostic_report");
      setSavedPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenFolder = async () => {
    if (savedPath) {
      // Open the containing folder (parent of the zip file)
      const folder = savedPath.replace(/\\[^\\]+$/, "").replace(/\/[^/]+$/, "");
      try {
        await shellOpen(folder);
      } catch {
        // fallback: try opening the file itself
        try { await shellOpen(savedPath); } catch {}
      }
    }
  };

  const dismiss = () => setShow(false);

  const backdrop: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    background: "rgba(0,0,0,0.7)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  };

  const surface: CSSProperties = {
    width: "100%",
    maxWidth: 480,
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: "28px 30px 24px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  const title: CSSProperties = {
    fontFamily: TITLE_FONT,
    fontSize: 20,
    fontWeight: 400,
    color: TEXT,
    marginBottom: 12,
  };

  const para: CSSProperties = {
    fontFamily: BODY_FONT,
    fontSize: 13,
    lineHeight: 1.6,
    color: TEXT,
    marginBottom: 16,
  };

  const btnBase: CSSProperties = {
    fontFamily: BODY_FONT,
    fontSize: 13,
    padding: "9px 16px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background 0.15s",
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
    <div role="dialog" aria-modal="true" aria-label="Crash recovery" style={backdrop}>
      <div style={surface}>
        <h2 style={title}>Forti Fide didn't close properly</h2>

        {!savedPath ? (
          <>
            <p style={para}>
              The previous session may have crashed. A diagnostic report can help
              us fix this — it contains system info and recent app logs.
            </p>
            <p style={{ ...para, color: MUTED, fontSize: 12, marginBottom: 20 }}>
              No recordings, transcripts, or API keys are included. The report is
              saved to your Desktop — nothing is sent anywhere.
            </p>
            {error && (
              <p style={{ ...para, color: ERR_ACCENT, fontSize: 12 }}>{error}</p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={dismiss} style={btnGhost}>
                Dismiss
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  ...btnPrimary,
                  opacity: saving ? 0.6 : 1,
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save report to Desktop"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={para}>
              Report saved to your Desktop:
            </p>
            <div
              style={{
                fontFamily: "'DM Mono', 'Courier New', monospace",
                fontSize: 11,
                color: ACCENT,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                padding: "10px 12px",
                marginBottom: 16,
                wordBreak: "break-all",
                userSelect: "text",
              }}
            >
              {savedPath}
            </div>
            <p style={{ ...para, color: MUTED, fontSize: 12, marginBottom: 20 }}>
              You can email this file or attach it to a{" "}
              <button
                type="button"
                onClick={() => shellOpen("https://github.com/FluxusSomnii/FortiFide/issues/new").catch(() => {})}
                style={{
                  color: ACCENT,
                  textDecoration: "underline",
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  cursor: "pointer",
                }}
              >
                GitHub issue
              </button>
              .
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={handleOpenFolder} style={btnGhost}>
                Open folder
              </button>
              <button type="button" onClick={dismiss} style={btnPrimary}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
