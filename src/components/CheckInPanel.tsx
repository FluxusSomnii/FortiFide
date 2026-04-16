import { useState, useEffect, useRef, useMemo } from "react";
import { useSessionStore } from "../stores/session-store";
import type { CheckIn } from "../bridge";

// ─── Dimension definitions ───

interface Dimension {
  key: keyof Pick<CheckIn, "energy" | "clarity" | "groundedness" | "openness">;
  label: string;
  colour: string;
  lowPole: string;
  highPole: string;
}

const DIMENSIONS: Dimension[] = [
  { key: "energy", label: "Energy", colour: "#378ADD", lowPole: "depleted", highPole: "energised" },
  { key: "clarity", label: "Clarity", colour: "#1D9E75", lowPole: "foggy", highPole: "clear" },
  { key: "groundedness", label: "Groundedness", colour: "#BA7517", lowPole: "reactive", highPole: "settled" },
  { key: "openness", label: "Openness", colour: "#7F77DD", lowPole: "closed", highPole: "receptive" },
];

function tempColour(value: number, baseColour: string): string {
  if (value < 30) return "#888780";
  if (value > 70) return baseColour;
  // 30-70: darken by 40%
  const hex = baseColour.replace("#", "");
  const r = Math.round(parseInt(hex.substring(0, 2), 16) * 0.6);
  const g = Math.round(parseInt(hex.substring(2, 4), 16) * 0.6);
  const b = Math.round(parseInt(hex.substring(4, 6), 16) * 0.6);
  return `rgb(${r},${g},${b})`;
}

function formatHeaderTime(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const date = d.getDate();
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${date} ${month} · ${time}`;
}

function formatCheckInTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return `today ${time}`;
  if (target.getTime() === yesterday.getTime()) return `yesterday ${time}`;

  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const date = d.getDate();
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${day} ${date} ${month} · ${time}`;
}

// ─── Slider CSS injection ───

const SLIDER_STYLE_ID = "fides-checkin-slider-style";

function ensureSliderStyles() {
  if (document.getElementById(SLIDER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SLIDER_STYLE_ID;
  style.textContent = `
    .fides-gauge-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 6px;
      border-radius: 3px;
      outline: none;
      cursor: pointer;
      margin: 8px 0 4px 0;
    }
    .fides-gauge-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      margin-top: -5px;
    }
    .fides-gauge-slider::-webkit-slider-runnable-track {
      height: 6px;
      border-radius: 3px;
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───

export function CheckInPanel({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const [energy, setEnergy] = useState(50);
  const [clarity, setClarity] = useState(50);
  const [groundedness, setGroundedness] = useState(50);
  const [openness, setOpenness] = useState(50);
  const [note, setNote] = useState("");
  const [recorded, setRecorded] = useState(false);
  const closingRef = useRef(false);

  const isCapturing = useSessionStore((s) => s.isAudioCapturing);
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);
  const audioSessionId = useSessionStore((s) => s.audioSessionId);
  const checkIns = useSessionStore((s) => s.checkIns);

  const defaultContext = useMemo((): CheckIn["context"] => {
    if (isCapturing) return "before";
    if (lastSavedAt && Date.now() - lastSavedAt < 300_000) return "after";
    return "standalone";
  }, [isCapturing, lastSavedAt]);

  const [context, setContext] = useState<CheckIn["context"]>(defaultContext);

  // Slide in on mount
  useEffect(() => {
    ensureSliderStyles();
    requestAnimationFrame(() => setVisible(true));
    useSessionStore.getState().loadCheckIns();
  }, []);

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const values: Record<string, number> = { energy, clarity, groundedness, openness };
  const setters: Record<string, (v: number) => void> = {
    energy: setEnergy, clarity: setClarity, groundedness: setGroundedness, openness: setOpenness,
  };

  const handleRecord = () => {
    const checkIn: CheckIn = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      energy,
      clarity,
      groundedness,
      openness,
      context,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...((context === "before" || context === "after") && audioSessionId ? { sessionId: audioSessionId } : {}),
    };
    useSessionStore.getState().addCheckIn(checkIn);
    setRecorded(true);
    setTimeout(() => {
      setRecorded(false);
      setEnergy(50);
      setClarity(50);
      setGroundedness(50);
      setOpenness(50);
      setNote("");
      setContext(defaultContext);
    }, 1500);
  };

  const recentCheckIns = checkIns.slice(0, 3);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 49,
          opacity: visible ? 1 : 0, transition: "opacity 200ms ease",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, left: 232, bottom: 0, width: 340,
        background: "#111114", borderRight: "1px solid #1a1a2e", zIndex: 50,
        transform: visible ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 200ms ease",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "#ddd" }}>check in</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "#666" }}>{formatHeaderTime()}</span>
              <button
                onClick={handleClose}
                style={{
                  background: "none", border: "none", color: "#555", fontSize: 16,
                  cursor: "pointer", padding: "2px 4px", lineHeight: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#bbb"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#555"; }}
              >×</button>
            </div>
          </div>

          {/* Gauge grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {DIMENSIONS.map((dim) => {
              const val = values[dim.key]!;
              const col = tempColour(val, dim.colour);
              return (
                <div key={dim.key} style={{
                  background: "#0d0d12", border: "1px solid #1a1a1e", borderRadius: 8, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#aaa" }}>{dim.label}</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: col }}>{val}°</span>
                  </div>
                  <input
                    type="range"
                    className="fides-gauge-slider"
                    min={0}
                    max={100}
                    step={1}
                    value={val}
                    onChange={(e) => setters[dim.key]!(Number(e.target.value))}
                    style={{
                      background: `linear-gradient(to right, ${col} ${val}%, #1a1a1e ${val}%)`,
                    }}
                  />
                  <style>{`
                    .fides-gauge-slider[value="${val}"].dim-${dim.key}::-webkit-slider-thumb {
                      background: ${col};
                    }
                  `}</style>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#555" }}>{dim.lowPole}</span>
                    <span style={{ fontSize: 9, color: "#555" }}>{dim.highPole}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dynamic thumb colour style */}
          <style>{`
            .fides-gauge-slider::-webkit-slider-thumb {
              background: #888;
            }
            ${DIMENSIONS.map((dim) => {
              const val = values[dim.key]!;
              const col = tempColour(val, dim.colour);
              return `input.fides-gauge-${dim.key}::-webkit-slider-thumb { background: ${col}; }`;
            }).join("\n")}
          `}</style>

          {/* Note */}
          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 10, color: "#555" }}>optional note</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="anything you want to remember about right now..."
              style={{
                width: "100%", marginTop: 4, background: "#0d0d12", border: "1px solid #1a1a1e",
                borderRadius: 6, color: "#ccc", fontSize: 12, padding: "8px 10px",
                resize: "none", outline: "none", boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Context + Record */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["before", "after", "standalone"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setContext(c)}
                  style={{
                    fontSize: 10, padding: "4px 10px", borderRadius: 10, cursor: "pointer",
                    border: context === c ? "1px solid #2a2a3e" : "1px solid #1a1a2e",
                    background: context === c ? "#1a1a2e" : "transparent",
                    color: context === c ? "#ddd" : "#555",
                    transition: "all 0.15s",
                  }}
                >{c}</button>
              ))}
            </div>
            <button
              onClick={handleRecord}
              disabled={recorded}
              style={{
                fontSize: 11, fontWeight: 600, padding: "6px 16px", borderRadius: 6,
                background: recorded ? "#1a2e1a" : "#1a1a2e",
                border: recorded ? "1px solid #2e3e2e" : "1px solid #2a2a3e",
                color: recorded ? "#4ade80" : "#ddd",
                cursor: recorded ? "default" : "pointer",
                transition: "all 0.15s",
              }}
            >{recorded ? "recorded ✓" : "record"}</button>
          </div>

          {/* Recent check-ins */}
          {recentCheckIns.length > 0 && (
            <div style={{ marginTop: 20, borderTop: "1px solid #1a1a1e", paddingTop: 14 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: "#555", display: "block", marginBottom: 8 }}>recent</span>
              {recentCheckIns.map((ci) => (
                <div key={ci.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{formatCheckInTime(ci.timestamp)}</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {DIMENSIONS.map((dim) => (
                      <div
                        key={dim.key}
                        style={{
                          height: 4, borderRadius: 2,
                          background: tempColour(ci[dim.key], dim.colour),
                          width: `${(ci[dim.key] / 100) * 48}px`,
                          minWidth: 2,
                        }}
                      />
                    ))}
                  </div>
                  {ci.note && (
                    <div style={{
                      fontSize: 10, fontStyle: "italic", color: "#555", marginTop: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{ci.note}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
