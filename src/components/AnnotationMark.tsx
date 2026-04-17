import { useState, type CSSProperties } from "react";
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
  /** True when this detection just arrived from the current analysis tick.
   *  Triggers a single-run fade-in animation with a staggered delay. */
  isNew?: boolean;
  /** Zero-based position among new detections in document order. Used to
   *  stagger the fade-in so patterns resolve sequentially (50ms apart). */
  staggerIndex?: number;
}

export function AnnotationMark({
  detection,
  text,
  onNavigateToPattern,
  isNew = false,
  staggerIndex = 0,
}: AnnotationMarkProps) {
  const [showCard, setShowCard] = useState(false);

  const color = tierColors[detection.confidenceTier];

  // Fade-in only fires on first render after the detection became "new".
  // `forwards` keeps the element at final opacity after the animation ends,
  // so stale re-renders (after newDetectionIds is cleared) look identical.
  const animationStyle: CSSProperties | undefined = isNew
    ? {
        animation: `fidesFadeIn 300ms ease-in ${staggerIndex * 50}ms both`,
      }
    : undefined;

  return (
    <span style={{ position: "relative", display: "inline" }}>
      <span
        onClick={(e) => { e.stopPropagation(); setShowCard(!showCard); }}
        style={{
          borderBottom: `2px solid ${color}`,
          cursor: "pointer",
          paddingBottom: 1,
          ...animationStyle,
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
