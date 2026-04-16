import type { CorrelationData } from "../bridge";

const DIMS = [
  { key: "energy", label: "Ene" },
  { key: "clarity", label: "Cla" },
  { key: "groundedness", label: "Gnd" },
  { key: "openness", label: "Opn" },
  { key: "sovereignty", label: "Sov" },
  { key: "presence", label: "Pre" },
] as const;

function formatPattern(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PatternStateHeatmapProps {
  data: CorrelationData["patternStateCoOccurrences"];
  onTrace: (label: string, sessionIds: string[], subtitle?: string) => void;
}

export function PatternStateHeatmap({ data, onTrace }: PatternStateHeatmapProps) {
  if (data.length === 0) {
    return <div style={{ fontSize: 11, color: "#333", padding: "12px 0" }}>Not enough sessions with check-in pairs and pattern detections yet.</div>;
  }

  // Find max absolute delta for opacity scaling
  let maxAbs = 1;
  for (const row of data) {
    for (const dim of DIMS) {
      const val = row.meanDeltas[dim.key as keyof typeof row.meanDeltas];
      if (typeof val === "number") maxAbs = Math.max(maxAbs, Math.abs(val));
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${DIMS.length}, 44px)`, gap: 1, marginBottom: 2 }}>
        <div />
        {DIMS.map((d) => (
          <div key={d.key} style={{ fontSize: 9, color: "#555", textAlign: "center", padding: "4px 0" }}>{d.label}</div>
        ))}
      </div>
      {/* Rows */}
      {data.map((row) => (
        <div
          key={row.patternId}
          onClick={() => onTrace(formatPattern(row.patternId), row.sessionIds, "Co-occurring state change")}
          style={{
            display: "grid", gridTemplateColumns: `120px repeat(${DIMS.length}, 44px)`, gap: 1,
            cursor: "pointer", marginBottom: 1,
          }}
        >
          <div style={{
            fontSize: 10, color: "#888", padding: "6px 4px", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {formatPattern(row.patternId)}
          </div>
          {DIMS.map((dim) => {
            const val = row.meanDeltas[dim.key as keyof typeof row.meanDeltas];
            const num = typeof val === "number" ? val : null;
            const absV = num !== null ? Math.abs(num) : 0;
            const opacity = absV < 1 ? 0 : Math.max(0.3, Math.min(1, absV / maxAbs));
            const bg = num === null || absV < 1 ? "#111118" : num > 0 ? `rgba(29,158,117,${opacity})` : `rgba(216,90,48,${opacity})`;
            const label = num === null ? "\u2014" : absV < 1 ? "" : num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1);
            return (
              <div key={dim.key} style={{
                background: bg, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: absV < 1 ? "#333" : "#fff", borderRadius: 2,
              }}>
                {label}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
