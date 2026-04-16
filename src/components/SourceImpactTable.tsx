import type { CorrelationData } from "../bridge";

function formatPattern(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function DeltaVal({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: "#333", fontSize: 11 }}>{"\u2014"}</span>;
  const color = value > 0 ? "#1D9E75" : value < 0 ? "#BA7517" : "#333";
  const label = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  return <span style={{ color, fontSize: 11, fontWeight: 500 }}>{label}</span>;
}

interface SourceImpactTableProps {
  data: CorrelationData["sourceTypeImpact"];
  onTrace: (label: string, sessionIds: string[], subtitle?: string) => void;
}

export function SourceImpactTable({ data, onTrace }: SourceImpactTableProps) {
  if (data.length === 0 || data.every((d) => d.sessionsWithPairs === 0)) {
    return <div style={{ fontSize: 11, color: "#333", padding: "12px 0" }}>Record before + after check-ins with source types to see impact.</div>;
  }

  const maxSessions = Math.max(...data.map((d) => d.sessionCount), 1);

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 50px 60px 60px 1fr 50px",
        gap: 4, padding: "4px 0", borderBottom: "1px solid #1a1a1e",
      }}>
        {["Source", "n", "Sov \u0394", "Gnd \u0394", "Top Pattern", "n"].map((h) => (
          <div key={h} style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
        ))}
      </div>
      {/* Rows */}
      {data.map((row) => (
        <div
          key={row.sourceType}
          onClick={() => onTrace(row.sourceType, row.sessionIds, "Source type impact")}
          style={{
            display: "grid", gridTemplateColumns: "1fr 50px 60px 60px 1fr 50px",
            gap: 4, padding: "6px 0", cursor: "pointer", position: "relative",
            borderBottom: "1px solid #0f0f12",
          }}
        >
          {/* Background bar */}
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${(row.sessionCount / maxSessions) * 100}%`,
            background: "#1a1a2e", borderRadius: 2, opacity: 0.3, zIndex: 0,
          }} />
          <div style={{ fontSize: 11, color: "#888", textTransform: "capitalize", position: "relative", zIndex: 1 }}>
            {row.sourceType.replace(/-/g, " ")}
          </div>
          <div style={{ fontSize: 11, color: "#666", textAlign: "right", position: "relative", zIndex: 1 }}>{row.sessionCount}</div>
          <div style={{ position: "relative", zIndex: 1 }}><DeltaVal value={row.sovereigntyDelta} /></div>
          <div style={{ position: "relative", zIndex: 1 }}><DeltaVal value={row.groundednessDelta} /></div>
          <div style={{
            fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", position: "relative", zIndex: 1,
          }}>
            {row.dominantPattern ? formatPattern(row.dominantPattern) : "\u2014"}
          </div>
          <div style={{ fontSize: 9, color: "#444", position: "relative", zIndex: 1 }}>
            {row.dominantPatternCount || ""}
          </div>
        </div>
      ))}
    </div>
  );
}
