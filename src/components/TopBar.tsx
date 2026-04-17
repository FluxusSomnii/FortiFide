import { useCallback, useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/session-store";
import { PythonVersionModal, type PythonStatus } from "./PythonVersionModal";

type CaptureMode = "capture" | "live" | "deep";
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

function PillGroup<T extends string>({
  options,
  selected,
  onChange,
  onTipEnter,
  onTipLeave,
}: {
  options: Array<{ key: T; label: string; tip?: string }>;
  selected: T;
  onChange: (key: T) => void;
  onTipEnter?: (e: React.MouseEvent, text: string) => void;
  onTipLeave?: () => void;
}) {
  return (
    <div style={{
      display: "flex", background: "#0f0f12", padding: 3, borderRadius: 7, border: "1px solid #1a1a1e",
    }}>
      {options.map((opt) => (
        <button key={opt.key} onClick={() => onChange(opt.key)}
          onMouseEnter={(e) => opt.tip && onTipEnter?.(e, opt.tip)}
          onMouseLeave={() => onTipLeave?.()}
          style={{
            padding: "5px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
            background: selected === opt.key ? "#1c1c26" : "transparent",
            border: selected === opt.key ? "1px solid #28283a" : "1px solid transparent",
            borderRadius: 5, color: selected === opt.key ? "#ccc" : "#777", cursor: "pointer",
            fontFamily: "inherit",
          }}>{opt.label}</button>
      ))}
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

export function TopBar({ sidebarOpen, onExpandSidebar }: { sidebarOpen: boolean; onExpandSidebar: () => void }) {
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
    // Gate: Speakers/Deep require Python 3.11. If the probe came back with
    // anything other than "ok" (or isn't back yet and the user is fast), block
    // the switch and surface the modal. The mode pill stays on the old value.
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
  }, [pythonStatus]);

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

      {/* Mode */}
      <PillGroup options={MODE_OPTIONS} selected={captureMode} onChange={handleModeChange} onTipEnter={showTip} onTipLeave={hideTip} />

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
