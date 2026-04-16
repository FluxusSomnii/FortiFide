import { useState } from "react";
import type { DetectionInstance } from "@fides/pattern-library";
import { PatternCard } from "./PatternCard";

const tierColors = {
  possible: "#c4a24e",
  likely: "#d4822e",
  strong: "#c44e4e",
} as const;

interface AnnotationMarkProps {
  detection: DetectionInstance;
  text: string;
  onNavigateToPattern?: ((patternId: string) => void) | undefined;
}

export function AnnotationMark({ detection, text, onNavigateToPattern }: AnnotationMarkProps) {
  const [showCard, setShowCard] = useState(false);

  const color = tierColors[detection.confidenceTier];

  return (
    <span style={{ position: "relative", display: "inline" }}>
      <span
        onClick={(e) => { e.stopPropagation(); setShowCard(!showCard); }}
        style={{
          borderBottom: `2px solid ${color}`,
          cursor: "pointer",
          paddingBottom: 1,
        }}
      >
        {text}
      </span>
      {showCard && (
        <PatternCard
          detection={detection}
          onClose={() => setShowCard(false)}
          onNavigateToPattern={onNavigateToPattern}
        />
      )}
    </span>
  );
}
