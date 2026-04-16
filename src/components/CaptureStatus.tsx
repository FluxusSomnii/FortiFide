import { useSessionStore } from "../stores/session-store";

const statusConfig = {
  capturing: { color: "#4caf50", label: "Observing", pulse: true },
  paused: { color: "#c4a24e", label: "Paused", pulse: false },
  idle: { color: "#555", label: "Idle", pulse: false },
} as const;

export function CaptureStatus() {
  const captureStatus = useSessionStore((s) => s.captureStatus);
  const config = statusConfig[captureStatus];

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 16px",
      borderBottom: "1px solid #1a1a1a",
    }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: config.color,
          display: "inline-block",
          animation: config.pulse ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      <span style={{ color: "#888", fontSize: 12, letterSpacing: "0.05em" }}>
        {config.label}
      </span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
