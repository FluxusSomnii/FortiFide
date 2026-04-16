import { useState, useEffect } from "react";
import { api } from "../bridge";
import { useSessionStore } from "../stores/session-store";

interface SessionSummary {
  id: string;
  createdAt: string;
  label?: string;
  textPreview: string;
  detectionCount: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function SessionList() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);

  const fetchSessions = () => {
    api.listSessions()
      .then((list) => {
        setSessions(list);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSessions();
  }, [lastSavedAt]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    api.deleteSession(id)
      .then(() => {
        setSessions((prev) => prev.filter((s) => s.id !== id));
      })
      .catch(() => {});
  };

  const handleClick = (id: string) => {
    useSessionStore.getState().loadSavedSession(id);
  };

  return (
    <div style={{
      width: 260,
      minWidth: 260,
      borderRight: "1px solid #1a1a1a",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 16px",
        borderBottom: "1px solid #1a1a1a",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{
          color: "#888",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}>
          History
        </span>
        <button
          onClick={() => useSessionStore.getState().resetClip()}
          style={{
            background: "transparent",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: "#888",
            fontSize: 11,
            padding: "3px 10px",
            cursor: "pointer",
          }}
        >
          + New
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? null : sessions.length === 0 ? (
          <div style={{
            padding: 16,
            color: "#555",
            fontSize: 13,
          }}>
            No saved analyses.
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === currentSessionId;
            const isHovered = session.id === hoveredId;
            return (
              <div
                key={session.id}
                onClick={() => handleClick(session.id)}
                onMouseEnter={() => setHoveredId(session.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #1a1a1a",
                  cursor: "pointer",
                  background: isActive || isHovered ? "#111" : "transparent",
                  borderLeft: isActive ? "2px solid #444" : "2px solid transparent",
                  position: "relative",
                }}
              >
                <div style={{
                  color: "#b0b0b0",
                  fontSize: 13,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  paddingRight: 20,
                }}>
                  {session.textPreview}
                </div>
                <div style={{
                  color: "#666",
                  fontSize: 11,
                  marginTop: 4,
                  display: "flex",
                  gap: 8,
                }}>
                  <span>{timeAgo(session.createdAt)}</span>
                  <span>{session.detectionCount} pattern{session.detectionCount !== 1 ? "s" : ""}</span>
                </div>

                {isHovered && (
                  <button
                    onClick={(e) => handleDelete(e, session.id)}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      background: "transparent",
                      border: "none",
                      color: "#555",
                      fontSize: 14,
                      cursor: "pointer",
                      padding: "2px 4px",
                      lineHeight: 1,
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#c44e4e"; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "#555"; }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
