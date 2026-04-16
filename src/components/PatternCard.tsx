import { useState, useEffect, useCallback } from "react";
import type { DetectionInstance, PatternEntry } from "@fides/pattern-library";
import { api } from "../bridge";

const tierLabels = {
  possible: "Possible Match",
  likely: "Likely Match",
  strong: "Strong Match",
} as const;

const tierColors = {
  possible: "#c4a24e",
  likely: "#d4822e",
  strong: "#c44e4e",
} as const;

interface PatternCardProps {
  detection: DetectionInstance;
  onClose: () => void;
  onNavigateToPattern?: ((patternId: string) => void) | undefined;
}

export function PatternCard({ detection, onClose, onNavigateToPattern }: PatternCardProps) {
  const [pattern, setPattern] = useState<PatternEntry | null>(null);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    api.getPattern(detection.patternId).then(setPattern).catch(() => {});
  }, [detection.patternId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleMarkIncorrect = () => {
    api
      .submitFeedback({
        detectionId: detection.id,
        timestamp: new Date().toISOString(),
        wasIncorrect: true,
      })
      .then(() => setMarked(true))
      .catch(() => {});
  };

  if (!pattern) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 999,
        }}
      />

      {/* Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: 6,
          padding: 16,
          width: 300,
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "none",
            border: "none",
            color: "#666",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          x
        </button>

        <div style={{ fontWeight: 600, color: "#e0e0e0", marginBottom: 4 }}>
          {pattern.name}
        </div>

        <div style={{
          fontSize: 11,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}>
          {pattern.category}
        </div>

        <div style={{ fontSize: 13, color: "#b0b0b0", lineHeight: 1.5, marginBottom: 8 }}>
          {pattern.definition}
        </div>

        <div style={{
          fontSize: 12,
          color: tierColors[detection.confidenceTier],
          fontWeight: 500,
          marginBottom: detection.speaker ? 4 : 12,
        }}>
          {tierLabels[detection.confidenceTier]}
        </div>

        {detection.speaker && (
          <div style={{
            fontSize: 11,
            color: "#888",
            marginBottom: 12,
          }}>
            Detected in: {detection.speaker}
          </div>
        )}

        <button
          onClick={handleMarkIncorrect}
          disabled={marked}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            background: marked ? "#2a2a2a" : "transparent",
            border: `1px solid ${marked ? "#333" : "#444"}`,
            borderRadius: 4,
            color: marked ? "#666" : "#999",
            cursor: marked ? "default" : "pointer",
          }}
        >
          {marked ? "Marked" : "Mark as Incorrect"}
        </button>

        {onNavigateToPattern && (
          <div
            onClick={() => { onNavigateToPattern(detection.patternId); onClose(); }}
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px solid #1a1a1e",
              fontSize: 10,
              color: "#555",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#888"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#555"; }}
          >
            see frequency across your sessions
            <span>{"\u2192"}</span>
          </div>
        )}
      </div>
    </>
  );
}
