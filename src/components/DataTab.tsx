import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api, type DataSummary, type SessionSummary, type CheckIn, type CorrelationData } from "../bridge";
import { useSessionStore } from "../stores/session-store";
import { MapView } from "./MapView";
import { StateRadar } from "./StateRadar";
import { PatternStateHeatmap } from "./PatternStateHeatmap";
import { SourceImpactTable } from "./SourceImpactTable";
import { IntentionOutcomeMatrix } from "./IntentionOutcomeMatrix";

// Feature flag: when true, unimplemented placeholder widgets render their
// "needs N+ sessions" stubs. Flip to true once the underlying analysis is
// built. Sections hidden behind this flag:
//   · Recovery sessions / Vulnerability windows (Impact tab)
//   · Mirroring effect / Your patterns vs theirs / Voice signature / Text tracking (Your Voice tab)
const SHOW_UNIMPLEMENTED = false;

const PERIODS = [
  { label: "24 hours", value: "24h" as const },
  { label: "7 days", value: "7d" as const },
  { label: "30 days", value: "30d" as const },
  { label: "90 days", value: "90d" as const },
  { label: "all time", value: "all" as const },
];

const TABS = [
  { label: "environment", value: "environment" as const },
  { label: "impact", value: "impact" as const },
  { label: "over time", value: "over-time" as const },
  { label: "intention", value: "intention" as const },
  { label: "your voice", value: "your-voice" as const },
] as const;

type TabValue = typeof TABS[number]["value"];

function formatPatternName(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deltaColor(delta: number): string {
  if (delta > 0) return "#1D9E75";
  if (delta < 0) return "#BA7517";
  return "#333";
}

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  background: active ? "#191920" : "transparent",
  border: active ? "1px solid #222230" : "1px solid transparent",
  borderRadius: 4,
  color: active ? "#ddd" : "#666",
  cursor: "pointer",
  fontFamily: "inherit",
});

const sectionHeader: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 500,
  color: "#2a2a4a",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  marginBottom: 10,
};

const subtextStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#444",
  marginBottom: 8,
  marginTop: -6,
};

const cardStyle: React.CSSProperties = {
  background: "#0d0d12",
  border: "1px solid #1a1a1e",
  borderRadius: 8,
  padding: "14px 16px",
};

// ─── Derivation tag ───

function DTag({ tag }: { tag: string }) {
  return (
    <span style={{
      fontSize: 8, color: "#444", border: "0.5px solid #333", borderRadius: 2,
      padding: "1px 4px", marginLeft: 4, fontFamily: "monospace", verticalAlign: "middle",
    }}>{tag}</span>
  );
}

// ─── Tooltip (follows cursor) ───

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const posRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (tooltipRef.current) {
      const tw = tooltipRef.current.offsetWidth || 220;
      const th = tooltipRef.current.offsetHeight || 40;
      let left = e.clientX + 14;
      let top = e.clientY - th - 8;
      if (left + tw > window.innerWidth - 8) left = e.clientX - tw - 14;
      if (top < 8) top = e.clientY + 20;
      tooltipRef.current.style.left = left + "px";
      tooltipRef.current.style.top = top + "px";
    }
  }, []);

  const handleEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setShow(true), 400);
  }, []);

  const handleLeave = useCallback(() => {
    clearTimeout(timerRef.current);
    setShow(false);
  }, []);

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMouseMove}
      style={{ cursor: "help" }}
    >
      {children}
      {show && (
        <span
          ref={tooltipRef}
          style={{
            position: "fixed",
            left: posRef.current.x + 14,
            top: posRef.current.y - 40,
            background: "#1a1a22",
            border: "1px solid #2a2a34",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 10,
            color: "#999",
            maxWidth: 220,
            whiteSpace: "normal",
            wordBreak: "break-word",
            lineHeight: 1.5,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Trace Panel ───

interface TraceInfo {
  label: string;
  subtitle?: string;
  sessionIds: string[];
}

function sessionLabel(id: string, sessions: SessionSummary[] | undefined): string {
  const s = sessions?.find(x => x.id === id);
  if (!s) return id;
  const d = new Date(s.createdAt);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const name = s.name ? "  " + s.name.slice(0, 30) : "";
  return `${date} \u00B7 ${time}${name}`;
}

function TracePanel({ trace, sessions, onSelectSession, onClose }: {
  trace: TraceInfo;
  sessions: SessionSummary[] | undefined;
  onSelectSession: ((id: string) => void) | undefined;
  onClose: () => void;
}) {
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 280,
      background: "#111116", borderLeft: "1px solid #1a1a1e",
      display: "flex", flexDirection: "column", zIndex: 100,
      boxShadow: "-4px 0 20px rgba(0,0,0,0.4)",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: "1px solid #1a1a1e",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>Contributing sessions</div>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{trace.label}</div>
          {trace.subtitle && <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>{trace.subtitle}</div>}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#555", fontSize: 16,
          cursor: "pointer", padding: "2px 6px",
        }}>{"\u00D7"}</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {trace.sessionIds.length === 0 && (
          <div style={{ fontSize: 11, color: "#333", padding: 8 }}>No linked sessions</div>
        )}
        {trace.sessionIds.map((id) => (
          <button
            key={id}
            onClick={() => onSelectSession?.(id)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              background: "transparent", border: "1px solid transparent",
              borderRadius: 5, padding: "8px 10px", marginBottom: 2,
              color: "#888", fontSize: 11, cursor: onSelectSession ? "pointer" : "default",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#151518"; e.currentTarget.style.borderColor = "#222230"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
          >
            {sessionLabel(id, sessions)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Intention-outcome alignment map ───

const ALIGNED_OUTCOMES: Record<string, string[]> = {
  learn: ["informed", "clear"],
  monitor: ["informed", "neutral"],
  entertain: ["energised", "neutral"],
  decide: ["clear", "informed"],
  research: ["informed", "clear"],
  reflect: ["clear", "neutral"],
  verify: ["informed", "clear"],
};

// ─── DataTab ───

export function DataTab({ onSelectSession, sessions, highlightedPattern, onPatternHighlightClear }: {
  onSelectSession?: ((id: string) => void) | undefined;
  sessions?: SessionSummary[] | undefined;
  highlightedPattern?: string | null | undefined;
  onPatternHighlightClear?: (() => void) | undefined;
}) {
  const [tab, setTab] = useState<TabValue>("environment");
  const [period, setPeriod] = useState<"24h" | "7d" | "30d" | "90d" | "all">("30d");
  const [data, setData] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceInfo | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationData | null>(null);
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);

  const [fetchedSessions, setFetchedSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    if (!sessions) { api.listSessions().then(setFetchedSessions).catch(() => {}); }
  }, [sessions, lastSavedAt]);
  const allSessions = sessions ?? fetchedSessions;

  useEffect(() => { api.getCheckIns().then(setCheckIns).catch(() => {}); }, [lastSavedAt]);

  // Period → cutoff timestamp (ms). Used to scope checkIns and anything else
  // that reads the full check-in history client-side. "all" = no cutoff.
  // Mirrors the server's own windowMs table in rhetorical-server.ts.
  const periodCutoff = useMemo(() => {
    const table: Record<string, number> = {
      "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000, "90d": 90 * 86400000,
    };
    const ms = table[period];
    return ms === undefined ? 0 : Date.now() - ms;
  }, [period]);

  // Check-ins scoped to the selected period — passed to StateRadar (history)
  // and to the baseline-drift calculation so the period pill affects them.
  const filteredCheckIns = useMemo(
    () => checkIns.filter((c) => c.timestamp >= periodCutoff),
    [checkIns, periodCutoff],
  );

  useEffect(() => {
    setLoading(true); setError(null);
    api.getDataSummary(period)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [period, lastSavedAt]);

  useEffect(() => {
    api.getCorrelations(period).then(setCorrelations).catch(() => setCorrelations(null));
  }, [period, lastSavedAt]);

  useEffect(() => {
    if (highlightedPattern && tab !== "environment") setTab("environment");
  }, [highlightedPattern, tab]);

  const annotationRate = useMemo(() => {
    if (!data) return "0.0";
    return ((data.totalPatterns / Math.max(data.totalWords, 1)) * 100).toFixed(1);
  }, [data]);

  const sortedSourcesByEngagement = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.sourceBreakdown).sort((a, b) => b[1].sessionCount - a[1].sessionCount).slice(0, 5);
  }, [data]);

  const sortedSourcesByAnnotation = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.sourceBreakdown)
      .sort((a, b) => (b[1].patternCount / Math.max(b[1].wordCount, 1)) - (a[1].patternCount / Math.max(a[1].wordCount, 1)))
      .slice(0, 5);
  }, [data]);

  const absentByCategory = useMemo(() => {
    if (!data?.absentPatterns) return new Map<string, Array<{ patternId: string; name: string }>>();
    const map = new Map<string, Array<{ patternId: string; name: string }>>();
    for (const p of data.absentPatterns) {
      const arr = map.get(p.category) ?? [];
      arr.push({ patternId: p.patternId, name: p.name });
      map.set(p.category, arr);
    }
    return map;
  }, [data]);

  // Baseline drift — computed from check-ins inside the selected period so the
  // period pill actually affects the chips. Previously used the full history.
  const baselineDrift = useMemo(() => {
    if (filteredCheckIns.length < 4) return null;
    const mid = Math.floor(filteredCheckIns.length / 2);
    const older = filteredCheckIns.slice(0, mid);
    const recent = filteredCheckIns.slice(mid);
    const dims = ["energy", "clarity", "groundedness", "openness", "sovereignty", "presence"] as const;
    return dims.map((k) => {
      const oAvg = older.reduce((s, c) => s + ((c[k] as number) ?? 50), 0) / older.length;
      const rAvg = recent.reduce((s, c) => s + ((c[k] as number) ?? 50), 0) / recent.length;
      const delta = rAvg - oAvg;
      return { key: k, delta: Math.round(delta), dir: delta > 2 ? "up" as const : delta < -2 ? "down" as const : "flat" as const };
    });
  }, [filteredCheckIns]);

  const openTrace = useCallback((label: string, sessionIds: string[], subtitle?: string) => {
    const info: TraceInfo = { label, sessionIds };
    if (subtitle !== undefined) info.subtitle = subtitle;
    setTrace(info);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "18px 24px" }}>

        {/* Tab selector */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, alignItems: "center" }}>
          {TABS.map((t) => (
            <button key={t.value} onClick={() => setTab(t.value)} style={pillStyle(tab === t.value)}>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setMapOpen(true)}
            style={{ ...pillStyle(false), color: "#555", display: "flex", alignItems: "center", gap: 4 }}
          >
            {"\u25CE"} map
          </button>
        </div>

        {/* Time window */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={pillStyle(period === p.value)}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Loading / Error */}
        {loading && <div style={{ color: "#333", fontSize: 11 }}>loading...</div>}
        {error && <div style={{ color: "#c44e4e", fontSize: 11 }}>{error}</div>}

        {data && !loading && (
          <>
            {/* ═══════════════════════════════════════ */}
            {/* TAB 1: ENVIRONMENT                      */}
            {/* ═══════════════════════════════════════ */}
            {tab === "environment" && (
              <>
                {/* Metrics — 6-card grid */}
                <Tip text="Summary of all captured sessions in this time window">
                  <div style={sectionHeader}>your environment</div>
                </Tip>
                <div style={subtextStyle}>what Forti Fide has observed this period</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <MetricCard label="Sessions" tag="S" value={String(data.totalSessions)} delta={data.totalSessions - data.priorPeriod.totalSessions} suffix="vs prior" tip="Total capture sessions recorded" />
                  <MetricCard label="Hours captured" tag="S" value={data.totalHours.toFixed(1)} delta={null} suffix="" tip="Cumulative session duration" />
                  <MetricCard label="Patterns detected" tag="P" value={String(data.totalPatterns)} delta={data.totalPatterns - data.priorPeriod.totalPatterns} suffix="vs prior" tip="Rhetorical patterns identified" />
                  <MetricCard label="Annotation rate" tag="P" value={`${annotationRate}%`} delta={null} suffix="per 100 words" tip="Patterns per 100 words" />
                  <MetricCard label="Sessions with audio" tag="S" value={String(data.sessionsWithAudio)} delta={null} suffix={`of ${data.totalSessions}`} tip="Sessions with recorded audio" />
                  <MetricCard label="Sovereignty" tag="S" value={`${data.sovereignty.offlinePercent.toFixed(0)}%`} delta={null} suffix="offline" tip="Percentage of time outside Forti Fide sessions" />
                </div>

                {/* Sovereignty bar */}
                <Tip text="How much of the time window was spent outside captured media">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>your sovereignty</div>
                </Tip>
                <div style={subtextStyle}>time outside Forti Fide sessions — the gap between captures is yours</div>
                <SovereigntyBar data={data} />

                {/* Source types */}
                {(sortedSourcesByEngagement.length > 0 || sortedSourcesByAnnotation.length > 0) && (
                  <>
                    <Tip text="Breakdown of where your captured text came from">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>what arrived — by source</div>
                    </Tip>
                    <div style={subtextStyle}>where your sessions came from and how annotated each source is</div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <SourceBars title="most engaged" entries={sortedSourcesByEngagement} valueKey="sessionCount" barColor="#378ADD" />
                      <SourceBars title="most annotated" entries={sortedSourcesByAnnotation} valueKey="ratio" barColor="#D85A30" />
                    </div>
                  </>
                )}

                {/* Top patterns */}
                {data.patternFrequency.length > 0 && (
                  <>
                    <Tip text="Most frequently detected rhetorical patterns">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>exposure — top patterns</div>
                    </Tip>
                    <div style={subtextStyle}>what is in your environment — absolute frequency</div>
                    <PatternBars patterns={data.patternFrequency.slice(0, 15)} onTrace={openTrace} highlightedPattern={highlightedPattern} onPatternHighlightClear={onPatternHighlightClear} />
                  </>
                )}

                {/* Drift */}
                {data.drift.length > 0 && (
                  <>
                    <Tip text="Patterns with the biggest change vs the prior period">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>drift — what is changing <DTag tag={"\u0394"} /></div>
                    </Tip>
                    <div style={subtextStyle}>what is changing vs the prior equivalent period</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {/* Neutral styling — more patterns is not inherently good or bad.
                          "new" (prior=0) items sort after percentage-change items. */}
                      {[...data.drift]
                        .sort((a, b) => {
                          const aNew = a.priorCount === 0;
                          const bNew = b.priorCount === 0;
                          if (aNew !== bNew) return aNew ? 1 : -1;
                          return Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent);
                        })
                        .map((d) => {
                          const isNew = d.priorCount === 0 && d.currentCount > 0;
                          const label = isNew
                            ? "new"
                            : `${d.deltaPercent >= 0 ? "+" : ""}${d.deltaPercent}%`;
                          return (
                            <div key={d.patternId} style={{ ...cardStyle, flex: "1 1 120px", minWidth: 100, cursor: d.sessionIds.length > 0 ? "pointer" : "default" }}
                              onClick={() => d.sessionIds.length > 0 && openTrace(formatPatternName(d.patternId), d.sessionIds, "Drift vs prior period")}
                            >
                              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{formatPatternName(d.patternId)}</div>
                              <div style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
                                {label}
                              </div>
                              <div style={{ fontSize: 9, color: "#444" }}>{d.currentCount} now / {d.priorCount} prior</div>
                            </div>
                          );
                        })}
                    </div>
                  </>
                )}

                {/* Absent patterns */}
                <Tip text="Rhetorical patterns from the library that haven't appeared in your sessions this period.">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>not detected <DTag tag="P" /></div>
                </Tip>
                <div style={subtextStyle}>patterns from the library not found in your sessions this period</div>
                {(!data.absentPatterns || data.absentPatterns.length === 0) ? (
                  <div style={{ fontSize: 11, color: "#1D9E75", padding: "8px 0" }}>All {data.patternFrequency.length + (data.absentPatterns?.length ?? 0)} patterns have been detected this period.</div>
                ) : (
                  <div>
                    {[...absentByCategory.entries()].map(([cat, patterns]) => (
                      <div key={cat} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{cat}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {patterns.map((p) => (
                            <span key={p.patternId} style={{ fontSize: 10, color: "#555", background: "#0d0d12", border: "1px solid #1a1a1e", borderRadius: 3, padding: "2px 6px" }}>{p.name}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* State correlation */}
                <Tip text="How different source types affect your state.">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>state correlation <DTag tag="C" /></div>
                </Tip>
                <div style={subtextStyle}>how sessions affect your state — requires before and after check-ins</div>
                {(!data.checkInCorrelations || data.checkInCorrelations.length === 0) ? (
                  <div style={{ fontSize: 11, color: "#333", padding: "8px 0" }}>No check-in pairs yet. Record a before and after check-in on the same session to see correlations.</div>
                ) : (
                  <div style={{ ...cardStyle, overflowX: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 60px) 50px", gap: 4, fontSize: 10 }}>
                      <div style={{ color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>content type</div>
                      <div style={{ color: "#555", textAlign: "center" }}>energy</div>
                      <div style={{ color: "#555", textAlign: "center" }}>clarity</div>
                      <div style={{ color: "#555", textAlign: "center" }}>ground.</div>
                      <div style={{ color: "#555", textAlign: "center" }}>open.</div>
                      <div style={{ color: "#555", textAlign: "right" }}>n</div>
                      {data.checkInCorrelations.map((c) => (
                        <div key={c.sourceType} style={{ display: "contents", cursor: c.sessionIds.length > 0 ? "pointer" : "default" }}
                          onClick={() => c.sessionIds.length > 0 && openTrace(c.sourceType, c.sessionIds, "State correlation")}
                        >
                          <div style={{ color: "#888", padding: "4px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sourceType}</div>
                          <DeltaCell value={c.meanDeltas.energy} />
                          <DeltaCell value={c.meanDeltas.clarity} />
                          <DeltaCell value={c.meanDeltas.groundedness} />
                          <DeltaCell value={c.meanDeltas.openness} />
                          <div style={{ color: "#444", textAlign: "right", padding: "4px 0" }}>{c.sessionCount}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══════════════════════════════════════ */}
            {/* TAB 2: IMPACT                           */}
            {/* ═══════════════════════════════════════ */}
            {tab === "impact" && (
              <>
                {/* Pattern × State — co-occurring state changes */}
                <Tip text="Average state change on sessions where each pattern occurred. Not a statistical correlation — a co-occurrence.">
                  <div style={sectionHeader}>pattern {"\u00D7"} state <DTag tag="C" /></div>
                </Tip>
                <div style={subtextStyle}>co-occurring state change per pattern — positive means your state rose on those sessions</div>
                {correlations && correlations.patternStateCoOccurrences.length > 0 ? (
                  <PatternStateHeatmap data={correlations.patternStateCoOccurrences} onTrace={openTrace} />
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Not enough sessions with check-in pairs and pattern detections yet.</div>
                )}

                {/* Source impact table */}
                <Tip text="How each content type affects your sovereignty and groundedness.">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>source impact <DTag tag="C" /></div>
                </Tip>
                <div style={subtextStyle}>how each content type affects key dimensions</div>
                {correlations && correlations.sourceTypeImpact.length > 0 ? (
                  <SourceImpactTable data={correlations.sourceTypeImpact} onTrace={openTrace} />
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Record before + after check-ins with source types to see impact.</div>
                )}

                {SHOW_UNIMPLEMENTED && (
                  <>
                    {/* Recovery sessions — placeholder */}
                    <Tip text="Sessions where your state improved the most — requires 5+ session pairs with before/after check-ins">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>recovery sessions</div>
                    </Tip>
                    <div style={subtextStyle}>sessions that left you in a better state than when you arrived</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Needs 5+ sessions with before and after check-ins. Keep using the session ritual.</div>

                    {/* Vulnerability windows — placeholder */}
                    <Tip text="Time patterns that correlate with lower state scores — requires 20+ sessions with check-ins">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>vulnerability windows</div>
                    </Tip>
                    <div style={subtextStyle}>times of day or week when your state tends to be lowest</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Needs 20+ sessions with check-ins to detect time-of-day patterns.</div>
                  </>
                )}
              </>
            )}

            {/* ═══════════════════════════════════════ */}
            {/* TAB 3: OVER TIME                        */}
            {/* ═══════════════════════════════════════ */}
            {tab === "over-time" && (
              <>
                {/* State radar */}
                {checkIns.length > 0 ? (
                  <>
                    <Tip text="Your state readings over time — 6 dimensions averaged, trended, or individual">
                      <div style={sectionHeader}>state readings</div>
                    </Tip>
                    <div style={subtextStyle}>how your state has changed across sessions</div>
                    <StateRadar mode="history" checkIns={filteredCheckIns} />
                  </>
                ) : (
                  <>
                    <div style={sectionHeader}>state readings</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>No check-ins recorded yet. Use the session ritual to track your state.</div>
                  </>
                )}

                {/* Sovereignty trend */}
                <Tip text="Your sovereignty score per session — higher means you felt more like yourself">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>sovereignty over time</div>
                </Tip>
                <div style={subtextStyle}>per-session sovereignty score from check-ins</div>
                {data.sovereigntyTrend && data.sovereigntyTrend.length > 0 ? (
                  <div>
                    {data.sovereigntyTrend.slice(0, 20).map((entry) => (
                      <div key={entry.sessionId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, cursor: "pointer" }}
                        onClick={() => openTrace("Sovereignty", [entry.sessionId], entry.date)}
                      >
                        <span style={{ fontSize: 10, color: "#555", width: 80, flexShrink: 0 }}>{entry.date}</span>
                        <div style={{ flex: 1, height: 20, background: "#1a1a1e", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 3, width: `${entry.score}%`,
                            background: entry.score < 40 ? "#D85A30" : entry.score <= 60 ? "#BA7517" : "#1D9E75",
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: "#666", width: 28, textAlign: "right", flexShrink: 0 }}>{entry.score}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>No sovereignty data yet. Record before + after check-ins with the session ritual.</div>
                )}

                {/* Before→after delta summary */}
                <Tip text="Average state change from entry to exit across all ritual sessions">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>entry {"\u2192"} exit delta</div>
                </Tip>
                <div style={subtextStyle}>mean change from before to after across all sessions with check-in pairs</div>
                {data.beforeAfterDeltas && data.beforeAfterDeltas.sessionCount > 0 ? (() => {
                  const d = data.beforeAfterDeltas!;
                  const dims = [
                    { key: "energy", label: "Energy", val: d.energy },
                    { key: "clarity", label: "Clarity", val: d.clarity },
                    { key: "groundedness", label: "Groundedness", val: d.groundedness },
                    { key: "openness", label: "Openness", val: d.openness },
                    { key: "sovereignty", label: "Sovereignty", val: d.sovereignty },
                    { key: "presence", label: "Presence", val: d.presence },
                  ];
                  return (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {dims.map((dim) => (
                          <div key={dim.key} style={cardStyle}>
                            <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>{dim.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: dim.val === null ? "#333" : dim.val > 0 ? "#1D9E75" : dim.val < 0 ? "#D85A30" : "#555", marginTop: 4 }}>
                              {dim.val === null ? "\u2014" : dim.val > 0 ? `+${dim.val.toFixed(1)}` : dim.val.toFixed(1)}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 9, color: "#444", marginTop: 6 }}>Based on {d.sessionCount} sessions</div>
                    </>
                  );
                })() : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Not enough data yet. Record before + after check-ins.</div>
                )}

                {/* Baseline drift */}
                <Tip text="Long-term direction of each dimension — computed from all check-in history">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>baseline drift</div>
                </Tip>
                <div style={subtextStyle}>which dimensions are trending up or down over your full history</div>
                {baselineDrift ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {baselineDrift.map((d) => (
                      <span key={d.key} style={{
                        fontSize: 10, padding: "4px 10px", borderRadius: 20,
                        border: `1px solid ${d.dir === "up" ? "#1D9E7544" : d.dir === "down" ? "#D85A3044" : "#1a1a2e"}`,
                        background: d.dir === "up" ? "#1D9E7515" : d.dir === "down" ? "#D85A3015" : "transparent",
                        color: d.dir === "up" ? "#1D9E75" : d.dir === "down" ? "#D85A30" : "#333",
                      }}>
                        {d.key} {d.dir === "up" ? `\u2191 +${d.delta}` : d.dir === "down" ? `\u2193 ${d.delta}` : "\u2014"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Not enough data. Record more check-ins.</div>
                )}

                {/* Session timeline */}
                {data.sessionTimeline && data.sessionTimeline.length > 0 && (
                  <>
                    <Tip text="Each block is one session — positioned by when it happened, width reflects duration.">
                      <div style={{ ...sectionHeader, marginTop: 24 }}>session timeline</div>
                    </Tip>
                    <div style={subtextStyle}>individual sessions — position reflects timing, width reflects duration</div>
                    <SessionTimeline sessions={data.sessionTimeline} onTrace={openTrace} />
                  </>
                )}
              </>
            )}

            {/* ═══════════════════════════════════════ */}
            {/* TAB 4: INTENTION                        */}
            {/* ═══════════════════════════════════════ */}
            {tab === "intention" && (
              <>
                {/* Intention-outcome matrix */}
                <Tip text="How your stated intentions correlate with how you feel after sessions.">
                  <div style={sectionHeader}>intention {"\u2192"} outcome <DTag tag="C" /></div>
                </Tip>
                <div style={subtextStyle}>what you intended vs how you left — from session ritual tags</div>
                {correlations && correlations.intentionOutcomeMatrix.length > 0 ? (
                  <IntentionOutcomeMatrix data={correlations.intentionOutcomeMatrix} intentionTags={correlations.allIntentionTags} outcomeTags={correlations.allOutcomeTags} onTrace={openTrace} />
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Use the Session Ritual to tag intentions and outcomes. Patterns will appear here.</div>
                )}

                {/* Intention-outcome gaps */}
                <Tip text="Intention-outcome mismatches — when you intended one thing but felt differently after">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>intention-outcome gaps</div>
                </Tip>
                <div style={subtextStyle}>where intentions and outcomes diverge most</div>
                {(() => {
                  const gaps = (correlations?.intentionOutcomeMatrix ?? [])
                    .filter((e) => !ALIGNED_OUTCOMES[e.intentionTag]?.includes(e.outcomeTag))
                    .sort((a, b) => b.count - a.count);
                  if (gaps.length === 0) return <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>All intentions aligned with outcomes, or not enough ritual data yet.</div>;
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {gaps.slice(0, 8).map((g) => (
                        <div key={`${g.intentionTag}-${g.outcomeTag}`} style={{ ...cardStyle, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                          onClick={() => openTrace(`${g.intentionTag} \u2192 ${g.outcomeTag}`, g.sessionIds, "Intention-outcome gap")}
                        >
                          <span style={{ fontSize: 11, color: "#999" }}>You intended <strong style={{ color: "#ccc" }}>{g.intentionTag}</strong> but felt <strong style={{ color: "#D85A30" }}>{g.outcomeTag}</strong></span>
                          <span style={{ fontSize: 10, color: "#555" }}>{g.count}x</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Relationship sovereignty */}
                <Tip text="How different speaker types affect your sovereignty">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>relationship {"\u00D7"} sovereignty</div>
                </Tip>
                <div style={subtextStyle}>which speaker types correlate with sovereignty changes</div>
                {correlations?.relationshipSovereignty && correlations.relationshipSovereignty.length > 0 ? (
                  <div>
                    {correlations.relationshipSovereignty.map((r) => {
                      const delta = r.meanSovereigntyDelta;
                      const absDelta = Math.abs(delta ?? 0);
                      const maxDelta = Math.max(...correlations.relationshipSovereignty!.map((x) => Math.abs(x.meanSovereigntyDelta ?? 0)), 1);
                      return (
                        <div key={r.relationshipTag} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, cursor: "pointer" }}
                          onClick={() => openTrace(r.relationshipTag, r.sessionIds, "Relationship sovereignty")}
                        >
                          <span style={{ fontSize: 10, color: "#888", width: 120, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.relationshipTag}</span>
                          <div style={{ flex: 1, height: 8, background: "#1a1a1e", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 2, width: `${(absDelta / maxDelta) * 100}%`, background: (delta ?? 0) >= 0 ? "#1D9E75" : "#D85A30" }} />
                          </div>
                          <span style={{ fontSize: 10, color: delta === null ? "#333" : (delta ?? 0) >= 0 ? "#1D9E75" : "#D85A30", width: 40, textAlign: "right", flexShrink: 0, fontWeight: 500 }}>
                            {delta === null ? "\u2014" : delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                          </span>
                          <span style={{ fontSize: 9, color: "#444", width: 20, textAlign: "right", flexShrink: 0 }}>{r.sessionCount}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Tag relationships in the session ritual to see how different speakers affect your sovereignty.</div>
                )}

                {/* Ritual tag summary */}
                <Tip text="All ritual tags used and their frequency">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>ritual tags</div>
                </Tip>
                <div style={subtextStyle}>intentions and outcomes you have tagged across sessions</div>
                {(() => {
                  const matrix = correlations?.intentionOutcomeMatrix ?? [];
                  if (matrix.length === 0) return <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Use the session ritual to tag your intentions and outcomes.</div>;
                  const intentionCounts = new Map<string, number>();
                  const outcomeCounts = new Map<string, number>();
                  for (const e of matrix) {
                    intentionCounts.set(e.intentionTag, (intentionCounts.get(e.intentionTag) ?? 0) + e.count);
                    outcomeCounts.set(e.outcomeTag, (outcomeCounts.get(e.outcomeTag) ?? 0) + e.count);
                  }
                  const maxI = Math.max(...intentionCounts.values(), 1);
                  const maxO = Math.max(...outcomeCounts.values(), 1);
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div>
                        <span style={{ fontSize: 9, color: "#444", marginRight: 8 }}>intentions:</span>
                        {[...intentionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => (
                          <span key={tag} style={{ fontSize: 10, color: "#888", padding: "2px 8px", borderRadius: 10, border: "1px solid #1a1a2e", marginRight: 4, opacity: 0.4 + (count / maxI) * 0.6 }}>{tag} {count}</span>
                        ))}
                      </div>
                      <div>
                        <span style={{ fontSize: 9, color: "#444", marginRight: 8 }}>outcomes:</span>
                        {[...outcomeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => (
                          <span key={tag} style={{ fontSize: 10, color: "#888", padding: "2px 8px", borderRadius: 10, border: "1px solid #1a1a2e", marginRight: 4, opacity: 0.4 + (count / maxO) * 0.6 }}>{tag} {count}</span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* ═══════════════════════════════════════ */}
            {/* TAB 5: YOUR VOICE                       */}
            {/* ═══════════════════════════════════════ */}
            {tab === "your-voice" && (
              <>
                {/* Your top patterns (MIC only) */}
                <Tip text="Rhetorical patterns detected in YOUR speech only (MIC segments)">
                  <div style={sectionHeader}>your top patterns</div>
                </Tip>
                <div style={subtextStyle}>patterns detected in what you said — not what others said</div>
                {correlations?.micPatternFrequency && correlations.micPatternFrequency.length > 0 ? (() => {
                  const pats = correlations.micPatternFrequency!.slice(0, 10);
                  const maxC = Math.max(...pats.map((p) => p.count), 1);
                  return (
                    <div>
                      {pats.map((p, i) => (
                        <div key={p.patternId} style={{ display: "flex", alignItems: "center", height: 22, padding: "3px 0", cursor: "pointer", gap: 2 }}
                          onClick={() => openTrace(formatPatternName(p.patternId), p.sessionIds, "Your speech pattern")}
                        >
                          <span style={{ fontSize: 11, color: "#333", width: 20, flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ width: 150, fontSize: 11, color: "#888", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatPatternName(p.patternId)}</span>
                          <div style={{ flex: 1, height: 4, background: "#1a1a1e", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 2, background: "#378ADD", width: `${(p.count / maxC) * 100}%` }} />
                          </div>
                          <span style={{ fontSize: 11, color: "#555", width: 30, textAlign: "right", flexShrink: 0 }}>{p.count}</span>
                        </div>
                      ))}
                    </div>
                  );
                })() : (
                  <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>No MIC-only patterns detected. Use Speakers or Live mode with a microphone to track your own speech patterns.</div>
                )}

                {/* Exchange ratio */}
                <Tip text="How much of the conversation was yours vs theirs">
                  <div style={{ ...sectionHeader, marginTop: 24 }}>exchange ratio</div>
                </Tip>
                <div style={subtextStyle}>your word count vs total — how much of the conversation you contributed</div>
                {(() => {
                  const sr = data.speakerRatio;
                  const micW = sr?.micWords ?? 0;
                  const totalW = sr?.totalWords ?? 0;
                  const pct = sr?.micPercent ?? 0;
                  if (micW === 0 && totalW === 0) return <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>No speaker data. Use Speakers or Live mode to separate your voice.</div>;
                  return (
                    <div>
                      <div style={{ height: 20, background: "#1a1a1e", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                        <div style={{ width: `${pct}%`, background: "#378ADD", borderRadius: "4px 0 0 4px" }} />
                      </div>
                      <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{pct.toFixed(0)}% yours {"\u00B7"} {micW} / {totalW} words</div>
                    </div>
                  );
                })()}

                {SHOW_UNIMPLEMENTED && (
                  <>
                    {/* Placeholders */}
                    <div style={{ ...sectionHeader, marginTop: 24 }}>mirroring effect</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Needs 10+ diarized sessions to detect whether you mirror the rhetorical patterns of who you listen to.</div>

                    <div style={{ ...sectionHeader, marginTop: 24 }}>your patterns vs theirs</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Needs 5+ diarized sessions to compare your rhetorical patterns against speakers you listen to.</div>

                    <div style={{ ...sectionHeader, marginTop: 24 }}>voice signature</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11 }}>Needs 20+ sessions to build a stable profile of your rhetorical fingerprint.</div>

                    <div style={{ ...sectionHeader, marginTop: 24 }}>text tracking</div>
                    <div style={{ ...cardStyle, color: "#333", fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 14, borderRadius: 7, background: "#1a1a2e", position: "relative" }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#333", position: "absolute", left: 2, top: 2 }} />
                      </div>
                      <span>Track clipboard and typed text — coming in v2</span>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Bottom padding */}
            <div style={{ height: 40 }} />
          </>
        )}
      </div>

      {/* Trace panel */}
      {trace && (
        <TracePanel trace={trace} sessions={allSessions} onSelectSession={onSelectSession} onClose={() => setTrace(null)} />
      )}

      {/* Map overlay */}
      {mapOpen && (
        <MapView isOpen={mapOpen} onClose={() => setMapOpen(false)} period={period} onSelectSession={onSelectSession ?? (() => {})} />
      )}
    </div>
  );
}

// ─── Sub-components ───

function DeltaCell({ value }: { value: number }) {
  const color = value > 0 ? "#1D9E75" : value < 0 ? "#BA7517" : "#333";
  const label = value > 0 ? `+${value}` : value < 0 ? String(value) : "0";
  return (
    <div style={{ color, textAlign: "center", fontSize: 11, padding: "4px 0", fontWeight: 500 }}>
      {label}
    </div>
  );
}

function MetricCard({ label, value, delta, suffix, tip, tag }: {
  label: string; value: string; delta: number | null; suffix: string; tip?: string; tag?: string;
}) {
  const inner = (
    <div style={cardStyle}>
      <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}{tag && <DTag tag={tag} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#ddd", marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: delta !== null ? deltaColor(delta) : "#444", marginTop: 2 }}>
        {delta !== null ? `${delta >= 0 ? "+" : ""}${delta} ${suffix}` : suffix}
      </div>
    </div>
  );
  return tip ? <Tip text={tip}>{inner}</Tip> : inner;
}

function SourceBars({ title, entries, valueKey, barColor }: {
  title: string;
  entries: Array<[string, { sessionCount: number; patternCount: number; wordCount: number }]>;
  valueKey: "sessionCount" | "ratio";
  barColor: string;
}) {
  const values = entries.map(([, v]) => valueKey === "ratio" ? v.patternCount / Math.max(v.wordCount, 1) : v.sessionCount);
  const maxVal = Math.max(...values, 1);
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>{title}</div>
      {entries.map(([source, v], i) => {
        const val = values[i]!;
        return (
          <div key={source} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ width: 110, fontSize: 10, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{source}</span>
            <div style={{ flex: 1, height: 6, background: "#1a1a1e", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, background: barColor, width: `${(val / maxVal) * 100}%` }} />
            </div>
            <span style={{ fontSize: 10, color: "#555", width: 30, textAlign: "right", flexShrink: 0 }}>
              {valueKey === "ratio" ? `${(val * 100).toFixed(1)}%` : v.sessionCount}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SovereigntyBar({ data }: { data: DataSummary }) {
  const daysSinceStart = data.sovereignty.firstSessionAt
    ? Math.max(1, Math.round((Date.now() - data.sovereignty.firstSessionAt) / 86400000))
    : null;
  return (
    <div>
      <div style={{ height: 24, background: "#1a1a1e", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.min(100, (data.sovereignty.capturedHours / Math.max(data.sovereignty.periodHours, 1)) * 100)}%`,
          background: "linear-gradient(90deg, #1D9E7533, #1D9E7566)", borderRadius: 4,
        }} />
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
        {data.sovereignty.offlinePercent.toFixed(0)}% of your time is yours
        {daysSinceStart != null && ` \u00B7 ${daysSinceStart} day${daysSinceStart === 1 ? "" : "s"} since you started using Forti Fide`}
      </div>
    </div>
  );
}

function PatternBars({ patterns, onTrace, highlightedPattern, onPatternHighlightClear }: {
  patterns: DataSummary["patternFrequency"];
  onTrace: (label: string, sessionIds: string[], subtitle?: string) => void;
  highlightedPattern: string | null | undefined;
  onPatternHighlightClear: (() => void) | undefined;
}) {
  const maxCount = Math.max(...patterns.map((p) => p.count), 1);
  const highlightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlightedPattern && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => onPatternHighlightClear?.(), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedPattern, onPatternHighlightClear]);
  return (
    <div style={{ maxHeight: 360, overflowY: "auto" }}>
      {patterns.map((p, i) => {
        const isHighlighted = p.patternId === highlightedPattern;
        return (
          <div key={p.patternId} ref={isHighlighted ? highlightRef : undefined}
            style={{
              display: "flex", alignItems: "center", height: 22, padding: "3px 0", cursor: "pointer", gap: 2,
              ...(isHighlighted ? { border: "1px solid #7F77DD", borderRadius: 4, background: "#0d0d18", padding: "3px 4px" } : {}),
            }}
            onClick={() => onTrace(formatPatternName(p.patternId), p.sessionIds, `${p.count} detections`)}
          >
            <span style={{ fontSize: 11, color: "#333", width: 20, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ width: 150, fontSize: 11, color: isHighlighted ? "#bbb" : "#888", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatPatternName(p.patternId)}</span>
            <div style={{ flex: 1, height: 4, background: "#1a1a1e", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, background: isHighlighted ? "#7F77DD" : "#BA7517", width: `${(p.count / maxCount) * 100}%` }} />
            </div>
            <span style={{ fontSize: 11, color: "#555", width: 30, textAlign: "right", flexShrink: 0 }}>{p.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function SessionTimeline({ sessions, onTrace }: {
  sessions: DataSummary["sessionTimeline"];
  onTrace: (label: string, sessionIds: string[], subtitle?: string) => void;
}) {
  if (sessions.length === 0) return null;
  const earliest = sessions[0]!.timestamp;
  const latest = Math.max(sessions[sessions.length - 1]!.timestamp, earliest + 3600000);
  const span = latest - earliest;
  const dateFmt = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div>
      <div style={{ position: "relative", height: 40, background: "#1a1a1e", borderRadius: 4, overflow: "hidden" }}>
        {sessions.map((s) => {
          const left = ((s.timestamp - earliest) / span) * 100;
          const widthPct = Math.max(0.8, (s.durationHours / (span / 3600000)) * 100);
          const density = Math.min(1, s.patternCount / 10);
          const r = Math.round(55 + density * 168);
          const g = Math.round(138 - density * 48);
          const b = Math.round(221 - density * 203);
          return (
            <div key={s.id || s.timestamp}
              onClick={() => s.id && onTrace(s.name || "Session", [s.id], dateFmt(s.timestamp))}
              style={{
                position: "absolute", left: `${left}%`, width: `${Math.min(widthPct, 100 - left)}%`,
                top: 4, bottom: 4, background: `rgb(${r},${g},${b})`, borderRadius: 3,
                cursor: s.id ? "pointer" : "default", minWidth: 4, opacity: 0.85, transition: "opacity 0.15s",
              }}
              title={`${s.name || "Session"} \u00B7 ${dateFmt(s.timestamp)} \u00B7 ${s.patternCount} patterns`}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 8, color: "#333" }}>{dateFmt(earliest)}</span>
        {span > 86400000 && <span style={{ fontSize: 8, color: "#333" }}>{dateFmt(earliest + span / 2)}</span>}
        <span style={{ fontSize: 8, color: "#333" }}>{dateFmt(latest)}</span>
      </div>
    </div>
  );
}
