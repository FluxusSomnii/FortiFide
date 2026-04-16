import { useState, useEffect, useRef, useCallback } from "react";
import { useSessionStore, type RitualData } from "../stores/session-store";
import { SOURCE_TYPES } from "../bridge";
import { StateRadar, type StateValues, type DimKey } from "./StateRadar";

// ─── Dimensions (for exit comparison display) ───

const DIM_INFO: Array<{ key: DimKey; label: string; color: string }> = [
  { key: "energy",       label: "Ene", color: "#378ADD" },
  { key: "clarity",      label: "Cla", color: "#1D9E75" },
  { key: "groundedness", label: "Grd", color: "#BA7517" },
  { key: "openness",     label: "Opn", color: "#7F77DD" },
  { key: "sovereignty",  label: "Sov", color: "#D85A30" },
  { key: "presence",     label: "Pre", color: "#5DCAA5" },
];

// ─── Tag vocabularies ───

const INTENTION_TAGS = ["learn", "monitor", "entertain", "decide", "research", "reflect", "verify", "other"];
const RELATIONSHIP_TAGS = ["media / broadcast", "public figure", "institution", "friend / known", "AI system", "crowd / audience", "unknown", "self"];
const OUTCOME_TAGS = ["informed", "unsettled", "energised", "drained", "confused", "clear", "activated", "neutral"];

// ─── Slider styles (for ritual animation) ───

const SLIDER_STYLE_ID = "fides-ritual-slider-style";

function ensureRitualStyles() {
  if (document.getElementById(SLIDER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SLIDER_STYLE_ID;
  style.textContent = `
    @keyframes ritualIn {
      from { opacity: 0; transform: translateY(24px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Tooltip ───

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pos = useRef({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    pos.current = { x: e.clientX, y: e.clientY };
    if (ref.current) {
      const tw = ref.current.offsetWidth || 200;
      let left = e.clientX + 12;
      let top = e.clientY - 30;
      if (left + tw > window.innerWidth - 8) left = e.clientX - tw - 12;
      if (top < 8) top = e.clientY + 18;
      ref.current.style.left = left + "px";
      ref.current.style.top = top + "px";
    }
  }, []);

  return (
    <span
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 400); }}
      onMouseLeave={() => { clearTimeout(timer.current); setShow(false); }}
      onMouseMove={onMove}
    >
      {children}
      {show && (
        <span ref={ref} style={{
          position: "fixed", left: pos.current.x + 12, top: pos.current.y - 30,
          background: "#1a1a22", border: "1px solid #2a2a34", borderRadius: 5,
          padding: "4px 8px", fontSize: 10, color: "#999", maxWidth: 260,
          whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4,
          zIndex: 9999, pointerEvents: "none",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Pill row ───

function PillRow({
  items, selected, onToggle, accent, multi,
}: {
  items: string[];
  selected: string | string[];
  onToggle: (item: string) => void;
  accent: string;
  multi?: boolean | undefined;
}) {
  const isSelected = (item: string) =>
    multi ? (selected as string[]).includes(item) : selected === item;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((item) => {
        const sel = isSelected(item);
        return (
          <button key={item} onClick={() => onToggle(item)} style={{
            padding: "3px 12px", borderRadius: 20, fontSize: 10, cursor: "pointer",
            letterSpacing: "0.04em", fontFamily: "inherit", textTransform: "capitalize",
            border: sel ? `1px solid ${accent}55` : "1px solid #1a1a2e",
            background: sel ? `${accent}15` : "transparent",
            color: sel ? "#ccc" : "#3a3a5a",
            transition: "all 0.15s ease",
          }}>
            {item}
          </button>
        );
      })}
    </div>
  );
}

// ─── Section label ───

function SectionLabel({ text, tip }: { text: string; tip?: string | undefined }) {
  const label = (
    <div style={{
      fontSize: 9, color: "#2a2a4a", textTransform: "uppercase",
      letterSpacing: "0.12em", marginBottom: 8,
    }}>
      {text}
    </div>
  );
  return tip ? <Tip text={tip}>{label}</Tip> : label;
}

// ─── Main Component ───

interface SessionRitualCardProps {
  mode: "entry" | "exit";
  onComplete: (data: RitualData) => void;
  onSkip: () => void;
  onCancel?: (() => void) | undefined;
  previousState?: { energy: number; clarity: number; groundedness: number; openness: number; sovereignty?: number | undefined; presence?: number | undefined } | undefined;
  lastSavedState?: { energy: number; clarity: number; groundedness: number; openness: number; sovereignty?: number | undefined; presence?: number | undefined } | undefined;
}

export function SessionRitualCard({ mode, onComplete, onSkip, onCancel, previousState, lastSavedState }: SessionRitualCardProps) {
  const [sliderValues, setSliderValues] = useState<StateValues>({
    energy: lastSavedState?.energy ?? 50,
    clarity: lastSavedState?.clarity ?? 50,
    groundedness: lastSavedState?.groundedness ?? 50,
    openness: lastSavedState?.openness ?? 50,
    sovereignty: lastSavedState?.sovereignty ?? 50,
    presence: lastSavedState?.presence ?? 50,
  });

  const [selectedIntention, setSelectedIntention] = useState<string | undefined>(undefined);
  const [selectedRelationships, setSelectedRelationships] = useState<string[]>([]);
  const [selectedSourceType, setSelectedSourceType] = useState<string | undefined>(undefined);
  const [selectedOutcome, setSelectedOutcome] = useState<string | undefined>(undefined);

  useEffect(() => { ensureRitualStyles(); }, []);

  const accentColor = mode === "entry" ? "#1D9E75" : "#BA7517";

  const toggleRelationship = useCallback((tag: string) => {
    setSelectedRelationships((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleComplete = useCallback(() => {
    const data: RitualData = {
      state: {
        energy: sliderValues.energy,
        clarity: sliderValues.clarity,
        groundedness: sliderValues.groundedness,
        openness: sliderValues.openness,
        sovereignty: sliderValues.sovereignty,
        presence: sliderValues.presence,
      },
      relationshipTags: selectedRelationships,
      timestamp: Date.now(),
    };
    if (mode === "entry") {
      if (selectedIntention) data.intentionTag = selectedIntention;
      if (selectedSourceType) data.sourceType = selectedSourceType;
    }
    if (mode === "exit" && selectedOutcome) {
      data.outcomeTag = selectedOutcome;
    }
    const store = useSessionStore.getState();
    store.updateSetting("lastSliderValues" as keyof typeof store.settings, {
      energy: sliderValues.energy,
      clarity: sliderValues.clarity,
      groundedness: sliderValues.groundedness,
      openness: sliderValues.openness,
      sovereignty: sliderValues.sovereignty,
      presence: sliderValues.presence,
    } as never);
    onComplete(data);
  }, [sliderValues, selectedIntention, selectedRelationships, selectedSourceType, selectedOutcome, mode, onComplete]);

  return (
    <div style={{
      width: "min(780px, 92vw)",
      background: "#0c0c14",
      borderRadius: 16,
      border: "1px solid #1a1a2e",
      padding: "28px 32px",
      margin: "0 auto",
      animation: "ritualIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: accentColor }} />
        <span style={{ fontSize: 15, color: "#ddd", fontWeight: 500 }}>
          {mode === "entry" ? "before you begin" : "how are you leaving?"}
        </span>
        <span style={{
          fontSize: 9, color: accentColor, textTransform: "uppercase",
          letterSpacing: "0.08em", background: accentColor + "18",
          border: `1px solid ${accentColor}40`, borderRadius: 3,
          padding: "1px 6px",
        }}>
          {mode}
        </span>
      </div>

      {/* Exit: before comparison row */}
      {mode === "exit" && previousState && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "8px 0", marginTop: 8, marginBottom: 4,
        }}>
          <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.06em" }}>when you started</span>
          {DIM_INFO.map((dim) => {
            const before = previousState[dim.key] ?? 50;
            return (
              <div key={dim.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: dim.color, opacity: 0.6 }} />
                <span style={{ fontSize: 10, color: "#444" }}>{dim.label} {before}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Two-column content grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto 1px 1fr",
        gap: 0,
        marginTop: 20,
        alignItems: "start",
      }}>
        {/* LEFT — State Radar */}
        <div style={{ paddingRight: 24 }}>
          <StateRadar mode="input" values={sliderValues} onChange={setSliderValues} />
        </div>

        {/* Vertical divider */}
        <div style={{ background: "#111118", width: 1, alignSelf: "stretch" }} />

        {/* RIGHT — Tags */}
        <div style={{ paddingLeft: 28, display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "entry" && (
            <div>
              <SectionLabel text="intention" tip="What are you entering this session for?" />
              <PillRow
                items={INTENTION_TAGS}
                selected={selectedIntention ?? ""}
                onToggle={(tag) => setSelectedIntention(selectedIntention === tag ? undefined : tag)}
                accent={accentColor}
              />
            </div>
          )}

          <div>
            <SectionLabel text="relationship" tip="Who is the primary speaker?" />
            <PillRow
              items={RELATIONSHIP_TAGS}
              selected={selectedRelationships}
              onToggle={toggleRelationship}
              accent={accentColor}
              multi
            />
          </div>

          {mode === "entry" && (
            <div>
              <SectionLabel text="source type" tip="What kind of content is this?" />
              <PillRow
                items={SOURCE_TYPES.map((st) => st.value)}
                selected={selectedSourceType ?? ""}
                onToggle={(tag) => setSelectedSourceType(selectedSourceType === tag ? undefined : tag)}
                accent={accentColor}
              />
            </div>
          )}

          {mode === "exit" && (
            <div>
              <SectionLabel text="outcome" tip="One word for how you feel leaving." />
              <PillRow
                items={OUTCOME_TAGS}
                selected={selectedOutcome ?? ""}
                onToggle={(tag) => setSelectedOutcome(selectedOutcome === tag ? undefined : tag)}
                accent={accentColor}
              />
            </div>
          )}
        </div>
      </div>

      {/* Button row */}
      <div style={{
        display: "flex",
        justifyContent: mode === "entry" ? "space-between" : "flex-end",
        alignItems: "center",
        gap: 8,
        marginTop: 24,
        paddingTop: 16,
        borderTop: "1px solid #0f0f18",
      }}>
        {mode === "entry" && onCancel && (
          <button onClick={onCancel} style={{
            background: "transparent", border: "1px solid #1a1a2e", borderRadius: 5,
            color: "#333", fontSize: 10, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
          }}>
            Cancel
          </button>
        )}
        {mode === "entry" && <div style={{ flex: 1 }} />}
        <button onClick={onSkip} style={{
          background: "transparent", border: "1px solid #1a1a2e", borderRadius: 5,
          color: "#444", fontSize: 10, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
        }}>
          {mode === "entry" ? "Skip and start" : "Skip and save"}
        </button>
        <button onClick={handleComplete} style={{
          background: `${accentColor}22`, border: `1px solid ${accentColor}66`, borderRadius: 6,
          color: "#ddd", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em",
          padding: "8px 20px", cursor: "pointer", fontFamily: "inherit",
          transition: "background 0.15s",
        }}>
          {mode === "entry" ? "Start session" : "Save session"}
        </button>
      </div>
    </div>
  );
}
