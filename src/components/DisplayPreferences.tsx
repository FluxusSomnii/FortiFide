import { useDisplayStore } from "../stores/display-store";
import type { PatternCategory } from "@fides/pattern-library";

const categories: { key: PatternCategory; label: string }[] = [
  { key: "manipulation", label: "Manipulation" },
  { key: "authority", label: "Authority" },
  { key: "fallacy", label: "Fallacy" },
  { key: "emotional", label: "Emotional" },
  { key: "framing", label: "Framing" },
  { key: "narrative", label: "Narrative" },
  { key: "cognitive-bias", label: "Cognitive Bias" },
];

export function DisplayPreferences() {
  const categoryVisibility = useDisplayStore((s) => s.categoryVisibility);
  const confidenceFloor = useDisplayStore((s) => s.confidenceFloor);
  const setCategoryVisible = useDisplayStore((s) => s.setCategoryVisible);
  const setConfidenceFloor = useDisplayStore((s) => s.setConfidenceFloor);

  return (
    <div style={{
      padding: 16,
      borderLeft: "1px solid #1a1a1a",
      width: 220,
      fontSize: 13,
    }}>
      <div style={{
        color: "#888",
        fontSize: 11,
        marginBottom: 16,
        lineHeight: 1.5,
      }}>
        Display filters only affect what you see here.
        Forti Fide always detects all patterns.
        Your full session record is preserved.
      </div>

      <div style={{ color: "#999", fontWeight: 500, marginBottom: 8 }}>
        Categories
      </div>

      {categories.map(({ key, label }) => (
        <label
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            color: "#b0b0b0",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={categoryVisibility[key]}
            onChange={(e) => setCategoryVisible(key, e.target.checked)}
          />
          {label}
        </label>
      ))}

      <div style={{ color: "#999", fontWeight: 500, marginTop: 16, marginBottom: 8 }}>
        Confidence Floor
      </div>

      <input
        type="range"
        min={0.4}
        max={1.0}
        step={0.05}
        value={confidenceFloor}
        onChange={(e) => setConfidenceFloor(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />

      <div style={{ color: "#888", fontSize: 11, textAlign: "center" }}>
        {confidenceFloor.toFixed(2)}
      </div>
    </div>
  );
}
