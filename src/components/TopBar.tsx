import { useCallback, useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/session-store";
import { PythonVersionModal, type PythonStatus } from "./PythonVersionModal";
import type { SetupState } from "./setup/setupTypes";
import { isModeAvailable, type CaptureMode } from "../lib/modeAvailability";

type AudioSource = "microphone" | "loopback" | "both";

const MODE_OPTIONS: Array<{ key: CaptureMode; label: string; tip: string }> = [
  { key: "deep", label: "DEEP", tip: "Whisper + diarization + LLM. Best speaker accuracy, ~15s latency." },
  { key: "live", label: "SPEAKERS", tip: "Whisper + diarization. Speaker labels with ~5-10s delay." },
  { key: "capture", label: "TRANSCRIBE", tip: "Whisper only. Fastest output, no speaker detection." },
];

const SOURCE_OPTIONS: Array<{ key: AudioSource; label: string; tip: string }> = [
  { key: "microphone", label: "MIC", tip: "Capture audio from your microphone." },
  { key: "loopback", label: "INCOMING", tip: "Capture audio playing through your speakers." },
  { key: "both", label: "BOTH", tip: "Capture both speakers and microphone simultaneously." },
];

/**
 * Option shape for PillGroup. `disabled` + `disabledTip` are optional so
 * non-mode pills (sources) stay simple. Per §22.5 Prompt 2b.1: disabled
 * pills remain visible at reduced opacity and still receive clicks — the
 * onChange handler uses the disabled state to route the click (wizard
 * deep-link instead of mode switch). We deliberately do NOT set the HTML
 * `disabled` attribute, which would suppress the click event entirely.
 */
interface PillOption<T extends string> {
  key: T;
  label: string;
  tip?: string;
  disabled?: boolean;
  disabledTip?: string;
}

function PillGroup<T extends string>({
  options,
  selected,
  onChange,
  onTipEnter,
  onTipLeave,
}: {
  options: Array<PillOption<T>>;
  selected: T;
  onChange: (key: T) => void;
  onTipEnter?: (e: React.MouseEvent, text: string) => void;
  onTipLeave?: () => void;
}) {
  return (
    <div style={{
      display: "flex", background: "#0f0f12", padding: 3, borderRadius: 7, border: "1px solid #1a1a1e",
    }}>
      {options.map((opt) => {
        const disabled = opt.disabled === true;
        const tipText = disabled && opt.disabledTip ? opt.disabledTip : opt.tip;
        return (
          <button key={opt.key} onClick={() => onChange(opt.key)}
            onMouseEnter={(e) => tipText && onTipEnter?.(e, tipText)}
            onMouseLeave={() => onTipLeave?.()}
            style={{
              padding: "5px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
              background: selected === opt.key ? "#1c1c26" : "transparent",
              border: selected === opt.key ? "1px solid #28283a" : "1px solid transparent",
              borderRadius: 5, color: selected === opt.key ? "#ccc" : "#777",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "help" : "pointer",
              fontFamily: "inherit",
            }}>{opt.label}</button>
        );
      })}
    </div>
  );
}

export async function startCapture() {
  const store = useSessionStore.getState();
  store.setAudioError(null);
  store.setRecordAudio(true);
  try {
    await invoke("start_audio_capture", {
      source: store.settings.audioSource ?? "loopback",
      mode: store.captureMode,
      recordAudio: true,
      micDevice: store.settings.micDevice ?? null,
    });
    store.setAudioCapturing(true);
  } catch (err) {
    store.setAudioError(err instanceof Error ? err.message : String(err));
  }
}

interface TopBarProps {
  sidebarOpen: boolean;
  onExpandSidebar: () => void;
  /**
   * Current setup state from the Rust engine. `null` during first paint —
   * isModeAvailable treats null as "all modes available" so we don't flash
   * disabled pills on every launch. See src/lib/modeAvailability.ts.
   */
  setupState?: SetupState | null;
  /** Open the Guided Setup wizard, optionally at a specific step (1..=7). */
  onOpenSetupWizard?: (step?: number) => void;
}

export function TopBar({ sidebarOpen, onExpandSidebar, setupState, onOpenSetupWizard }: TopBarProps) {
  const isCapturing = useSessionStore((s) => s.isAudioCapturing);
  const captureMode = useSessionStore((s) => s.captureMode);
  const settings = useSessionStore((s) => s.settings);

  const audioSource = settings.audioSource ?? "loopback";

  // Python-version gate — Speakers (live) and Deep modes require Python 3.11.
  // Probe once on mount and cache; the Rust side also caches so repeated
  // invocations across the session cost nothing.
  const [pythonStatus, setPythonStatus] = useState<PythonStatus | null>(null);
  const [pythonModal, setPythonModal] = useState<PythonStatus | null>(null);
  useEffect(() => {
    invoke<PythonStatus>("get_python_status")
      .then(setPythonStatus)
      .catch((err) => {
        // If the command itself fails (shouldn't on a correctly built app),
        // stay optimistic — don't block the user.
        console.error("[TOPBAR] get_python_status failed:", err);
        setPythonStatus({ status: "ok", version: null });
      });
  }, []);

  // Tooltip state
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTip = useCallback((e: React.MouseEvent, text: string) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    const mx = e.clientX; const my = e.clientY;
    tipTimer.current = setTimeout(() => setTip({ text, x: mx, y: my }), 300);
  }, []);
  const hideTip = useCallback(() => {
    if (tipTimer.current) { clearTimeout(tipTimer.current); tipTimer.current = null; }
    setTip(null);
  }, []);

  const toggleCapture = useCallback(async () => {
    const store = useSessionStore.getState();
    if (store.isAudioCapturing) {
      try {
        await invoke("stop_audio_capture");
        store.setAudioCapturing(false);
        // If there's text captured, show exit ritual card
        if (store.capturedText.length > 0) {
          store.setShowExitCard(true);
        }
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
      }
    } else {
      // Warn if there's an unsaved session with content
      if (store.capturedText.length > 0) {
        const proceed = window.confirm(
          "You have an unsaved capture session. Starting a new capture will discard it.\n\nContinue?"
        );
        if (!proceed) return;
        store.clearSession();
      }
      // Show entry ritual card — actual capture starts after card completes or is skipped
      store.setShowEntryCard(true);
    }
  }, []);

  const handleModeChange = useCallback(async (mode: CaptureMode) => {
    const store = useSessionStore.getState();
    // Gate 1: Guided Setup state. If the chosen mode's dependencies aren't
    // all green per SetupState, open the wizard at the blocking step
    // instead of switching. The pill click acts as a deep-link.
    const availability = isModeAvailable(mode, setupState ?? null);
    if (!availability.available) {
      onOpenSetupWizard?.(availability.blockingStep ?? undefined);
      return;
    }
    // Gate 2 (legacy): Python-version probe. The setup engine already
    // covers Python 3.11 presence, so this should be redundant, but we
    // keep it as a belt-and-braces fallback in case the two probes drift
    // (e.g. user uninstalls Python 3.11 mid-session without re-running
    // the wizard). If fired, it surfaces the existing PythonVersionModal.
    if ((mode === "live" || mode === "deep") && pythonStatus && pythonStatus.status !== "ok") {
      setPythonModal(pythonStatus);
      return;
    }
    store.setCaptureMode(mode);
    store.updateSetting("captureMode", mode);
    if (store.isAudioCapturing) {
      try {
        await invoke("stop_audio_capture");
        await invoke("start_audio_capture", {
          source: store.settings.audioSource ?? "loopback",
          mode,
          recordAudio: true,
        });
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [pythonStatus, setupState, onOpenSetupWizard]);

  const handleSourceChange = useCallback(async (source: AudioSource) => {
    const store = useSessionStore.getState();
    store.updateSetting("audioSource", source);
    if (store.isAudioCapturing) {
      try {
        await invoke("start_audio_capture", {
          source,
          mode: store.captureMode,
          recordAudio: true,
        });
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const handlePreset = useCallback((presetId: string) => {
    const store = useSessionStore.getState();
    const preset = store.settings.presets?.find((p) => p.id === presetId);
    if (!preset) return;
    store.setCaptureMode(preset.captureMode);
    store.updateSetting("captureMode", preset.captureMode);
    store.updateSetting("chunkSizeSeconds", preset.chunkSizeSeconds);
    store.updateSetting("confidenceFloor", preset.confidenceFloor);
    store.updateSetting("audioSource", preset.audioSource);
    store.updateSetting("dedupSensitivity", preset.dedupSensitivity);
  }, []);

  const handleReset = useCallback(() => {
    const store = useSessionStore.getState();
    store.clearSession();
    store.resetClip();
  }, []);

  const divider = <div style={{ width: 1, height: 16, background: "#1a1a1e", flexShrink: 0 }} />;

  return (
    <div style={{
      background: "#0d0d0f", borderBottom: "1px solid #1a1a1e", padding: "9px 18px",
      display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
    }}>
      {!sidebarOpen && (
        <button onClick={onExpandSidebar} style={{
          background: "none", border: "none", color: "#444", fontSize: 14, cursor: "pointer", padding: "2px 6px",
        }}>›</button>
      )}

      {/* Start/Stop */}
      <button onClick={toggleCapture}
        onMouseEnter={(e) => showTip(e, isCapturing ? "Stop audio capture" : "Start audio capture")}
        onMouseLeave={hideTip}
        style={{
          padding: "6px 16px", borderRadius: 7, fontSize: 10, letterSpacing: "0.1em", fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
          background: isCapturing ? "#1e1010" : "#101e10",
          border: isCapturing ? "1px solid #e85d4a55" : "1px solid #4ade8055",
          color: isCapturing ? "#e85d4a" : "#4ade80",
        }}>{isCapturing ? "■ Stop" : "▶ Start"}</button>

      {/* Mode — each pill is individually gated on setupState. Disabled
          pills stay visible at 0.5 opacity with `cursor: help`; clicking
          one opens the wizard at the blocking step (§22.5 Prompt 2b.1). */}
      <PillGroup
        options={MODE_OPTIONS.map((o) => {
          const availability = isModeAvailable(o.key, setupState ?? null);
          return availability.available
            ? o
            : {
                ...o,
                disabled: true,
                disabledTip: `${availability.reason} \u2192`,
              };
        })}
        selected={captureMode}
        onChange={handleModeChange}
        onTipEnter={showTip}
        onTipLeave={hideTip}
      />

      {/* Preset */}
      <select
        value=""
        onChange={(e) => { if (e.target.value) { handlePreset(e.target.value); e.target.value = ""; } }}
        onMouseEnter={(e) => showTip(e, "Load a capture preset")}
        onMouseLeave={hideTip}
        style={{
          background: "#0f0f12", border: "1px solid #1a1a1e", borderRadius: 5,
          color: "#555", fontSize: 10, padding: "5px 8px", cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <option value="">Preset ▾</option>
        {(settings.presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {divider}

      {/* Source */}
      <PillGroup options={SOURCE_OPTIONS} selected={audioSource} onChange={handleSourceChange} onTipEnter={showTip} onTipLeave={hideTip} />


      <div style={{ flex: 1 }} />

      {/* Reset */}
      <button onClick={handleReset}
        onMouseEnter={(e) => showTip(e, "Clear current session data")}
        onMouseLeave={hideTip}
        style={{
          background: "none", border: "1px solid #2a1e1e", borderRadius: 5,
          color: "#664444", fontSize: 10, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit",
        }}>Reset</button>

      {/* Tooltip */}
      {tip && (() => {
        const pad = 10;
        const flipX = tip.x > window.innerWidth * 0.7;
        const s: React.CSSProperties = {
          position: "fixed", top: tip.y + pad,
          background: "#1a1a22", border: "1px solid #2a2a3a", borderRadius: 6,
          padding: "6px 10px", fontSize: 11, color: "#999", pointerEvents: "none",
          zIndex: 9999, maxWidth: 250, whiteSpace: "pre-wrap", boxShadow: "0 2px 8px #00000066",
        };
        if (flipX) { s.right = window.innerWidth - tip.x + pad; } else { s.left = tip.x + pad; }
        return <div style={s}>{tip.text}</div>;
      })()}

      {pythonModal && (
        <PythonVersionModal
          pythonStatus={pythonModal}
          onUseCapture={() => {
            const store = useSessionStore.getState();
            store.setCaptureMode("capture");
            store.updateSetting("captureMode", "capture");
          }}
          onClose={() => setPythonModal(null)}
        />
      )}
    </div>
  );
}
