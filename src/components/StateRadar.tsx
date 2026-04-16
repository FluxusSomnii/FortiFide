import { useState, useEffect, useRef, useCallback } from "react";
import type { CheckIn } from "../bridge";

// ─── Dimensions ───

const DIMENSIONS = [
  { key: "energy",       label: "Energy",       color: "#378ADD",
    desc: "Physical and mental fuel available right now.",
    detail: "High energy sessions with heavy emotional content often show the largest groundedness drops." },
  { key: "clarity",      label: "Clarity",       color: "#1D9E75",
    desc: "How focused and clear your thinking feels.",
    detail: "Clarity drops correlate with high cognitive load — dense argument structures and rapidly shifting frames." },
  { key: "groundedness", label: "Groundedness",  color: "#BA7517",
    desc: "How settled and centred you feel.",
    detail: "The dimension most sensitive to fear appeal and urgency framing. Watch for drops after news or media sessions." },
  { key: "openness",     label: "Openness",      color: "#7F77DD",
    desc: "How curious and receptive you are to new ideas.",
    detail: "Low openness often precedes defensive processing. High openness with high fear appeal patterns is a notable combination." },
  { key: "sovereignty",  label: "Sovereignty",   color: "#D85A30",
    desc: "How much you feel like yourself right now.",
    detail: "The core Forti Fide dimension. Sovereignty drops signal sessions where rhetorical pressure was high relative to your baseline." },
  { key: "presence",     label: "Presence",      color: "#5DCAA5",
    desc: "How much you are actually here — not distracted or scattered.",
    detail: "Low presence means session data is less reliable. Low presence combined with low sovereignty is the most vulnerable state for rhetorical influence." },
] as const;

export type DimKey = "energy" | "clarity" | "groundedness" | "openness" | "sovereignty" | "presence";
export type StateValues = Record<DimKey, number>;

const DIM_KEYS: DimKey[] = DIMENSIONS.map((d) => d.key);

// ─── SVG constants ───

const CX = 140, CY = 140, RMIN = 26, RMAX = 108, STEPS = 20, BAR_WIDTH = 9;
const N = 6;

// ─── Geometry helpers ───

function ang(i: number) { return (Math.PI * 2 / N) * i - Math.PI / 2; }
function valToR(v: number) { return RMIN + (v / 100) * (RMAX - RMIN); }
function axPt(i: number, r: number): [number, number] { return [CX + Math.cos(ang(i)) * r, CY + Math.sin(ang(i)) * r]; }
function perpVec(i: number): [number, number] { return [-Math.sin(ang(i)), Math.cos(ang(i))]; }

function segRect(dimIdx: number, step: number, bw: number): string {
  const totalLen = RMAX - RMIN;
  const segLen = (totalLen / STEPS) * 0.72;
  const gap = (totalLen / STEPS) * 0.28;
  const r0 = RMIN + step * (totalLen / STEPS) + gap * 0.5;
  const r1 = r0 + segLen;
  const a = ang(dimIdx);
  const [px, py] = perpVec(dimIdx);
  return [
    `${CX + Math.cos(a) * r0 - px * bw},${CY + Math.sin(a) * r0 - py * bw}`,
    `${CX + Math.cos(a) * r1 - px * bw},${CY + Math.sin(a) * r1 - py * bw}`,
    `${CX + Math.cos(a) * r1 + px * bw},${CY + Math.sin(a) * r1 + py * bw}`,
    `${CX + Math.cos(a) * r0 + px * bw},${CY + Math.sin(a) * r0 + py * bw}`,
  ].join(" ");
}

function defaultVals(partial?: Partial<StateValues>): StateValues {
  const v: StateValues = { energy: 50, clarity: 50, groundedness: 50, openness: 50, sovereignty: 50, presence: 50 };
  if (partial) for (const k of DIM_KEYS) if (partial[k] !== undefined) v[k] = partial[k]!;
  return v;
}

function checkInToVals(c: CheckIn): StateValues {
  return {
    energy: c.energy, clarity: c.clarity, groundedness: c.groundedness, openness: c.openness,
    sovereignty: c.sovereignty ?? 50, presence: c.presence ?? 50,
  };
}

function avgOf(vals: StateValues): number {
  return Math.round(DIM_KEYS.reduce((s, k) => s + vals[k], 0) / N);
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " \u00B7 " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── Grid + Axes (shared between modes) ───

function GridAxes() {
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <>
      {rings.map((pct) => {
        const r = RMIN + pct * (RMAX - RMIN);
        const pts = Array.from({ length: N }, (_, i) => axPt(i, r).join(",")).join(" ");
        return <polygon key={pct} points={pts} fill="none" stroke="#0f1018" strokeWidth={0.5} />;
      })}
      {DIMENSIONS.map((_, i) => {
        const [x2, y2] = axPt(i, RMAX);
        return <line key={i} x1={CX} y1={CY} x2={x2} y2={y2} stroke="#0f1018" strokeWidth={0.5} />;
      })}
    </>
  );
}

// ─── Dotted shape ───

function DottedShape({ vals }: { vals: StateValues }) {
  const pts = DIMENSIONS.map((d, i) => axPt(i, valToR(vals[d.key])).join(",")).join(" ");
  return <polygon points={pts} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} strokeDasharray="3 3" />;
}

// ─── Segments for one axis ───

function AxisSegments({ dimIdx, vals, interactive, onSet }: {
  dimIdx: number; vals: StateValues; interactive: boolean;
  onSet?: ((key: DimKey, value: number) => void) | undefined;
}) {
  const dim = DIMENSIONS[dimIdx]!;
  const val = vals[dim.key];
  return (
    <>
      {Array.from({ length: STEPS }, (_, s) => {
        const threshold = ((s + 1) / STEPS) * 100 - (100 / STEPS * 0.5);
        const filled = val >= threshold;
        return (
          <polygon
            key={s}
            points={segRect(dimIdx, s, BAR_WIDTH)}
            fill={filled ? dim.color : "#111118"}
            opacity={filled ? Number((0.35 + 0.65 * (s / STEPS)).toFixed(2)) : 1}
            style={interactive ? { cursor: "pointer" } : undefined}
            onClick={interactive && onSet ? () => onSet(dim.key, Math.round(((s + 1) / STEPS) * 100)) : undefined}
          />
        );
      })}
    </>
  );
}

// ─── Value label at tip of bar ───

function ValueLabel({ dimIdx, val }: { dimIdx: number; val: number }) {
  const [x, y] = axPt(dimIdx, valToR(val) + 11);
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={DIMENSIONS[dimIdx]!.color} fontSize={8} fontWeight={500}>{Math.round(val)}</text>;
}

// ─── Props ───

interface StateRadarProps {
  mode: "input" | "history";
  values?: Partial<StateValues> | undefined;
  onChange?: ((values: StateValues) => void) | undefined;
  checkIns?: CheckIn[] | undefined;
}

// ─── Main Component ───

export function StateRadar(props: StateRadarProps) {
  if (props.mode === "input") return <InputRadar values={props.values} onChange={props.onChange} />;
  return <HistoryRadar checkIns={props.checkIns ?? []} />;
}

// ─── INPUT MODE ───

function InputRadar({ values, onChange }: { values?: Partial<StateValues> | undefined; onChange?: ((values: StateValues) => void) | undefined }) {
  const [vals, setVals] = useState<StateValues>(() => defaultVals(values));
  const [tip, setTip] = useState<{ dim: typeof DIMENSIONS[number]; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (values) setVals(defaultVals(values));
  }, [values]);

  const handleSet = useCallback((key: DimKey, value: number) => {
    setVals((prev) => {
      const next = { ...prev, [key]: value };
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // viewBox is now "-50 0 380 280": convert DOM pixel → SVG coord.
    const sx = (e.clientX - rect.left) / rect.width * 380 - 50;
    const sy = (e.clientY - rect.top) / rect.height * 280;
    mouseRef.current = { x: e.clientX, y: e.clientY };

    if (dragging !== null) {
      const dx = sx - CX;
      const dy = sy - CY;
      const a = ang(dragging);
      const proj = dx * Math.cos(a) + dy * Math.sin(a);
      const val = Math.max(0, Math.min(100, ((proj - RMIN) / (RMAX - RMIN)) * 100));
      handleSet(DIMENSIONS[dragging]!.key, Math.round(val));
    }
  }, [dragging, handleSet]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <svg ref={svgRef} viewBox="-50 0 380 280" width={380} height={280}
        onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
      >
        <GridAxes />
        <DottedShape vals={vals} />
        {DIMENSIONS.map((_, i) => (
          <g key={i} onMouseDown={() => setDragging(i)}>
            <AxisSegments dimIdx={i} vals={vals} interactive onSet={handleSet} />
          </g>
        ))}
        {DIMENSIONS.map((d, i) => <ValueLabel key={d.key} dimIdx={i} val={vals[d.key]} />)}
        {/* Centre dot */}
        <circle cx={CX} cy={CY} r={3} fill="#1a1a2e" />
        {/* Axis labels */}
        {DIMENSIONS.map((dim, i) => {
          const [x, y] = axPt(i, RMAX + 22);
          const ca = Math.cos(ang(i));
          const anchor = ca > 0.15 ? "start" : ca < -0.15 ? "end" : "middle";
          return (
            <text key={dim.key} x={x} y={y} textAnchor={anchor} dominantBaseline="central"
              fill="#555" fontSize={9} style={{ letterSpacing: "0.06em", cursor: "help" }}
              onMouseEnter={() => setTip({ dim, x: mouseRef.current.x, y: mouseRef.current.y })}
              onMouseLeave={() => setTip(null)}
            >
              {dim.label}
            </text>
          );
        })}
      </svg>
      {tip && (
        <div style={{
          position: "fixed", left: tip.x + 14, top: tip.y - 10, zIndex: 50,
          background: "#0f0f1a", border: "0.5px solid #2a2a4a", borderRadius: 8,
          padding: "9px 12px", fontSize: 11, color: "#aaa", maxWidth: 190, lineHeight: 1.6,
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 500, color: tip.dim.color, marginBottom: 4 }}>{tip.dim.label}</div>
          <div>{tip.dim.desc}</div>
          <div style={{ color: "#555", marginTop: 4, fontSize: 10 }}>{tip.dim.detail}</div>
        </div>
      )}
    </div>
  );
}

// ─── HISTORY MODE ───

type SubMode = "avg" | "recent" | "history";

function HistoryRadar({ checkIns }: { checkIns: CheckIn[] }) {
  const allEntries = checkIns;
  const recentEntries = allEntries.slice(-30);
  const [subMode, setSubMode] = useState<SubMode>("avg");
  const [sliderIdx, setSliderIdx] = useState(Math.max(0, recentEntries.length - 1));
  const [selectedIdx, setSelectedIdx] = useState(Math.max(0, allEntries.length - 1));
  const [search, setSearch] = useState("");
  const [tip, setTip] = useState<{ dim: typeof DIMENSIONS[number]; x: number; y: number } | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  // Compute averages
  const avgVals: StateValues = { energy: 50, clarity: 50, groundedness: 50, openness: 50, sovereignty: 50, presence: 50 };
  if (allEntries.length > 0) {
    for (const k of DIM_KEYS) {
      avgVals[k] = Math.round(allEntries.reduce((s, e) => s + ((e[k as keyof CheckIn] as number) ?? 50), 0) / allEntries.length);
    }
  }

  // Compute trends
  const trends: Record<DimKey, { dir: "up" | "down" | "flat"; delta: number }> = {} as Record<DimKey, { dir: "up" | "down" | "flat"; delta: number }>;
  if (allEntries.length >= 4) {
    const mid = Math.floor(allEntries.length / 2);
    const older = allEntries.slice(0, mid);
    const recent = allEntries.slice(mid);
    for (const k of DIM_KEYS) {
      const olderAvg = older.reduce((s, e) => s + ((e[k as keyof CheckIn] as number) ?? 50), 0) / older.length;
      const recentAvg = recent.reduce((s, e) => s + ((e[k as keyof CheckIn] as number) ?? 50), 0) / recent.length;
      const diff = recentAvg - olderAvg;
      trends[k] = { dir: diff > 2 ? "up" : diff < -2 ? "down" : "flat", delta: Math.round(diff) };
    }
  } else {
    for (const k of DIM_KEYS) trends[k] = { dir: "flat", delta: 0 };
  }

  // Current display values
  let displayVals: StateValues;
  let dateLabel: string;
  if (subMode === "avg") {
    displayVals = avgVals;
    dateLabel = `${allEntries.length} entries`;
  } else if (subMode === "recent") {
    const entry = recentEntries[sliderIdx];
    displayVals = entry ? checkInToVals(entry) : avgVals;
    dateLabel = entry ? fmtDate(entry.timestamp) : "\u2014";
  } else {
    const entry = allEntries[selectedIdx];
    displayVals = entry ? checkInToVals(entry) : avgVals;
    dateLabel = entry ? fmtDate(entry.timestamp) : "\u2014";
  }

  const lastEntry = allEntries[allEntries.length - 1];
  const lastAvg = lastEntry ? avgOf(checkInToVals(lastEntry)) : 50;

  // Filtered history list
  const filteredEntries = search.trim()
    ? allEntries.map((e, i) => ({ e, i })).filter(({ e }) => fmtDate(e.timestamp).toLowerCase().includes(search.toLowerCase()))
    : allEntries.map((e, i) => ({ e, i }));

  return (
    <div style={{ position: "relative" }}>
      {/* Date label */}
      <div style={{ textAlign: "right", fontSize: 10, color: "#444", marginBottom: 4 }}>{dateLabel}</div>

      <svg viewBox="-50 0 380 280" width={380} height={280}
        onMouseMove={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; }}
      >
        <GridAxes />
        {/* Average ghost (shown in recent/history sub-modes) */}
        {subMode !== "avg" && (
          <polygon
            points={DIMENSIONS.map((d, i) => axPt(i, valToR(avgVals[d.key])).join(",")).join(" ")}
            fill="none" stroke="#1a1a2e" strokeWidth={1} strokeDasharray="4 3"
          />
        )}
        <DottedShape vals={displayVals} />
        {DIMENSIONS.map((_, i) => (
          <AxisSegments key={i} dimIdx={i} vals={displayVals} interactive={false} />
        ))}
        {DIMENSIONS.map((d, i) => <ValueLabel key={d.key} dimIdx={i} val={displayVals[d.key]} />)}
        <circle cx={CX} cy={CY} r={3} fill="#1a1a2e" />
        {/* Axis labels + trend arrows */}
        {DIMENSIONS.map((dim, i) => {
          const [x, y] = axPt(i, RMAX + 22);
          const ca = Math.cos(ang(i));
          const anchor = ca > 0.15 ? "start" : ca < -0.15 ? "end" : "middle";
          const t = trends[dim.key];
          return (
            <g key={dim.key}>
              <text x={x} y={y} textAnchor={anchor} dominantBaseline="central"
                fill="#555" fontSize={9} style={{ letterSpacing: "0.06em", cursor: "help" }}
                onMouseEnter={() => setTip({ dim, x: mouseRef.current.x, y: mouseRef.current.y })}
                onMouseLeave={() => setTip(null)}
              >
                {dim.label}
              </text>
              {subMode === "avg" && t && (
                <text x={x} y={y + 13} textAnchor={anchor} dominantBaseline="central"
                  fill={t.dir === "up" ? "#1D9E75" : t.dir === "down" ? "#D85A30" : "#1a1a2e"}
                  fontSize={9} fontWeight={t.dir === "flat" ? 400 : 500}
                >
                  {t.dir === "up" ? `\u2191 +${t.delta}` : t.dir === "down" ? `\u2193 ${t.delta}` : "\u2014"}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Slider (recent sub-mode) */}
      {subMode === "recent" && recentEntries.length > 1 && (
        <div style={{ width: 280, marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#333", marginBottom: 4 }}>
            <span>last {recentEntries.length} entries</span>
            <span>{sliderIdx + 1} / {recentEntries.length}</span>
          </div>
          <input type="range" min={0} max={recentEntries.length - 1} value={sliderIdx}
            onChange={(e) => setSliderIdx(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#1D9E75" }}
          />
        </div>
      )}

      {/* Search + list (history sub-mode) */}
      {subMode === "history" && (
        <div style={{ width: 280, marginTop: 8 }}>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="search by date\u2026"
            style={{
              width: "100%", background: "#0a0a10", border: "0.5px solid #1a1a2e", borderRadius: 6,
              padding: "7px 10px", color: "#888", fontSize: 11, outline: "none", fontFamily: "inherit",
              boxSizing: "border-box", marginBottom: 6,
            }}
          />
          <div style={{ maxHeight: 130, overflowY: "auto" }}>
            {filteredEntries.slice(-30).reverse().map(({ e, i }) => (
              <div key={e.id} onClick={() => setSelectedIdx(i)} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "5px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10,
                background: selectedIdx === i ? "#111120" : "transparent",
                border: selectedIdx === i ? "0.5px solid #2a2a4a" : "0.5px solid transparent",
                color: "#666", marginBottom: 2,
              }}>
                <span>{fmtDate(e.timestamp)}</span>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <span style={{ color: "#444", fontSize: 9 }}>avg {avgOf(checkInToVals(e))}</span>
                  {DIMENSIONS.map((dim) => (
                    <div key={dim.key} style={{
                      width: 5, height: 5, borderRadius: "50%", background: dim.color,
                      opacity: ((e[dim.key as keyof CheckIn] as number) ?? 50) / 100,
                    }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Three mode buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, width: 280, marginTop: 10 }}>
        {([
          { key: "avg" as const, label: "Average", value: String(avgOf(avgVals)), color: "#7F77DD" },
          { key: "recent" as const, label: "Latest", value: String(lastAvg), color: "#1D9E75" },
          { key: "history" as const, label: "History", value: "\u2197", color: "#378ADD" },
        ] as const).map((btn) => (
          <button key={btn.key} onClick={() => setSubMode(btn.key)} style={{
            background: subMode === btn.key ? "#111120" : "#0a0a10",
            border: subMode === btn.key ? "0.5px solid #2a2a4a" : "0.5px solid #1a1a2e",
            borderRadius: 8, padding: "8px 6px", cursor: "pointer", textAlign: "center",
            fontFamily: "inherit",
          }}>
            <div style={{ fontSize: 8, textTransform: "uppercase", color: "#333", marginBottom: 3, letterSpacing: "0.08em" }}>{btn.label}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: btn.color }}>{btn.value}</div>
          </button>
        ))}
      </div>

      {/* Tooltip */}
      {tip && (
        <div style={{
          position: "fixed", left: tip.x + 14, top: tip.y - 10, zIndex: 50,
          background: "#0f0f1a", border: "0.5px solid #2a2a4a", borderRadius: 8,
          padding: "9px 12px", fontSize: 11, color: "#aaa", maxWidth: 190, lineHeight: 1.6,
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 500, color: tip.dim.color, marginBottom: 4 }}>{tip.dim.label}</div>
          <div>{tip.dim.desc}</div>
          <div style={{ color: "#555", marginTop: 4, fontSize: 10 }}>{tip.dim.detail}</div>
        </div>
      )}
    </div>
  );
}
