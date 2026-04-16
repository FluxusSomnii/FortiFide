import { useState, useEffect, useCallback } from "react";
import { api, type SessionSummary } from "../bridge";
import { useSessionStore } from "../stores/session-store";

export type View = "capture" | "sessions" | "session-detail" | "settings" | "data" | "insights";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Sidebar({
  open,
  onToggle,
  activeView,
  setActiveView,
  activeTab,
  setActiveTab,
  activeSessionId,
  setActiveSessionId,
}: {
  open: boolean;
  onToggle: () => void;
  activeView: View;
  setActiveView: (v: View) => void;
  activeTab: "capture" | "sessions" | "data" | "insights";
  setActiveTab: (t: "capture" | "sessions" | "data" | "insights") => void;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
}) {
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);
  const isCapturing = useSessionStore((s) => s.isAudioCapturing);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const fetchSessions = useCallback(() => {
    api.listSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => { fetchSessions(); }, [lastSavedAt, fetchSessions]);

  const handleNewSession = () => {
    const store = useSessionStore.getState();
    // Save current if has content
    if (store.capturedText.length > 0) {
      let id = store.currentSessionId;
      if (!id) {
        id = `session-${Date.now()}`;
        useSessionStore.setState({ currentSessionId: id });
      }
      const payload: Record<string, unknown> = {
        id,
        text: store.capturedText.map((s) => s.text).join(" "),
        detections: store.detections,
        createdAt: new Date().toISOString(),
        segments: store.capturedText.map((s) => {
          const seg: { text: string; source: string; timestamp: number; capturedAt: number; speaker?: string } = {
            text: s.text, source: s.source, timestamp: s.timestamp, capturedAt: s.capturedAt,
          };
          if (s.speaker) seg.speaker = s.speaker;
          return seg;
        }),
        hasAudio: !!store.audioSessionId,
        hasMicAudio: !!store.audioSessionId && (store.settings.audioSource === "microphone" || store.settings.audioSource === "both"),
        hasSystemAudio: !!store.audioSessionId && (store.settings.audioSource === "loopback" || store.settings.audioSource === "both"),
        checkIns: store.checkIns.filter((c) =>
          c.sessionId === id || c.sessionId === store.audioSessionId
        ),
      };
      if (store.audioSessionId) payload.audioSessionId = store.audioSessionId;
      if (store.selectedSourceType) payload.sourceType = store.selectedSourceType;
      api.saveSession(payload as any).catch(() => {});
    }
    store.clearSession();
    store.resetClip();
    setActiveView("capture");
    setActiveSessionId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session? This cannot be undone.")) return;
    api.deleteSession(id).then(() => {
      fetchSessions();
      if (id === activeSessionId) {
        setActiveSessionId(null);
        setActiveView("capture");
      }
    }).catch(() => {});
  };

  if (!open) return null;

  return (
    <div style={{
      width: 232, minWidth: 232, background: "#111114", borderRight: "1px solid #1a1a1e",
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px", borderBottom: "1px solid #1a1a1e",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isCapturing ? "#4ade80" : "#2a2a2a",
            boxShadow: isCapturing ? "0 0 6px #4ade80" : "none",
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.14em", color: "#ddd" }}>FORTI FIDE</span>
        </div>
        <button onClick={onToggle} style={{
          background: "none", border: "none", color: "#444", fontSize: 14, cursor: "pointer", padding: "2px 6px",
        }}>‹</button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", padding: "0 12px", gap: 4 }}>
        {(["capture", "sessions", "data", "insights"] as const).map((t) => {
          const isTabActive = activeTab === t && activeView !== "session-detail";
          return (
            <button key={t} onClick={() => {
              setActiveTab(t);
              setActiveView(t === "capture" ? "capture" : t === "data" ? "data" : t === "insights" ? "insights" : "sessions");
              setActiveSessionId(null);
            }} style={{
              flex: 1, padding: "6px 0", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
              background: isTabActive ? "#191920" : "transparent",
              border: isTabActive ? "1px solid #222230" : "1px solid transparent",
              borderRadius: 4, color: isTabActive ? "#ddd" : "#666", cursor: "pointer",
              fontFamily: "inherit",
            }}>{t === "capture" ? "LIVE" : t === "data" ? "DATA" : t === "insights" ? "INSIGHTS" : "SEARCH"}</button>
          );
        })}
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {sessions.map((s) => {
          const isActive = s.id === activeSessionId;
          return (
            <div key={s.id} onClick={() => {
              setActiveSessionId(s.id);
              setActiveView("session-detail");
            }} style={{
              padding: "9px 10px", borderRadius: 5, cursor: "pointer", marginBottom: 2,
              background: isActive ? "#191924" : "transparent",
              borderTop: isActive ? "1px solid #222230" : "1px solid transparent",
              borderRight: isActive ? "1px solid #222230" : "1px solid transparent",
              borderBottom: isActive ? "1px solid #222230" : "1px solid transparent",
              borderLeft: s.colorTag
                ? `3px solid ${s.colorTag}`
                : (s.hasAudio || s.hasMicAudio || s.hasSystemAudio)
                  ? "3px solid #1e1e24"
                  : isActive ? "3px solid #222230" : "3px solid transparent",
              position: "relative",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = "#151518";
              const del = e.currentTarget.querySelector("[data-delete]") as HTMLElement;
              if (del) del.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
              const del = e.currentTarget.querySelector("[data-delete]") as HTMLElement;
              if (del) del.style.opacity = "0";
            }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                {(s.hasAudio || s.hasMicAudio || s.hasSystemAudio) && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#c44e4e", background: "#2a1519", padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap", letterSpacing: 0.5, lineHeight: "14px" }}>● REC</span>
                )}
                {s.hasCheckIns && (
                  <span style={{ fontSize: 9, color: "#7F77DD", opacity: 0.7 }}>◎</span>
                )}
                <span style={{ fontSize: 12, fontWeight: 500, color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {s.name || s.textPreview || s.id}
                </span>
                <button data-delete="" onClick={(e) => handleDelete(e, s.id)} style={{
                  opacity: 0, width: 22, height: 22, minWidth: 22, minHeight: 22,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none", borderRadius: 4,
                  color: "#444", fontSize: 14, cursor: "pointer",
                  transition: "opacity 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#c44e4e"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#444"; }}
                >×</button>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#444", marginTop: 3 }}>
                <span>{timeAgo(s.createdAt)}</span>
                {(s.wordCount ?? 0) > 0 && <span>{s.wordCount}w</span>}
                {s.detectionCount > 0 && <span style={{ color: "#e85d4a55" }}>{s.detectionCount}p</span>}
                {s.sourceType && <span style={{ color: "#333" }}>{s.sourceType}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Settings */}
      <div style={{ borderTop: "1px solid #161618", padding: "8px 12px" }}>
        <button onClick={() => setActiveView("settings")} style={{
          background: "none", border: "1px solid transparent", borderRadius: 4,
          color: "#666", fontSize: 10, cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#aaa"; e.currentTarget.style.borderColor = "#1e1e24"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.borderColor = "transparent"; }}
        >⚙ Settings</button>
      </div>
    </div>
  );
}
