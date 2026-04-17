/**
 * Check 7 — Whisper large-v3 model download.
 *
 * Unlike pyannote install (Check 4), the app already has a working in-app
 * download path for the Whisper model: the Tauri command `download_model`
 * plus the `fides://model-download-progress` event stream. Rather than
 * build a second path, we wire into the existing one. This is the one
 * action card in 2a that performs a real side effect.
 *
 * If the backend command fails, the card falls back to a manual "download
 * on first capture" instruction — historically the model auto-downloads the
 * first time capture is started, so the user isn't blocked by a failed
 * wizard-initiated download.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CheckResult, WhisperDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { bodyStyle, smallStyle, COLORS } from "../setupStyles";

interface Props {
  check: CheckResult<WhisperDetails>;
  onRecheck: () => void;
}

interface ProgressPayload {
  downloaded: number;
  total: number;
}

export function WhisperActionCard({ check, onRecheck }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to progress events only while a download is in flight; the
  // Rust side emits the same event from other code paths too, and we don't
  // want leaking listeners to fight for the UI state.
  useEffect(() => {
    if (!downloading) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<string | ProgressPayload>(
          "fides://model-download-progress",
          (event) => {
            const payload = event.payload;
            try {
              const data =
                typeof payload === "string"
                  ? (JSON.parse(payload) as ProgressPayload)
                  : (payload as ProgressPayload);
              if (!cancelled) setProgress(data);
            } catch {
              // ignore malformed events
            }
          },
        );
      } catch (e) {
        console.error("[SETUP] failed to subscribe to model progress:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [downloading]);

  if (check.status === "ok") return null;

  const startDownload = async () => {
    setError(null);
    setProgress(null);
    setDownloading(true);
    try {
      await invoke<string>("download_model");
      onRecheck();
    } catch (e) {
      console.error("[SETUP] download_model failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null;

  const isWrongVersion = check.status === "wrong_version";

  return (
    <ActionCardShell ariaLabel="Whisper model download">
      <p style={bodyStyle}>
        {isWrongVersion
          ? "The Whisper model file is the wrong size — most likely a partial download. Download again to replace it."
          : "Forti Fide needs the Whisper large-v3 model to transcribe audio. This is a one-time ~3.1GB download."}
      </p>
      {downloading && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 12px",
            background: COLORS.codeBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ ...smallStyle, color: COLORS.text }}>
            Downloading{pct !== null ? ` — ${pct}%` : "…"}
          </div>
          <div
            style={{
              width: "100%",
              height: 4,
              background: COLORS.border,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: pct !== null ? `${pct}%` : "15%",
                height: "100%",
                background: COLORS.accent,
                transition: "width 200ms linear",
              }}
            />
          </div>
        </div>
      )}
      {error && (
        <div
          style={{
            ...smallStyle,
            color: COLORS.err,
            padding: "8px 10px",
            background: "rgba(224,122,122,0.08)",
            border: "1px solid rgba(224,122,122,0.2)",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton
          variant="primary"
          disabled={downloading}
          onClick={startDownload}
        >
          {downloading ? "Downloading…" : "Download model"}
        </WizardButton>
        <WizardButton
          variant="secondary"
          disabled={downloading}
          onClick={onRecheck}
        >
          Re-check
        </WizardButton>
      </div>
      <p style={{ ...smallStyle, color: COLORS.muted }}>
        If you prefer, the model will auto-download on your first capture.
        Pre-downloading here just gets the wait out of the way.
      </p>
    </ActionCardShell>
  );
}
