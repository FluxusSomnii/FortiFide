import { useState, useEffect, useMemo, type ReactNode } from "react";
import type { DetectionInstance, PatternCategory } from "@fides/pattern-library";
import { useSessionStore } from "../stores/session-store";
import { useDisplayStore } from "../stores/display-store";
import { api } from "../bridge";
import { AnnotationMark } from "./AnnotationMark";

const MAX_CHARS = 8000;
const WARN_CHARS = 3000;

export function TranscriptView() {
  const clipText = useSessionStore((s) => s.clipText);
  const clipAnalyzing = useSessionStore((s) => s.clipAnalyzing);
  const clipError = useSessionStore((s) => s.clipError);
  const detections = useSessionStore((s) => s.detections);
  const analyzeClip = useSessionStore((s) => s.analyzeClip);
  const resetClip = useSessionStore((s) => s.resetClip);

  const showResults = clipText !== null && !clipAnalyzing;

  if (showResults) {
    return (
      <ResultsView
        text={clipText}
        detections={detections}
        onReset={resetClip}
      />
    );
  }

  return (
    <InputView
      analyzing={clipAnalyzing}
      error={clipError}
      onAnalyze={analyzeClip}
    />
  );
}

// ─── Input Mode ───

function InputView({
  analyzing,
  error,
  onAnalyze,
}: {
  analyzing: boolean;
  error: string | null;
  onAnalyze: (text: string) => void;
}) {
  const [inputText, setInputText] = useState("");

  const canSubmit = inputText.trim().length > 0 && !analyzing;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        maxWidth: 700,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value.slice(0, MAX_CHARS))}
        maxLength={MAX_CHARS}
        placeholder="Paste any text to analyse — article, speech, message, transcript..."
        spellCheck={false}
        autoComplete="off"
        style={{
          width: "100%",
          minHeight: 320,
          flex: 1,
          maxHeight: 500,
          background: "#0f0f0f",
          border: "1px solid #1a1a1a",
          borderRadius: 6,
          color: "#d0d0d0",
          fontSize: 14,
          lineHeight: 1.6,
          padding: 16,
          resize: "none",
          outline: "none",
          fontFamily: "inherit",
        }}
      />

      <div
        style={{
          width: "100%",
          textAlign: "right",
          fontSize: 12,
          marginTop: 4,
        }}
      >
        <span
          style={{
            color:
              inputText.length >= MAX_CHARS
                ? "#c44e4e"
                : inputText.length >= WARN_CHARS
                  ? "#c4a24e"
                  : "#666",
          }}
        >
          {inputText.length.toLocaleString()} /{" "}
          {MAX_CHARS.toLocaleString()} characters
        </span>
        {inputText.length >= WARN_CHARS && inputText.length < MAX_CHARS && (
          <div style={{ color: "#c4a24e", marginTop: 2 }}>
            Long text — consider analysing a focused excerpt for best results.
          </div>
        )}
        {inputText.length >= MAX_CHARS && (
          <div style={{ color: "#c44e4e", marginTop: 2 }}>
            Character limit reached. Text has been truncated.
          </div>
        )}
      </div>

      <button
        onClick={() => onAnalyze(inputText)}
        disabled={!canSubmit}
        style={{
          marginTop: 16,
          background: "transparent",
          border: "1px solid #2a2a2a",
          borderRadius: 4,
          color: canSubmit ? "#d0d0d0" : "#444",
          fontSize: 14,
          padding: "8px 24px",
          cursor: canSubmit ? "pointer" : "default",
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          if (canSubmit) e.currentTarget.style.borderColor = "#444";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#2a2a2a";
        }}
      >
        {analyzing ? "Analysing..." : "Analyse"}
      </button>

      {error && (
        <div style={{ color: "#c44e4e", fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Results Mode ───

function ResultsView({
  text,
  detections,
  onReset,
}: {
  text: string;
  detections: DetectionInstance[];
  onReset: () => void;
}) {
  const wordCount = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const categoryVisibility = useDisplayStore((s) => s.categoryVisibility);
  const confidenceFloor = useDisplayStore((s) => s.confidenceFloor);

  // Build a pattern-id → category lookup from the library
  const [categoryMap, setCategoryMap] = useState<Map<string, PatternCategory>>(
    new Map(),
  );
  useEffect(() => {
    api
      .getLibrary()
      .then((library) => {
        const map = new Map<string, PatternCategory>();
        for (const p of library) {
          map.set(p.id, p.category);
        }
        setCategoryMap(map);
      })
      .catch(() => {});
  }, []);

  // Filter detections by display preferences
  const visibleDetections = useMemo(() => {
    return detections.filter((d) => {
      const cat = categoryMap.get(d.patternId);
      if (cat && categoryVisibility[cat] === false) return false;
      if (d.confidence < confidenceFloor) return false;
      return true;
    });
  }, [detections, categoryMap, categoryVisibility, confidenceFloor]);

  // Summary counts
  const summary = useMemo(() => {
    let strong = 0;
    let likely = 0;
    let possible = 0;
    for (const d of visibleDetections) {
      if (d.confidenceTier === "strong") strong++;
      else if (d.confidenceTier === "likely") likely++;
      else if (d.confidenceTier === "possible") possible++;
    }
    return { total: visibleDetections.length, strong, likely, possible };
  }, [visibleDetections]);

  const annotatedElements = useMemo(
    () => buildAnnotatedText(text, visibleDetections),
    [text, visibleDetections],
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 24px",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <SummaryBar summary={summary} />
        <button
          onClick={onReset}
          style={{
            background: "transparent",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: "#d0d0d0",
            fontSize: 12,
            padding: "4px 14px",
            cursor: "pointer",
          }}
        >
          New Analysis
        </button>
      </div>

      {/* Metadata line */}
      <div
        style={{
          padding: "6px 24px",
          borderBottom: "1px solid #1a1a1a",
          color: "#444",
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        Analysed {wordCount.toLocaleString()} words | {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
      </div>

      {/* Annotated text */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
          fontSize: 14,
          lineHeight: 1.8,
          color: "#d0d0d0",
        }}
      >
        {annotatedElements}
      </div>
    </div>
  );
}

// ─── Summary Bar ───

function SummaryBar({
  summary,
}: {
  summary: { total: number; strong: number; likely: number; possible: number };
}) {
  if (summary.total === 0) {
    return (
      <span style={{ color: "#666", fontSize: 12 }}>
        No patterns detected in this text.
      </span>
    );
  }

  const parts: string[] = [];
  if (summary.strong > 0) parts.push(`${summary.strong} strong`);
  if (summary.likely > 0) parts.push(`${summary.likely} likely`);
  if (summary.possible > 0) parts.push(`${summary.possible} possible`);

  return (
    <span style={{ color: "#888", fontSize: 12 }}>
      {summary.total} pattern{summary.total !== 1 ? "s" : ""} detected
      {parts.length > 0 && <> — {parts.join(", ")}</>}
    </span>
  );
}

// ─── Annotation Rendering ───

function resolveOverlaps(
  sorted: DetectionInstance[],
): DetectionInstance[] {
  const result: DetectionInstance[] = [];
  for (const det of sorted) {
    const last = result[result.length - 1];
    if (last && det.phrasePosition.start < last.phrasePosition.end) {
      // Overlap — keep higher confidence
      if (det.confidence > last.confidence) {
        result[result.length - 1] = det;
      }
    } else {
      result.push(det);
    }
  }
  return result;
}

function buildAnnotatedText(
  text: string,
  detections: DetectionInstance[],
): ReactNode[] {
  if (detections.length === 0) {
    return renderPlainText(text);
  }

  const sorted = [...detections].sort(
    (a, b) => a.phrasePosition.start - b.phrasePosition.start,
  );
  const nonOverlapping = resolveOverlaps(sorted);

  const elements: ReactNode[] = [];
  let cursor = 0;

  for (const detection of nonOverlapping) {
    const { start, end } = detection.phrasePosition;

    // Plain text before this detection
    if (cursor < start) {
      elements.push(
        ...renderPlainText(text.slice(cursor, start), `text-${cursor}`),
      );
    }

    // The annotated phrase
    elements.push(
      <AnnotationMark
        key={`det-${detection.id}`}
        detection={detection}
        text={text.slice(start, end)}
      />,
    );

    cursor = end;
  }

  // Remaining text after last detection
  if (cursor < text.length) {
    elements.push(
      ...renderPlainText(text.slice(cursor), `text-${cursor}`),
    );
  }

  return elements;
}

/** Render plain text with line breaks preserved as <br /> elements. */
function renderPlainText(text: string, keyPrefix = "t"): ReactNode[] {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      elements.push(<br key={`${keyPrefix}-br-${i}`} />);
    }
    if (lines[i]!.length > 0) {
      elements.push(
        <span key={`${keyPrefix}-${i}`}>{lines[i]}</span>,
      );
    }
  }
  return elements;
}
