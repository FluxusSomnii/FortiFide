import { useState, useEffect, useRef, useCallback } from "react";
import { api, type DataSummary, type SessionSummary, type DigestData } from "../bridge";
import { useSessionStore } from "../stores/session-store";

// ─── Question context ───

interface QuestionContext {
  patterns?: string[] | undefined;
  sessionIds?: string[] | undefined;
  sourceTypes?: string[] | undefined;
}

// ─── Question definitions ───

interface QuestionDef {
  id: string;
  label: string;
  buildPrompt: (d: DataSummary) => string;
  isAvailable: (d: DataSummary) => boolean;
  unavailableReason: string;
  buildContext: (d: DataSummary) => QuestionContext;
}

const QUESTIONS: QuestionDef[] = [
  {
    id: "q1-pattern-arrival", label: "Pattern Arrival",
    buildPrompt: () => "Looking at the pattern frequency data and source breakdown, what rhetorical patterns are arriving most consistently in this user's environment? Are there any patterns that appear across multiple source types?",
    isAvailable: (d) => (d.patternFrequency?.length ?? 0) >= 3, unavailableReason: "needs 3+ detected patterns",
    buildContext: (d) => ({ patterns: d.patternFrequency?.slice(0, 5).map((p) => p.patternId), sourceTypes: Object.keys(d.sourceBreakdown ?? {}) }),
  },
  {
    id: "q2-drift-reading", label: "Drift Reading",
    buildPrompt: () => "Looking at the drift data (changes vs prior period), what is shifting in this user's rhetorical environment? Are any new patterns emerging or old ones fading?",
    isAvailable: (d) => d.drift?.some((dr) => dr.priorCount > 0) ?? false, unavailableReason: "needs prior period data",
    buildContext: (d) => ({ patterns: d.drift?.map((dr) => dr.patternId), sessionIds: d.drift?.flatMap((dr) => dr.sessionIds).filter((v, i, a) => a.indexOf(v) === i) }),
  },
  {
    id: "q3-source-character", label: "Source Character",
    buildPrompt: () => "Based on the source breakdown (which sources have the most sessions, patterns, and annotation density), what can you say about the rhetorical character of each source?",
    isAvailable: (d) => Object.keys(d.sourceBreakdown ?? {}).length >= 2, unavailableReason: "needs 2+ source types",
    buildContext: (d) => ({ sourceTypes: Object.keys(d.sourceBreakdown ?? {}) }),
  },
  {
    id: "q4-state-impact", label: "State Impact",
    buildPrompt: () => "Based on check-in correlations and resilience observations, how do different types of sessions appear to affect this user's state (energy, clarity, groundedness, openness)?",
    isAvailable: (d) => (d.checkInCorrelations?.length ?? 0) >= 1, unavailableReason: "needs before+after check-in pairs",
    buildContext: (d) => ({ sessionIds: d.checkInCorrelations?.flatMap((c) => c.sessionIds).filter((v, i, a) => a.indexOf(v) === i), sourceTypes: d.checkInCorrelations?.map((c) => c.sourceType) }),
  },
  {
    id: "q4b-state-averages", label: "State Averages",
    buildPrompt: (d) => {
      const avg = d.checkInSummary?.averages;
      return `This person has recorded ${d.checkInSummary?.totalCheckIns} state check-ins. Their average readings are: energy ${avg?.energy?.toFixed(0)}\u00B0, clarity ${avg?.clarity?.toFixed(0)}\u00B0, groundedness ${avg?.groundedness?.toFixed(0)}\u00B0, openness ${avg?.openness?.toFixed(0)}\u00B0. The trend is ${d.checkInSummary?.recentTrend}. What do these averages suggest about their baseline state during this period? What does the trend indicate? Respond in 2-3 plain sentences. No advice.`;
    },
    isAvailable: (d) => (d.checkInSummary?.totalCheckIns ?? 0) >= 2, unavailableReason: "needs 2+ check-ins",
    buildContext: () => ({}),
  },
  {
    id: "q5-blind-spots", label: "Blind Spots",
    buildPrompt: () => "Given the patterns that were NOT detected (absent patterns) and the category breakdown, what rhetorical categories might be underrepresented? Could this indicate blind spots or areas where detection should improve?",
    isAvailable: (d) => (d.absentPatterns?.length ?? 0) >= 5, unavailableReason: "needs 5+ undetected patterns",
    buildContext: (d) => ({ patterns: d.absentPatterns?.slice(0, 10).map((p) => p.patternId) }),
  },
  {
    id: "q6-sovereignty", label: "Sovereignty",
    buildPrompt: (d) => {
      const daysSinceStart = Math.round((Date.now() - (d.sovereignty?.firstSessionAt ?? Date.now())) / 86400000);
      const periodLabel = daysSinceStart > 0 ? `${daysSinceStart} days since they started using Forti Fide` : "this period";
      return `Based on the sovereignty data (time outside captured sessions) and session frequency, how would you characterize this user's media consumption pattern? It has been ${periodLabel}. They have ${d.sovereignty?.offlinePercent?.toFixed(0)}% offline time. Is there a healthy balance between exposure and offline time?`;
    },
    isAvailable: (d) => !!d.sovereignty, unavailableReason: "needs session data",
    buildContext: () => ({}),
  },
  {
    id: "q7-weekly-rhythm", label: "Weekly Rhythm",
    buildPrompt: () => "Looking at the weekly activity data (session counts, pattern counts, and annotation density over time), describe the user's engagement rhythm. Are there notable spikes, drops, or trends?",
    isAvailable: (d) => Object.keys(d.sourceBreakdown ?? {}).length >= 1, unavailableReason: "needs source data",
    buildContext: (d) => ({ sessionIds: d.weeklyActivity?.flatMap((w) => w.sessionIds).filter((v, i, a) => a.indexOf(v) === i) }),
  },
  {
    id: "q8-combination", label: "Full Synthesis",
    buildPrompt: () => "Synthesize all the data into a brief overall picture of this user's rhetorical environment. What stands out most? What might they want to pay attention to going forward?",
    isAvailable: (d) => (d.patternFrequency?.length ?? 0) >= 2, unavailableReason: "needs 2+ detected patterns",
    buildContext: (d) => ({ patterns: d.patternFrequency?.slice(0, 5).map((p) => p.patternId), sourceTypes: Object.keys(d.sourceBreakdown ?? {}) }),
  },
  {
    id: "q9-exchange-balance", label: "Exchange Balance",
    buildPrompt: (d) => `Based on the speaker ratio data (MIC words: ${d.speakerRatio?.micWords ?? 0}, total: ${d.speakerRatio?.totalWords ?? 0}, MIC%: ${d.speakerRatio?.micPercent ?? 0}%) and question ratio (${d.questionRatio ?? 0}% of MIC segments are questions), what does the exchange balance look like? Is this person mostly listening, or actively participating? What does the question ratio suggest about their engagement style?`,
    isAvailable: (d) => (d.speakerRatio?.totalWords ?? 0) > 100, unavailableReason: "needs 100+ transcribed words with speaker data",
    buildContext: () => ({}),
  },
  {
    id: "q10-relationship-patterns", label: "Relationship Patterns",
    buildPrompt: () => "Looking at the relationship tags across sessions, what patterns emerge in who this person interacts with? Are certain relationship types associated with particular state changes or rhetorical patterns?",
    isAvailable: () => true, unavailableReason: "needs relationship-tagged sessions",
    buildContext: () => ({}),
  },
];

// ─── Types ───

interface AiResult {
  questionId: string;
  answer: string;
  error?: string | undefined;
  context?: QuestionContext | undefined;
}

interface StoredSynthesis {
  questionId: string;
  questionLabel: string;
  answer: string;
  storedAt: string;
  period: string;
  context?: QuestionContext | undefined;
}

type PanelState = "selecting" | "loading" | "results";
type AiPeriod = "24h" | "7d" | "30d" | "90d" | "all";

const AI_PERIODS: Array<{ label: string; value: AiPeriod }> = [
  { label: "24h", value: "24h" }, { label: "7d", value: "7d" }, { label: "30d", value: "30d" },
  { label: "90d", value: "90d" }, { label: "all", value: "all" },
];

// ─── Module-level persistence ───

let persistedResults: AiResult[] = [];
let persistedPanelState: PanelState = "selecting";
let persistedSelected: Set<string> = new Set();
let persistedStoredIds: Set<string> = new Set();
let persistedAiPeriod: AiPeriod = "30d";

// ─── Helpers ───

function parseAnswerText(text: string, sessions: SessionSummary[], onSelectSession?: ((id: string) => void) | undefined): React.ReactNode {
  const parts = text.split(/((?:session|live)-[\d]+)/g);
  return parts.map((part, i) => {
    const match = part.match(/^((?:session|live)-[\d]+)$/);
    if (!match) return part;
    const id = match[1]!;
    const session = sessions.find((s) => s.id === id);
    const ts = parseInt(id.split("-").pop() ?? "0", 10);
    const date = new Date(ts > 1e12 ? ts : ts * 1000);
    const label = session?.name ? session.name.slice(0, 25) : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " \u00B7 " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return <span key={i} onClick={() => onSelectSession?.(id)} style={{ color: "#378ADD", cursor: onSelectSession ? "pointer" : "default", textDecoration: "underline" }}>{label}</span>;
  });
}

function formatPatternPill(patternId: string): string { return patternId.replace(/-/g, " "); }

function formatSessionLabel(id: string, sessions: SessionSummary[]): string {
  const sess = sessions.find((s) => s.id === id);
  const ts = parseInt(id.split("-").pop() ?? "0", 10);
  const date = new Date(ts > 1e12 ? ts : ts * 1000);
  return sess?.name ? sess.name.slice(0, 20) : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " \u00B7 " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── Loading animation ───

const PATTERN_WORDS = ["framing", "appeal to authority", "false dichotomy", "anchoring", "emotional appeal", "loaded language", "ad hominem", "bandwagon", "straw man", "slippery slope", "red herring", "tu quoque", "whataboutism", "gaslighting", "sealioning", "motte and bailey"];

function LoadingAnimation({ questionCount }: { questionCount: number }) {
  const [wordIndex, setWordIndex] = useState(0);
  const [dots, setDots] = useState("");
  useEffect(() => {
    const wt = setInterval(() => setWordIndex((i) => (i + 1) % PATTERN_WORDS.length), 1800);
    const dt = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 500);
    return () => { clearInterval(wt); clearInterval(dt); };
  }, []);
  return (
    <div style={{ padding: "24px 0", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 16 }}>analysing {questionCount} question{questionCount > 1 ? "s" : ""}{dots}</div>
      <div style={{ fontSize: 13, color: "#666", fontStyle: "italic", transition: "opacity 0.3s", minHeight: 20 }}>{PATTERN_WORDS[wordIndex]}</div>
      <div style={{ marginTop: 16, height: 2, background: "#1a1a1e", borderRadius: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", background: "#7F77DD", animation: "aiPulse 2s ease-in-out infinite", width: "40%" }} />
      </div>
      <style>{`@keyframes aiPulse { 0% { transform: translateX(-100%); } 50% { transform: translateX(150%); } 100% { transform: translateX(-100%); } }`}</style>
    </div>
  );
}

// ─── HoverTip ───

function HoverTip({ text, color = "#999", children }: { text: string; color?: string | undefined; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const posRef = useRef({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (tooltipRef.current) {
      const tw = tooltipRef.current.offsetWidth || 180;
      const th = tooltipRef.current.offsetHeight || 28;
      let left = e.clientX + 12; let top = e.clientY - th - 6;
      if (left + tw > window.innerWidth - 8) left = e.clientX - tw - 12;
      if (top < 8) top = e.clientY + 18;
      tooltipRef.current.style.left = left + "px"; tooltipRef.current.style.top = top + "px";
    }
  }, []);
  return (
    <span onMouseEnter={() => { timerRef.current = setTimeout(() => setShow(true), 300); }} onMouseLeave={() => { clearTimeout(timerRef.current); setShow(false); }} onMouseMove={handleMouseMove}>
      {children}
      {show && <span ref={tooltipRef} style={{ position: "fixed", left: posRef.current.x + 12, top: posRef.current.y - 28, background: "#1a1a22", border: "1px solid #2a2a34", borderRadius: 5, padding: "4px 8px", fontSize: 9, color, maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, zIndex: 9999, pointerEvents: "none" }}>{text}</span>}
    </span>
  );
}

// ─── PatternPillWithTip ───

function PatternPillWithTip({ patternId }: { patternId: string }) {
  const [definition, setDefinition] = useState<string | null>(null);
  useEffect(() => { api.getPattern(patternId).then((p) => { if (p) setDefinition(p.definition); }).catch(() => {}); }, [patternId]);
  const pill = <span style={{ background: "#0d0d12", border: "1px solid #1a1a2e", fontSize: 9, padding: "2px 6px", borderRadius: 3, color: "#7F77DD" }}>{formatPatternPill(patternId)}</span>;
  if (!definition) return pill;
  return <HoverTip text={definition} color="#999">{pill}</HoverTip>;
}

// ─── SessionRefLinks ───

function SessionRefLinks({ ids, sessions, onSelectSession }: { ids: string[]; sessions: SessionSummary[]; onSelectSession?: ((id: string) => void) | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (ids.length === 0) return null;
  if (ids.length === 1) return <span onClick={() => onSelectSession?.(ids[0]!)} style={{ fontSize: 10, color: "#378ADD", cursor: onSelectSession ? "pointer" : "default", textDecoration: "underline" }}>{formatSessionLabel(ids[0]!, sessions)}</span>;
  return (
    <>
      <span onClick={() => setExpanded(!expanded)} style={{ fontSize: 9, color: "#555", cursor: "pointer", padding: "2px 6px", border: "1px solid #1a1a2e", borderRadius: 3, background: expanded ? "#0d0d18" : "transparent" }}>{expanded ? "hide" : `${ids.length} sessions`}</span>
      {expanded && ids.slice(0, 8).map((id) => <span key={id} onClick={() => onSelectSession?.(id)} style={{ fontSize: 10, color: "#378ADD", cursor: onSelectSession ? "pointer" : "default", textDecoration: "underline" }}>{formatSessionLabel(id, sessions)}</span>)}
    </>
  );
}

// ─── SourcesSection ───

function SourcesSection({ context, sessions, onSelectSession }: { context: QuestionContext; sessions: SessionSummary[]; onSelectSession?: ((id: string) => void) | undefined }) {
  const hasP = context.patterns && context.patterns.length > 0;
  const hasS = context.sessionIds && context.sessionIds.length > 0;
  const hasSrc = context.sourceTypes && context.sourceTypes.length > 0;
  if (!hasP && !hasS && !hasSrc) return <div style={{ fontSize: 10, color: "#444", padding: "4px 0" }}>General analysis — no specific sources tracked.</div>;
  return (
    <div style={{ marginTop: 8, padding: "8px 0" }}>
      {hasP && <div style={{ marginBottom: 6 }}><div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Patterns</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{context.patterns!.map((pid) => <PatternPillWithTip key={pid} patternId={pid} />)}</div></div>}
      {hasS && <div style={{ marginBottom: 6 }}><div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Sessions</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: 10 }}><SessionRefLinks ids={context.sessionIds!} sessions={sessions} onSelectSession={onSelectSession} /></div></div>}
      {hasSrc && <div><div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Source types</div><div style={{ fontSize: 10, color: "#888" }}>{context.sourceTypes!.join(", ")}</div></div>}
    </div>
  );
}

// ─── ResultCard ───

function ResultCard({ question, result, onStore, onDiscard, stored, sessions, onSelectSession }: {
  question: QuestionDef; result: AiResult; onStore: () => void; onDiscard: () => void; stored: boolean; sessions: SessionSummary[]; onSelectSession?: ((id: string) => void) | undefined;
}) {
  const [showSources, setShowSources] = useState(false);
  if (result.error) return (
    <div style={{ background: "#120d0d", border: "1px solid #2a1a1a", borderRadius: 8, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#c44e4e", fontWeight: 500, marginBottom: 4 }}>{question.label}</div>
      <div style={{ fontSize: 11, color: "#666" }}>Error: {result.error}</div>
    </div>
  );
  return (
    <div style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 8, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#7F77DD", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{question.label}</div>
      <div style={{ fontSize: 12, color: "#b0b0b0", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{parseAnswerText(result.answer, sessions, onSelectSession)}</div>
      {result.context?.sessionIds && result.context.sessionIds.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>sessions:</span>
          <SessionRefLinks ids={result.context.sessionIds} sessions={sessions} onSelectSession={onSelectSession} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        {!stored ? (
          <>
            <button onClick={onStore} style={{ fontSize: 10, padding: "4px 12px", background: "transparent", border: "1px solid #2a2a3e", borderRadius: 4, color: "#7F77DD", cursor: "pointer", fontFamily: "inherit" }}>store</button>
            <button onClick={onDiscard} style={{ fontSize: 10, padding: "4px 12px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>discard</button>
          </>
        ) : <span style={{ fontSize: 10, color: "#1D9E75" }}>stored</span>}
        {result.context && <button onClick={() => setShowSources(!showSources)} style={{ fontSize: 10, color: "#888", background: "transparent", border: "1px solid #333", borderRadius: 3, padding: "3px 10px", marginLeft: 6, cursor: "pointer", fontFamily: "inherit" }}>{showSources ? "hide sources" : "sources"}</button>}
      </div>
      {showSources && result.context && <SourcesSection context={result.context} sessions={sessions} onSelectSession={onSelectSession} />}
    </div>
  );
}

// ─── RunGroup for Stored tab ───

interface RunGroup { runTimestamp: number; period: string; entries: StoredSynthesis[] }

function groupByRun(syntheses: StoredSynthesis[]): RunGroup[] {
  if (syntheses.length === 0) return [];
  const sorted = [...syntheses].sort((a, b) => new Date(b.storedAt).getTime() - new Date(a.storedAt).getTime());
  const groups: RunGroup[] = [];
  for (const s of sorted) {
    const ts = new Date(s.storedAt).getTime();
    const existing = groups.find((g) => Math.abs(g.runTimestamp - ts) < 60000);
    if (existing) existing.entries.push(s);
    else groups.push({ runTimestamp: ts, period: s.period, entries: [s] });
  }
  return groups;
}

function RunGroupCard({ group, defaultOpen, onDeleteGroup, sessions, onSelectSession }: { group: RunGroup; defaultOpen: boolean; onDeleteGroup: () => void; sessions: SessionSummary[]; onSelectSession?: ((id: string) => void) | undefined }) {
  const [open, setOpen] = useState(defaultOpen);
  const date = new Date(group.runTimestamp);
  const headerLabel = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " \u00B7 " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " \u2014 " + group.period + " \u2014 " + group.entries.length + " analyse" + (group.entries.length !== 1 ? "s" : "");
  return (
    <div style={{ marginBottom: 8 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: open ? "6px 6px 0 0" : 6, cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace" }}>{open ? "\u25BE" : "\u25B8"}</span>
          <span style={{ fontSize: 11, color: "#888" }}>{headerLabel}</span>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDeleteGroup(); }} style={{ background: "none", border: "none", color: "#333", fontSize: 12, cursor: "pointer", padding: "0 4px" }} onMouseEnter={(e) => { e.currentTarget.style.color = "#c44e4e"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "#333"; }}>{"\u00D7"}</button>
      </div>
      {open && (
        <div style={{ background: "#0a0a10", border: "1px solid #1a1a2e", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "12px 16px" }}>
          {group.entries.map((entry, i) => (
            <div key={entry.questionId + "-" + i} style={{ marginBottom: i < group.entries.length - 1 ? 16 : 0 }}>
              <div style={{ fontSize: 10, color: "#7F77DD", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{entry.questionLabel}</div>
              <div style={{ fontSize: 12, color: "#999", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{parseAnswerText(entry.answer, sessions, onSelectSession)}</div>
              {entry.context && (entry.context.patterns?.length || entry.context.sessionIds?.length || entry.context.sourceTypes?.length) && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  {entry.context.patterns?.map((pid) => <PatternPillWithTip key={pid} patternId={pid} />)}
                  {entry.context.sessionIds && entry.context.sessionIds.length > 0 && <SessionRefLinks ids={entry.context.sessionIds} sessions={sessions} onSelectSession={onSelectSession} />}
                  {entry.context.sourceTypes && entry.context.sourceTypes.length > 0 && <span style={{ fontSize: 9, color: "#555" }}>{entry.context.sourceTypes.join(", ")}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-tab pill style ───

const subPill = (active: boolean): React.CSSProperties => ({
  padding: "6px 16px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "inherit",
  background: active ? "#151520" : "transparent", border: active ? "1px solid #1e1e30" : "1px solid transparent",
  borderRadius: 4, color: active ? "#ddd" : "#444", cursor: "pointer",
});

// ─── Main export ───

interface InsightsTabProps {
  onSelectSession?: ((id: string) => void) | undefined;
}

export function InsightsTab({ onSelectSession }: InsightsTabProps) {
  const [subTab, setSubTab] = useState<"ask" | "stored" | "digest">("ask");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "18px 24px" }}>
      {/* Sub-tab switcher */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
        {(["ask", "stored", "digest"] as const).map((t) => (
          <button key={t} onClick={() => setSubTab(t)} style={subPill(subTab === t)}>{t}</button>
        ))}
      </div>

      {subTab === "ask" && <AskSubTab onSelectSession={onSelectSession} />}
      {subTab === "stored" && <StoredSubTab onSelectSession={onSelectSession} />}
      {subTab === "digest" && <DigestSubTab onSelectSession={onSelectSession} />}
    </div>
  );
}

// ═══════════════════════════════════════════
// ASK sub-tab
// ═══════════════════════════════════════════

function AskSubTab({ onSelectSession }: { onSelectSession?: ((id: string) => void) | undefined }) {
  const [panelState, setPanelStateInner] = useState<PanelState>(persistedPanelState);
  const [selected, setSelectedInner] = useState<Set<string>>(persistedSelected);
  const [results, setResultsInner] = useState<AiResult[]>(persistedResults);
  const [storedIds, setStoredIdsInner] = useState<Set<string>>(persistedStoredIds);
  const [aiPeriod, setAiPeriodInner] = useState<AiPeriod>(persistedAiPeriod);
  const [aiData, setAiData] = useState<DataSummary | null>(null);
  const [aiDataLoading, setAiDataLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const abortRef = useRef(false);

  const setPanelState = useCallback((s: PanelState) => { persistedPanelState = s; setPanelStateInner(s); }, []);
  const setSelected = useCallback((s: Set<string>) => { persistedSelected = s; setSelectedInner(s); }, []);
  const setResults = useCallback((r: AiResult[]) => { persistedResults = r; setResultsInner(r); }, []);
  const setStoredIds = useCallback((s: Set<string>) => { persistedStoredIds = s; setStoredIdsInner(s); }, []);
  const setAiPeriod = useCallback((p: AiPeriod) => { persistedAiPeriod = p; setAiPeriodInner(p); }, []);

  useEffect(() => { api.listSessions().then(setSessions).catch(() => {}); }, []);

  useEffect(() => {
    setAiDataLoading(true);
    api.getDataSummary(aiPeriod).then((d) => { setAiData(d); setAiDataLoading(false); }).catch(() => setAiDataLoading(false));
  }, [aiPeriod]);

  const effectiveData = aiData;

  const toggleQuestion = useCallback((id: string) => {
    if (!effectiveData) return;
    const q = QUESTIONS.find((q) => q.id === id);
    if (!q || !q.isAvailable(effectiveData)) return;
    setSelectedInner((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); persistedSelected = next; return next; });
  }, [effectiveData]);

  const selectAll = useCallback(() => {
    if (!effectiveData) return;
    setSelected(new Set(QUESTIONS.filter((q) => q.isAvailable(effectiveData)).map((q) => q.id)));
  }, [effectiveData, setSelected]);

  const runAnalysis = useCallback(async (questionIds: Set<string>, customQuestions?: QuestionDef[]) => {
    if (!effectiveData) return;
    if (questionIds.size === 0 && !customQuestions?.length) return;
    abortRef.current = false;
    setPanelState("loading");

    const allQuestions = [...QUESTIONS.filter((q) => questionIds.has(q.id)), ...(customQuestions ?? [])];
    const previews = sessions.slice(0, 8).map((s) => {
      const p: { id: string; name?: string | undefined; textPreview: string; detectionCount: number; createdAt: string } = { id: s.id, textPreview: s.textPreview, detectionCount: s.detectionCount, createdAt: s.createdAt };
      if (s.name) p.name = s.name;
      return p;
    });

    const contextMap = new Map<string, QuestionContext>();
    for (const q of allQuestions) contextMap.set(q.id, q.buildContext(effectiveData));

    try {
      const resp = await api.runAiAnalysis({
        questions: allQuestions.map((q) => {
          const ctx = contextMap.get(q.id);
          const hint = ctx?.sessionIds?.length ? `\nRelevant session IDs for this question: ${ctx.sessionIds.slice(0, 8).join(", ")}. Cite these IDs in your answer.` : "";
          return { id: q.id, label: q.label, prompt: q.buildPrompt(effectiveData) + hint };
        }),
        dataSummary: effectiveData,
        recentSessionPreviews: previews,
      });
      if (!abortRef.current) {
        setResults(resp.results.map((r) => ({ ...r, context: contextMap.get(r.questionId) })));
        setPanelState("results");
      }
    } catch (e) {
      if (!abortRef.current) {
        setResults(allQuestions.map((q) => ({ questionId: q.id, answer: "", error: e instanceof Error ? e.message : "Request failed", context: contextMap.get(q.id) })));
        setPanelState("results");
      }
    }
  }, [effectiveData, sessions, setPanelState, setResults]);

  const handleRun = useCallback(() => runAnalysis(selected), [runAnalysis, selected]);

  const handleCustomRun = useCallback(() => {
    if (!customPrompt.trim()) return;
    const customQ: QuestionDef = {
      id: `custom-${Date.now()}`, label: "Custom",
      buildPrompt: () => customPrompt, isAvailable: () => true, unavailableReason: "",
      buildContext: () => ({}),
    };
    runAnalysis(new Set(), [customQ]);
    setShowCustom(false);
    setCustomPrompt("");
  }, [customPrompt, runAnalysis]);

  const handleReanalyse = useCallback(() => { runAnalysis(new Set(results.map((r) => r.questionId))); }, [results, runAnalysis]);

  const handleStore = useCallback(async (result: AiResult) => {
    const q = QUESTIONS.find((q) => q.id === result.questionId) ?? { label: "Custom" };
    const entry: { questionId: string; questionLabel: string; answer: string; storedAt: string; period: string; context?: QuestionContext | undefined } = {
      questionId: result.questionId, questionLabel: q.label, answer: result.answer, storedAt: new Date().toISOString(), period: aiPeriod,
    };
    if (result.context) entry.context = result.context;
    try { await api.storeSynthesis(entry); setStoredIdsInner((prev) => { const n = new Set(prev).add(result.questionId); persistedStoredIds = n; return n; }); } catch {}
  }, [aiPeriod]);

  const handleSaveAll = useCallback(async () => { for (const r of results) { if (!storedIds.has(r.questionId) && !r.error) await handleStore(r); } }, [results, storedIds, handleStore]);
  const handleDiscard = useCallback((qid: string) => { setResultsInner((prev) => { const next = prev.filter((r) => r.questionId !== qid); persistedResults = next; if (next.length === 0) setTimeout(() => setPanelState("selecting"), 0); return next; }); }, [setPanelState]);
  const handleDiscardAll = useCallback(() => { setResults([]); setPanelState("selecting"); }, [setResults, setPanelState]);

  if (!effectiveData && aiDataLoading) return <div style={{ color: "#333", fontSize: 11 }}>loading...</div>;

  return (
    <div>
      {/* Selecting */}
      {panelState === "selecting" && (
        <>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>Select questions to ask about your {aiPeriod} data:</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {AI_PERIODS.map((p) => (
              <button key={p.value} onClick={() => setAiPeriod(p.value)} style={{ fontSize: 9, padding: "3px 8px", background: aiPeriod === p.value ? "#1a1a2e" : "transparent", border: `1px solid ${aiPeriod === p.value ? "#3a3a5e" : "#1a1a1e"}`, borderRadius: 3, color: aiPeriod === p.value ? "#b0b0d0" : "#555", cursor: "pointer", fontFamily: "inherit" }}>{p.label}</button>
            ))}
            {aiDataLoading && <span style={{ fontSize: 9, color: "#555" }}>loading...</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {QUESTIONS.map((q) => {
              const available = effectiveData ? q.isAvailable(effectiveData) : false;
              const isSelected = selected.has(q.id);
              const pill = <button key={q.id} onClick={() => toggleQuestion(q.id)} disabled={!available} style={{ fontSize: 10, padding: "6px 12px", background: isSelected ? "#1a1a2e" : "transparent", border: `1px solid ${isSelected ? "#3a3a5e" : "#222"}`, borderRadius: 5, color: isSelected ? "#b0b0d0" : "#666", cursor: available ? "pointer" : "default", transition: "all 0.15s", opacity: available ? 1 : 0.35, fontFamily: "inherit" }}>{q.label}</button>;
              if (!available) return <HoverTip key={q.id} text={q.unavailableReason} color="#c44e4e">{pill}</HoverTip>;
              return pill;
            })}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleRun} disabled={selected.size === 0} style={{ fontSize: 11, padding: "8px 18px", background: selected.size > 0 ? "#7F77DD" : "#222", border: "none", borderRadius: 5, color: selected.size > 0 ? "#fff" : "#555", cursor: selected.size > 0 ? "pointer" : "default", fontWeight: 500, fontFamily: "inherit" }}>Run Analysis ({selected.size})</button>
            <button onClick={selectAll} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>select all</button>
            <button onClick={() => setShowCustom(!showCustom)} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#7F77DD", cursor: "pointer", fontFamily: "inherit" }}>+ custom question</button>
          </div>
          {showCustom && (
            <div style={{ marginTop: 12 }}>
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder="Ask anything about your data..." rows={3}
                style={{ width: "100%", background: "#0a0a10", border: "1px solid #1a1a2e", borderRadius: 6, padding: "8px 10px", color: "#999", fontSize: 11, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
              <button onClick={handleCustomRun} disabled={!customPrompt.trim()} style={{ marginTop: 6, fontSize: 10, padding: "6px 14px", background: customPrompt.trim() ? "#7F77DD22" : "transparent", border: `1px solid ${customPrompt.trim() ? "#7F77DD55" : "#222"}`, borderRadius: 4, color: customPrompt.trim() ? "#ddd" : "#555", cursor: customPrompt.trim() ? "pointer" : "default", fontFamily: "inherit" }}>Run custom question</button>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {panelState === "loading" && <LoadingAnimation questionCount={Math.max(selected.size, 1)} />}

      {/* Results */}
      {panelState === "results" && (
        <>
          {results.map((r) => {
            const q = QUESTIONS.find((q) => q.id === r.questionId) ?? { id: r.questionId, label: "Custom", buildPrompt: () => "", isAvailable: () => true, unavailableReason: "", buildContext: () => ({}) };
            return <ResultCard key={r.questionId} question={q} result={r} onStore={() => handleStore(r)} onDiscard={() => handleDiscard(r.questionId)} stored={storedIds.has(r.questionId)} sessions={sessions} onSelectSession={onSelectSession} />;
          })}
          {results.length === 0 && <div style={{ fontSize: 11, color: "#444", padding: "8px 0" }}>All results discarded.</div>}
          {results.length > 0 && (() => {
            const allStored = results.filter((r) => !storedIds.has(r.questionId) && !r.error).length === 0;
            return (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={handleReanalyse} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #2a2a3e", borderRadius: 4, color: "#7F77DD", cursor: "pointer", fontFamily: "inherit" }}>re-analyse</button>
                {!allStored && <button onClick={handleSaveAll} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #2a3e2a", borderRadius: 4, color: "#1D9E75", cursor: "pointer", fontFamily: "inherit" }}>store all</button>}
                <button onClick={handleDiscardAll} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>{allStored ? "clear" : "discard all"}</button>
                <button onClick={() => setPanelState("selecting")} style={{ fontSize: 10, padding: "6px 12px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>ask more</button>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// STORED sub-tab
// ═══════════════════════════════════════════

function StoredSubTab({ onSelectSession }: { onSelectSession?: ((id: string) => void) | undefined }) {
  const [syntheses, setSyntheses] = useState<StoredSynthesis[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<string | null>(null);

  useEffect(() => { api.listSessions().then(setSessions).catch(() => {}); }, []);
  useEffect(() => { api.getSynthesis().then((r) => { setSyntheses(r); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  const handleDeleteGroup = useCallback(async (group: RunGroup) => {
    try {
      await api.deleteSynthesisGroup(group.entries.map((e) => ({ questionId: e.questionId, storedAt: e.storedAt })));
      setSyntheses((prev) => { const rm = new Set(group.entries.map((e) => e.questionId + "|" + e.storedAt)); return prev.filter((s) => !rm.has(s.questionId + "|" + s.storedAt)); });
    } catch {}
  }, []);

  const handleDeleteAll = useCallback(async () => {
    if (!window.confirm("Delete all stored analyses? This cannot be undone.")) return;
    for (const s of syntheses) {
      try { await api.deleteSynthesis(s.questionId, s.storedAt); } catch {}
    }
    setSyntheses([]);
  }, [syntheses]);

  if (!loaded) return <div style={{ color: "#333", fontSize: 11 }}>loading...</div>;

  const allPeriods = [...new Set(syntheses.map((s) => s.period))];
  const filtered = syntheses
    .filter((s) => !search.trim() || s.answer.toLowerCase().includes(search.toLowerCase()) || s.questionLabel.toLowerCase().includes(search.toLowerCase()))
    .filter((s) => !periodFilter || s.period === periodFilter);

  const groups = groupByRun(filtered);

  return (
    <div>
      {/* Search + filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stored analyses..."
          style={{ flex: 1, background: "#0a0a10", border: "1px solid #1a1a2e", borderRadius: 6, padding: "7px 10px", color: "#888", fontSize: 11, outline: "none", fontFamily: "inherit" }} />
        {allPeriods.length > 1 && allPeriods.map((p) => (
          <button key={p} onClick={() => setPeriodFilter(periodFilter === p ? null : p)} style={{ fontSize: 9, padding: "3px 8px", background: periodFilter === p ? "#1a1a2e" : "transparent", border: `1px solid ${periodFilter === p ? "#3a3a5e" : "#1a1a1e"}`, borderRadius: 3, color: periodFilter === p ? "#b0b0d0" : "#555", cursor: "pointer", fontFamily: "inherit" }}>{p}</button>
        ))}
      </div>

      {syntheses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={handleDeleteAll} style={{ fontSize: 9, padding: "4px 10px", background: "transparent", border: "1px solid #2a1a1a", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>delete all</button>
        </div>
      )}

      {groups.length === 0 ? (
        <div style={{ fontSize: 11, color: "#333", padding: "16px 0" }}>{syntheses.length === 0 ? "No stored analyses yet. Use the Ask tab to run analyses and store results." : "No matches."}</div>
      ) : (
        <div>
          <div style={{ fontSize: 10, color: "#444", marginBottom: 8 }}>{filtered.length} stored analyse{filtered.length !== 1 ? "s" : ""} in {groups.length} run{groups.length !== 1 ? "s" : ""}</div>
          {groups.map((g, i) => <RunGroupCard key={g.runTimestamp} group={g} defaultOpen={i === 0} onDeleteGroup={() => handleDeleteGroup(g)} sessions={sessions} onSelectSession={onSelectSession} />)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// DIGEST sub-tab
// ═══════════════════════════════════════════

function DigestSubTab({ onSelectSession }: { onSelectSession?: ((id: string) => void) | undefined }) {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const settings = useSessionStore((s) => s.settings);

  useEffect(() => { api.listSessions().then(setSessions).catch(() => {}); }, []);
  useEffect(() => { api.getDigest().then(setDigest).catch(() => {}).finally(() => setLoading(false)); }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError(null);
    try { const d = await api.generateDigest("7d"); setDigest(d); } catch (e) { setError(e instanceof Error ? e.message : "Failed to generate digest"); }
    setGenerating(false);
  }, []);

  const schedule = settings.digestSchedule ?? "off";
  const setSchedule = useCallback((v: "off" | "weekly" | "daily") => {
    useSessionStore.getState().updateSetting("digestSchedule", v);
    useSessionStore.getState().saveSettings({ ...useSessionStore.getState().settings, digestSchedule: v });
  }, []);

  if (loading) return <div style={{ color: "#333", fontSize: 11 }}>loading...</div>;

  return (
    <div>
      {generating && <LoadingAnimation questionCount={4} />}

      {!generating && digest && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: "#ddd", fontWeight: 500 }}>Weekly Brief</div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{digest.period} {"\u00B7"} generated {new Date(digest.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
            </div>
            <button onClick={handleGenerate} style={{ fontSize: 10, padding: "6px 14px", background: "transparent", border: "1px solid #2a2a3e", borderRadius: 4, color: "#1D9E75", cursor: "pointer", fontFamily: "inherit" }}>regenerate</button>
          </div>
          {digest.sections.map((sec, i) => (
            <div key={i} style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 8, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#1D9E75", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{sec.title}</div>
              <div style={{ fontSize: 12, color: "#999", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{parseAnswerText(sec.body, sessions, onSelectSession)}</div>
            </div>
          ))}
        </>
      )}

      {!generating && !digest && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>No digest yet</div>
          <button onClick={handleGenerate} style={{ fontSize: 11, padding: "8px 20px", background: "#1D9E7522", border: "1px solid #1D9E7566", borderRadius: 6, color: "#ddd", cursor: "pointer", fontWeight: 500, fontFamily: "inherit" }}>Generate now</button>
          {error && <div style={{ fontSize: 11, color: "#c44e4e", marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {/* Schedule toggle */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #1a1a1e" }}>
        <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>auto-generate</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["off", "weekly", "daily"] as const).map((opt) => (
            <button key={opt} onClick={() => setSchedule(opt)} style={{
              fontSize: 10, padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
              background: schedule === opt ? "#151520" : "transparent",
              border: schedule === opt ? "1px solid #1e1e30" : "1px solid #1a1a1e",
              color: schedule === opt ? "#ddd" : "#555",
            }}>{opt}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
