import { useState, useEffect, useRef, useCallback } from "react";
import { api, type DataSummary, type SessionSummary, type CheckIn } from "../bridge";

// ─── Types ───

interface NodeDatum {
  id: string;
  type: "session" | "pattern" | "source" | "state" | "analysis";
  label: string;
  r: number;
  color: string;
  pulse: boolean;
  data: Record<string, string>;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface EdgeDatum {
  source: string;
  target: string;
  strength: number;
  dashed: boolean;
}

interface MapViewProps {
  isOpen: boolean;
  onClose: () => void;
  period: "24h" | "7d" | "30d" | "90d" | "all";
  onSelectSession: (id: string) => void;
}

// ─── Helpers ───

function formatDate(ts: number): string {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    " \u00B7 " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

function calendarDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Force simulation ───

function runSimulation(nodes: NodeDatum[], edges: EdgeDatum[], W: number, H: number): void {
  const cx = W / 2;
  const cy = H / 2;

  // Initialise positions — tight cluster around centre
  for (const n of nodes) {
    n.x = cx + (Math.random() - 0.5) * 400;
    n.y = cy + (Math.random() - 0.5) * 400;
    n.vx = 0;
    n.vy = 0;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let tick = 0; tick < 300; tick++) {
    // Repulsion between all pairs (reduced force = tighter)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 1;
        const f = 200 / distSq;
        const fx = dx * f;
        const fy = dy * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along edges (stronger pull)
    for (const e of edges) {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const f = dist * 0.03 * e.strength;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Stronger centre gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.04;
      n.vy += (cy - n.y) * 0.04;
    }

    // Collision resolution
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const minDist = a.r + b.r + 4;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.5;
          const px = (dx / dist) * push;
          const py = (dy / dist) * push;
          a.x -= px;
          a.y -= py;
          b.x += px;
          b.y += py;
        }
      }
    }

    // Apply velocity with more damping (faster settling)
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.8;
      n.vy *= 0.8;
    }
  }
}

// ─── Build graph data ───

interface SynthesisEntry {
  questionId: string;
  questionLabel: string;
  answer: string;
  storedAt: string;
  period: string;
  context?: { patterns?: string[] | undefined; sessionIds?: string[] | undefined; sourceTypes?: string[] | undefined } | undefined;
}

function buildGraph(
  summary: DataSummary,
  sessions: SessionSummary[],
  synthesis: SynthesisEntry[],
  checkIns: CheckIn[],
): { nodes: NodeDatum[]; edges: EdgeDatum[] } {
  const allNodes: NodeDatum[] = [];
  const edges: EdgeDatum[] = [];
  const nodeIds = new Set<string>();

  const addNode = (n: NodeDatum) => { allNodes.push(n); nodeIds.add(n.id); };
  const addEdge = (e: EdgeDatum) => {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) edges.push(e);
  };

  // Session nodes — built from listSessions() (authoritative source of IDs)
  const maxPC = Math.max(...sessions.map((s) => s.detectionCount ?? 0), 1);
  for (const s of sessions) {
    const ts = new Date(s.createdAt).getTime();
    addNode({
      id: s.id,
      type: "session",
      label: s.name || formatDate(ts),
      r: 14 + Math.sqrt((s.detectionCount ?? 0) / maxPC) * 20,
      color: "#1D9E75",
      pulse: false,
      data: {
        date: formatDate(ts),
        patterns: String(s.detectionCount ?? 0),
        source: s.sourceType ?? "untagged",
      },
      x: 0, y: 0, vx: 0, vy: 0,
    });
  }

  // Pattern nodes
  const pf = (summary.patternFrequency ?? []).slice(0, 20);
  const maxCount = Math.max(...pf.map((p) => p.count), 1);
  pf.forEach((p, rank) => {
    addNode({
      id: "pattern-" + p.patternId,
      type: "pattern",
      label: titleCase(p.patternId),
      r: 14 + Math.sqrt(p.count / maxCount) * 24,
      color: "#7F77DD",
      pulse: rank < 3,
      data: { count: String(p.count), sessions: String(p.sessionIds?.length ?? 0) },
      x: 0, y: 0, vx: 0, vy: 0,
    });
  });

  // Source type nodes
  const stb = summary.sourceTypeBreakdown ?? {};
  const maxSC = Math.max(...Object.values(stb).map((v) => v.sessionCount), 1);
  for (const [key, v] of Object.entries(stb)) {
    const isOther = key === "other";
    addNode({
      id: "source-" + key,
      type: "source",
      label: isOther ? "untagged" : key.replace(/-/g, " "),
      r: isOther ? Math.min(16, 12 + Math.sqrt(v.sessionCount / maxSC) * 18) : 12 + Math.sqrt(v.sessionCount / maxSC) * 18,
      color: isOther ? "#888780" : "#BA7517",
      pulse: false,
      data: { sessions: String(v.sessionCount), patterns: String(v.patternCount) },
      x: 0, y: 0, vx: 0, vy: 0,
    });
  }

  // State reading nodes
  const sessionNodeIds = new Set(sessions.map((s) => s.id));
  for (const c of checkIns) {
    if (c.sessionId && sessionNodeIds.has(c.sessionId)) {
      addNode({
        id: "state-" + c.id,
        type: "state",
        label: c.context + " check-in",
        r: 12,
        color: "#D85A30",
        pulse: false,
        data: {
          energy: c.energy + "\u00B0",
          clarity: c.clarity + "\u00B0",
          groundedness: c.groundedness + "\u00B0",
          openness: c.openness + "\u00B0",
        },
        x: 0, y: 0, vx: 0, vy: 0,
      });
    }
  }

  // AI Analysis nodes — group by calendar day
  const synthGroups = new Map<string, SynthesisEntry[]>();
  for (const s of synthesis) {
    const day = calendarDay(s.storedAt);
    const arr = synthGroups.get(day) ?? [];
    arr.push(s);
    synthGroups.set(day, arr);
  }
  for (const [day, entries] of synthGroups) {
    addNode({
      id: "analysis-" + day,
      type: "analysis",
      label: "analysis " + day,
      r: 14 + Math.min(entries.length / 9, 1) * 12,
      color: "#378ADD",
      pulse: false,
      data: { date: day, questions: String(entries.length), period: entries[0]?.period ?? "" },
      x: 0, y: 0, vx: 0, vy: 0,
    });
  }

  // ─── Edges ───

  // Session → Pattern
  for (const p of pf) {
    for (const sid of p.sessionIds ?? []) {
      addEdge({ source: sid, target: "pattern-" + p.patternId, strength: 1, dashed: false });
    }
  }

  // Session → Source type
  for (const s of sessions) {
    if (s.sourceType) {
      addEdge({ source: s.id, target: "source-" + s.sourceType, strength: 1, dashed: false });
    }
  }

  // Session → State
  for (const c of checkIns) {
    if (c.sessionId) {
      addEdge({ source: c.sessionId, target: "state-" + c.id, strength: 1, dashed: false });
    }
  }

  // Pattern → Analysis + Session → Analysis (dashed)
  for (const [day, entries] of synthGroups) {
    const targetId = "analysis-" + day;
    for (const entry of entries) {
      if (entry.context?.patterns) {
        for (const pid of entry.context.patterns) {
          addEdge({ source: "pattern-" + pid, target: targetId, strength: 1, dashed: false });
        }
      }
      if (entry.context?.sessionIds) {
        for (const sid of entry.context.sessionIds) {
          addEdge({ source: sid, target: targetId, strength: 0.5, dashed: true });
        }
      }
    }
  }

  // ─── Remove orphaned nodes (no edges) ───
  // Source nodes are kept even without edges (valid unconnected categories)
  const connectedIds = new Set<string>();
  for (const e of edges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }
  const nodes = allNodes.filter((n) => connectedIds.has(n.id) || n.type === "source");

  return { nodes, edges };
}

// ─── Component ───

export function MapView(props: MapViewProps) {
  const [nodes, setNodes] = useState<NodeDatum[]>([]);
  const [edges, setEdges] = useState<EdgeDatum[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDatum | null>(null);
  const [loading, setLoading] = useState(true);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const transformStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Block browser default scroll on the SVG (passive: false required)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => { e.preventDefault(); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [loading]); // re-attach when SVG mounts after loading

  // Load data and build graph (small delay so SVG has rendered)
  useEffect(() => {
    if (!props.isOpen) return;
    setLoading(true);

    const timer = setTimeout(() => {
      Promise.all([
        api.getDataSummary(props.period),
        api.listSessions(),
        api.getSynthesis(),
        api.getCheckIns(),
      ])
        .then(([summary, sessions, synthesis, checkIns]) => {
          const W = window.innerWidth;
          const H = window.innerHeight;
          const { nodes: n, edges: e } = buildGraph(summary, sessions, synthesis, checkIns);
          runSimulation(n, e, W, H);
          setNodes(n);
          setEdges(e);
          setTransform({ x: 0, y: 0, scale: 1 });
          setSelectedNode(null);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 50);
    return () => clearTimeout(timer);
  }, [props.isOpen, props.period]);

  // Zoom toward cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Read DOM values synchronously BEFORE entering the updater
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const delta = e.deltaY;

    setTransform((t) => {
      const oldScale = t.scale > 0 ? t.scale : 1;
      const factor = delta < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.15, Math.min(4.0, oldScale * factor));
      const ratio = newScale / oldScale;
      return {
        scale: newScale,
        x: cursorX - (cursorX - t.x) * ratio,
        y: cursorY - (cursorY - t.y) * ratio,
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "circle" || (e.target as HTMLElement).tagName === "polygon") return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => { transformStart.current = { x: t.x, y: t.y }; return t; });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform((t) => ({
      ...t,
      x: transformStart.current.x + (e.clientX - dragStart.current.x),
      y: transformStart.current.y + (e.clientY - dragStart.current.y),
    }));
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  if (!props.isOpen) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "#08080e", display: "flex", flexDirection: "column",
    }}>
      {/* Close button top-right */}
      <button
        onClick={props.onClose}
        style={{
          position: "absolute", top: 16, right: 16, zIndex: 9010,
          background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 8,
          color: "#666", fontSize: 18, width: 36, height: 36, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {"\u00D7"}
      </button>

      {/* Period label top-centre */}
      <div style={{
        position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9010,
        background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 6,
        padding: "6px 16px", fontSize: 11, color: "#666", letterSpacing: "0.06em",
      }}>
        {props.period === "all" ? "all time" : props.period}
      </div>

      {/* Zoom controls top-left */}
      <div style={{ position: "absolute", top: 16, left: 16, zIndex: 9010, display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          onClick={() => setTransform((t) => ({ ...t, scale: Math.min(4.0, t.scale * 1.2) }))}
          style={{ width: 28, height: 28, background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 6, color: "#666", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >+</button>
        <button
          onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.15, t.scale / 1.2) }))}
          style={{ width: 28, height: 28, background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 6, color: "#666", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >{"\u2212"}</button>
      </div>

      {/* Legend bottom-left */}
      <div style={{
        position: "absolute", bottom: 16, left: 16, zIndex: 9010,
        background: "#0f0f1a99", border: "1px solid #1a1a2e", borderRadius: 6,
        padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6,
      }}>
        {([
          ["#1D9E75", "session"],
          ["#7F77DD", "pattern"],
          ["#BA7517", "source type"],
          ["#D85A30", "state reading"],
          ["#378ADD", "ai analysis"],
        ] as const).map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: "#666" }}>{l}</span>
          </div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 12 }}>
          building map...
        </div>
      )}

      {/* SVG canvas */}
      {!loading && (() => {
        const st = {
          x: isFinite(transform.x) ? transform.x : 0,
          y: isFinite(transform.y) ? transform.y : 0,
          scale: isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1,
        };
        return (
        <svg
          ref={svgRef}
          width="100%" height="100%"
          style={{ flex: 1, cursor: dragging ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Entrance animation */}
          <style>{`
            @keyframes mapNodeIn {
              from { opacity: 0; transform: scale(0.5); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes mapEdgeIn {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
          `}</style>
          <g transform={`translate(${st.x},${st.y}) scale(${st.scale})`}>
            {/* Edges */}
            {edges.map((e, i) => {
              const src = nodes.find((n) => n.id === e.source);
              const tgt = nodes.find((n) => n.id === e.target);
              if (!src || !tgt) return null;
              return (
                <line
                  key={`e-${i}`}
                  x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke={e.dashed ? "#2a2a4a" : src.color}
                  strokeOpacity={e.dashed ? 0.5 : 0.35}
                  strokeWidth={Math.min(4, 1 + e.strength * 0.8)}
                  strokeDasharray={e.dashed ? "4 4" : undefined}
                  style={{ animation: `mapEdgeIn 0.6s ease-out ${0.1 + i * 0.003}s both` }}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node, ni) => {
              const labelSize = Math.max(10, Math.min(13, node.r * 0.65));
              const truncLabel = node.label.length > 18 ? node.label.slice(0, 18) + "\u2026" : node.label;
              const delay = `${0.05 + ni * 0.03}s`;

              if (node.type === "analysis") {
                const s = node.r;
                const pts = `${node.x},${node.y - s} ${node.x + s},${node.y} ${node.x},${node.y + s} ${node.x - s},${node.y}`;
                return (
                  <g key={node.id} onClick={() => setSelectedNode(node)} style={{ cursor: "pointer", transformOrigin: `${node.x}px ${node.y}px`, animation: `mapNodeIn 0.4s ease-out ${delay} both` }}>
                    <polygon
                      points={pts}
                      fill={node.color} fillOpacity={0.15}
                      stroke={node.color} strokeOpacity={0.8}
                      strokeWidth={1.5}
                    />
                    <text
                      x={node.x} y={node.y + node.r + 14}
                      textAnchor="middle" fontSize={labelSize} fill="#666"
                      style={{ pointerEvents: "none" }}
                    >
                      {truncLabel}
                    </text>
                    <text
                      x={node.x} y={node.y + 4}
                      textAnchor="middle" fontSize={9} fill={node.color}
                      style={{ pointerEvents: "none" }}
                    >
                      {Object.values(node.data)[0]}
                    </text>
                  </g>
                );
              }

              return (
                <g key={node.id} onClick={() => setSelectedNode(node)} style={{ cursor: "pointer", transformOrigin: `${node.x}px ${node.y}px`, animation: `mapNodeIn 0.4s ease-out ${delay} both` }}>
                  {node.pulse && (
                    <>
                      <circle cx={node.x} cy={node.y} r={node.r + 6} fill="none" stroke={node.color} strokeWidth={0.5} opacity={0.3}>
                        <animate attributeName="r" from={String(node.r + 4)} to={String(node.r + 16)} dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.5" to="0" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={node.x} cy={node.y} r={node.r + 3} fill="none" stroke={node.color} strokeWidth={0.3} opacity={0.2}>
                        <animate attributeName="r" from={String(node.r + 2)} to={String(node.r + 12)} dur="2.5s" begin="0.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.4" to="0" dur="2.5s" begin="0.6s" repeatCount="indefinite" />
                      </circle>
                    </>
                  )}
                  <circle
                    cx={node.x} cy={node.y} r={node.r}
                    fill={node.color} fillOpacity={0.15}
                    stroke={node.color} strokeOpacity={0.8}
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={node.x} cy={node.y} r={node.r * 0.4}
                    fill={node.color} fillOpacity={0.35}
                  />
                  <text
                    x={node.x} y={node.y + node.r + 14}
                    textAnchor="middle" fontSize={labelSize} fill="#666"
                    style={{ pointerEvents: "none" }}
                  >
                    {truncLabel}
                  </text>
                  {node.type !== "state" && (
                    <text
                      x={node.x} y={node.y + 4}
                      textAnchor="middle" fontSize={Math.max(9, node.r * 0.45)} fill={node.color}
                      style={{ pointerEvents: "none" }}
                    >
                      {Object.values(node.data)[0]}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        );
      })()}

      {/* Info panel */}
      {selectedNode && (
        <div style={{
          position: "absolute", top: 60, right: 16, zIndex: 9010,
          background: "#0f0f1a", border: "1px solid #2a2a4a", borderRadius: 10,
          padding: "14px 18px", width: 260,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#ccc", fontWeight: 500 }}>{selectedNode.label}</span>
            <button
              onClick={() => setSelectedNode(null)}
              style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "0 2px" }}
            >{"\u00D7"}</button>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{
              fontSize: 9, color: selectedNode.color, textTransform: "uppercase",
              letterSpacing: "0.08em", background: selectedNode.color + "18",
              border: `1px solid ${selectedNode.color}40`,
              borderRadius: 3, padding: "2px 8px",
            }}>
              {selectedNode.type}
            </span>
          </div>
          {Object.entries(selectedNode.data).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", padding: "2px 0" }}>
              <span style={{ color: "#555" }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {selectedNode.type === "session" && (
            <button
              onClick={() => { props.onSelectSession(selectedNode.id); props.onClose(); }}
              style={{
                marginTop: 10, width: "100%", background: "transparent",
                border: "1px solid #2a2a4a", borderRadius: 5,
                color: "#7F77DD", fontSize: 10, padding: "5px 0",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {"\u2192"} open session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
