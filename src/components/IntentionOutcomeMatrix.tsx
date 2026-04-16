import type { CorrelationData } from "../bridge";

interface IntentionOutcomeMatrixProps {
  data: CorrelationData["intentionOutcomeMatrix"];
  intentionTags: string[];
  outcomeTags: string[];
  onTrace: (label: string, sessionIds: string[], subtitle?: string) => void;
}

export function IntentionOutcomeMatrix({ data, intentionTags, outcomeTags, onTrace }: IntentionOutcomeMatrixProps) {
  if (data.length === 0) {
    return <div style={{ fontSize: 11, color: "#333", padding: "12px 0" }}>Use the Session Ritual to tag intentions and outcomes. Patterns will appear here.</div>;
  }

  // Build lookup
  const countMap = new Map<string, { count: number; sessionIds: string[] }>();
  let maxCount = 1;
  for (const entry of data) {
    const key = `${entry.intentionTag}|${entry.outcomeTag}`;
    countMap.set(key, { count: entry.count, sessionIds: entry.sessionIds });
    if (entry.count > maxCount) maxCount = entry.count;
  }

  const rows = intentionTags.length > 0 ? intentionTags : [...new Set(data.map((d) => d.intentionTag))];
  const cols = outcomeTags.length > 0 ? outcomeTags : [...new Set(data.map((d) => d.outcomeTag))];

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${cols.length}, 54px)`, gap: 1 }}>
        <div />
        {cols.map((col) => (
          <div key={col} style={{
            fontSize: 9, color: "#555", textAlign: "center", padding: "4px 2px",
            textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {col}
          </div>
        ))}
      </div>
      {/* Rows */}
      {rows.map((intention) => (
        <div key={intention} style={{ display: "grid", gridTemplateColumns: `80px repeat(${cols.length}, 54px)`, gap: 1, marginBottom: 1 }}>
          <div style={{
            fontSize: 10, color: "#888", textTransform: "capitalize", padding: "6px 4px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {intention}
          </div>
          {cols.map((outcome) => {
            const key = `${intention}|${outcome}`;
            const entry = countMap.get(key);
            const count = entry?.count ?? 0;
            const opacity = count > 0 ? Math.min(count / maxCount, 1) * 0.7 + 0.1 : 0;
            return (
              <div
                key={outcome}
                onClick={count > 0 ? () => onTrace(`${intention} \u2192 ${outcome}`, entry!.sessionIds, "Intention-outcome pair") : undefined}
                style={{
                  height: 28, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center",
                  background: count > 0 ? `rgba(127,119,221,${opacity})` : "#111118",
                  fontSize: 10, color: count > 0 ? "#fff" : "transparent",
                  cursor: count > 0 ? "pointer" : "default",
                }}
              >
                {count > 0 ? count : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
