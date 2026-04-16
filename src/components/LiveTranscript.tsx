import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore, type CapturedSegment, type ModelDownloadProgress } from "../stores/session-store";
import { api, type CapturePreset } from "../bridge";
import type { DetectionInstance } from "@fides/pattern-library";
import { AnnotationMark } from "./AnnotationMark";

// ─── Pattern annotation helpers ───

const TIER_COLORS: Record<string, string> = { possible: "#c4a24e", likely: "#d4822e", strong: "#c44e4e" };

function renderAnnotatedLive(text: string, dets: DetectionInstance[]): React.ReactNode[] {
  const sorted = [...dets].sort((a, b) => a.phrasePosition.start - b.phrasePosition.start);
  const resolved: DetectionInstance[] = [];
  for (const d of sorted) {
    const last = resolved[resolved.length - 1];
    if (last && d.phrasePosition.start < last.phrasePosition.end) {
      if (d.confidence > last.confidence) resolved[resolved.length - 1] = d;
    } else resolved.push(d);
  }
  const els: React.ReactNode[] = [];
  let cursor = 0;
  for (const d of resolved) {
    const { start, end } = d.phrasePosition;
    if (start > text.length || end > text.length) continue;
    if (cursor < start) els.push(<span key={`t-${cursor}`}>{text.slice(cursor, start)}</span>);
    els.push(<AnnotationMark key={`d-${d.id}`} detection={d} text={text.slice(start, end)} />);
    cursor = end;
  }
  if (cursor < text.length) els.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>);
  return els;
}

// ─── Tooltip helpers ───

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

const CLIP_WINDOWS = [
  { label: "Last 1 min", ms: 60_000 },
  { label: "Last 2 min", ms: 120_000 },
  { label: "Last 5 min", ms: 300_000 },
  { label: "Last 10 min", ms: 600_000 },
  { label: "Everything", ms: 0 },
] as const;

// These are now read from settings; defaults used as fallback
const DEFAULT_COLLAPSE_THRESHOLD = 500;
const PARTIAL_MULTIPLIER = 5; // partial shows 5x the collapse threshold

type ExpandState = "collapsed" | "partial" | "full";
type AudioSourceType = "microphone" | "loopback" | "both";

interface ModelStatusResult {
  downloaded: boolean;
  path: string;
  size_mb: number;
}

// ─── Relative time formatting ───

function timeAgo(ms: number, now: number): string {
  const seconds = Math.floor((now - ms) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function exactTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTimestamp(
  ms: number,
  now: number,
  format: "exact" | "relative" | "both",
): string {
  if (format === "exact") return exactTime(ms);
  if (format === "relative") return timeAgo(ms, now);
  return `${exactTime(ms)} (${timeAgo(ms, now)})`;
}

function gapLabel(gapMs: number): string | null {
  const minutes = Math.floor(gapMs / 60_000);
  if (minutes < 2) return null;
  if (minutes < 60) return `${minutes} min gap`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h gap`;
}

// ─── Paragraph reconstruction ───

const PARA_GAP_MS = 30_000; // 30 seconds
const PARA_MAX_WORDS = 400;

function endsSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1]!;
  return last === "." || last === "?" || last === "!";
}

interface MergedParagraph {
  text: string;
  source: string;
  timestamp: number; // capturedAt of first segment
  wordCount: number;
  speaker?: string;
}

/**
 * Merge consecutive segments from the same source into coherent paragraphs.
 * Breaks on: source change, >30s gap, >400 words, or sentence boundary + next starts new thought.
 */
function mergeSegmentsIntoParagraphs(
  segments: ReadonlyArray<{ text: string; source: string; capturedAt: number; speaker?: string }>,
): MergedParagraph[] {
  if (segments.length === 0) return [];

  const paragraphs: MergedParagraph[] = [];
  let currentText = "";
  let currentSource = "";
  let currentSpeaker: string | undefined;
  let currentTimestamp = 0;
  let currentWords = 0;

  const flush = () => {
    const trimmed = currentText.trim();
    if (trimmed.length > 0) {
      paragraphs.push({
        text: trimmed,
        source: currentSource,
        timestamp: currentTimestamp,
        wordCount: currentWords,
        ...(currentSpeaker ? { speaker: currentSpeaker } : {}),
      });
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segWords = seg.text.trim().split(/\s+/).filter(Boolean).length;

    if (i === 0) {
      currentText = seg.text.trim();
      currentSource = seg.source;
      currentSpeaker = seg.speaker;
      currentTimestamp = seg.capturedAt;
      currentWords = segWords;
      continue;
    }

    const prev = segments[i - 1]!;
    const gap = seg.capturedAt - prev.capturedAt;
    const sourceChanged = seg.source !== currentSource;
    const speakerChanged = seg.speaker !== currentSpeaker;
    const gapTooLong = gap > PARA_GAP_MS;
    const tooManyWords = currentWords + segWords > PARA_MAX_WORDS;
    const prevEndsSentence = endsSentence(currentText);

    // Must break on source change, speaker change, or long gap
    if (sourceChanged || speakerChanged || gapTooLong) {
      flush();
      currentText = seg.text.trim();
      currentSource = seg.source;
      currentSpeaker = seg.speaker;
      currentTimestamp = seg.capturedAt;
      currentWords = segWords;
      continue;
    }

    // Break if too many words AND previous ends a sentence
    if (tooManyWords && prevEndsSentence) {
      flush();
      currentText = seg.text.trim();
      currentSource = seg.source;
      currentSpeaker = seg.speaker;
      currentTimestamp = seg.capturedAt;
      currentWords = segWords;
      continue;
    }

    // Otherwise merge: use space if mid-sentence, double-newline if sentence ended + enough words
    if (prevEndsSentence && currentWords > 100) {
      currentText += "\n\n" + seg.text.trim();
    } else {
      currentText += " " + seg.text.trim();
    }
    currentWords += segWords;
  }

  flush();
  return paragraphs;
}

interface ClipResult {
  text: string;
  sources: string[];
  startTime: number;
  endTime: number;
}

/**
 * Reconstruct paragraphs from segments within a time window for Clip & Analyse.
 * Returns the merged text plus metadata about sources and time range.
 */
function reconstructClip(
  segments: ReadonlyArray<{ text: string; source: string; capturedAt: number }>,
  windowMs: number,
): ClipResult {
  let filtered: typeof segments;
  if (windowMs <= 0) {
    filtered = segments;
  } else {
    const cutoff = Date.now() - windowMs;
    filtered = segments.filter((s) => s.capturedAt >= cutoff);
  }
  const paragraphs = mergeSegmentsIntoParagraphs(filtered);

  // Collect unique sources in order
  const seenSources = new Set<string>();
  const sources: string[] = [];
  for (const p of paragraphs) {
    if (p.source && !seenSources.has(p.source)) {
      seenSources.add(p.source);
      sources.push(p.source);
    }
  }

  const startTime = filtered.length > 0 ? filtered[0]!.capturedAt : Date.now();
  const endTime = filtered.length > 0 ? filtered[filtered.length - 1]!.capturedAt : Date.now();

  return {
    text: paragraphs.map((p) => p.text).join("\n\n"),
    sources,
    startTime,
    endTime,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── Paragraph card with visual compression ───

function ParagraphCard({
  para,
  now,
  collapseThreshold,
  timestampFormat,
  hideTimestamp,
  paraDetections,
}: {
  para: MergedParagraph;
  now: number;
  collapseThreshold: number;
  timestampFormat: "exact" | "relative" | "both";
  hideTimestamp?: boolean;
  paraDetections?: import("@fides/pattern-library").DetectionInstance[];
}) {
  const partialThreshold = collapseThreshold * PARTIAL_MULTIPLIER;
  const [expand, setExpand] = useState<ExpandState>(
    para.text.length > collapseThreshold ? "collapsed" : "full",
  );

  const displayText = useMemo(() => {
    if (expand === "full") return para.text;
    if (expand === "partial") return para.text.slice(0, partialThreshold);
    return para.text.slice(0, collapseThreshold);
  }, [para.text, expand, collapseThreshold, partialThreshold]);

  const remaining =
    expand === "collapsed"
      ? para.text.length - collapseThreshold
      : expand === "partial"
        ? para.text.length - partialThreshold
        : 0;

  const showFade = expand !== "full" && para.text.length > collapseThreshold;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Speaker label (when diarization active) */}
      {para.speaker && (
        <div style={{ color: "#6a8ab0", fontSize: 12, fontWeight: 500, marginBottom: 2 }}>
          {para.speaker}
        </div>
      )}

      {/* Word count + optional timestamp (hidden when source-divider already shows it) */}
      <div
        style={{
          color: "#444",
          fontSize: 11,
          marginBottom: 3,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: "#3a3a3a" }}>
          {para.wordCount} word{para.wordCount !== 1 ? "s" : ""}
        </span>
        {!hideTimestamp && (
          <span>{formatTimestamp(para.timestamp, now, timestampFormat)}</span>
        )}
      </div>

      {/* Text body with optional fade + pattern annotations */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            color: "#d0d0d0",
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {paraDetections && paraDetections.length > 0 && expand === "full"
            ? renderAnnotatedLive(displayText, paraDetections)
            : displayText}
        </div>
        {showFade && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 40,
              background:
                "linear-gradient(transparent, #0a0a0a)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* Expand/collapse controls */}
      {para.text.length > collapseThreshold && (
        <div style={{ marginTop: 4 }}>
          {expand === "collapsed" && (
            <button
              onClick={() =>
                setExpand(
                  para.text.length > partialThreshold ? "partial" : "full",
                )
              }
              style={expandBtnStyle}
            >
              Show {remaining.toLocaleString()} more &darr;
            </button>
          )}
          {expand === "partial" && (
            <button onClick={() => setExpand("full")} style={expandBtnStyle}>
              Show all ({para.text.length.toLocaleString()} chars) &darr;
            </button>
          )}
          {expand === "full" && (
            <button
              onClick={() => setExpand("collapsed")}
              style={expandBtnStyle}
            >
              Collapse &uarr;
            </button>
          )}
        </div>
      )}

      {/* Pattern tags row */}
      {paraDetections && paraDetections.length > 0 && (
        <>
          <div style={{ borderTop: "1px solid #1a1a1e", margin: "8px 0 6px" }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {paraDetections.map(det => {
              const c = TIER_COLORS[det.confidenceTier] ?? "#888";
              return (
                <span key={`tag-${det.id}`} style={{
                  fontSize: 10, padding: "2px 8px", background: `${c}18`,
                  border: `1px solid ${c}44`, borderRadius: 3, color: c,
                  letterSpacing: "0.04em",
                }}>
                  {det.patternId.replace(/-/g, " ")} · {Math.round(det.confidence * 100)}%
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const expandBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#666",
  fontSize: 11,
  padding: "2px 0",
  cursor: "pointer",
};

// ─── Model download progress bar ───

function ModelDownloadBar({ progress }: { progress: ModelDownloadProgress }) {
  const pct = progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0;
  return (
    <div style={{ padding: "16px 24px" }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
        Downloading Whisper Large v3 model... {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
      </div>
      <div
        style={{
          height: 4,
          background: "#1a1a1a",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "#555",
            borderRadius: 2,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

// ─── Capture mode toggle ───

type CaptureMode = "capture" | "live" | "deep";

function ModeSelector({
  selected,
  onChange,
  onTipEnter,
  onTipLeave,
}: {
  selected: CaptureMode;
  onChange: (m: CaptureMode) => void;
  onTipEnter: (e: React.MouseEvent, text: string) => void;
  onTipLeave: () => void;
}) {
  const options: Array<{ key: CaptureMode; label: string; tip: string }> = [
    { key: "deep", label: "Deep", tip: "Transcription + AI speaker attribution. Most accurate, ~60s chunks." },
    { key: "live", label: "Speakers", tip: "Transcription + audio-based speaker detection. Slight delay." },
    { key: "capture", label: "Transcribe", tip: "Transcription only. Fastest output, no speaker detection." },
  ];

  return (
    <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden" }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          onMouseEnter={(e) => onTipEnter(e, opt.tip)}
          onMouseLeave={onTipLeave}
          style={{
            background: selected === opt.key ? "#2a2a2a" : "transparent",
            border: "1px solid #2a2a2a",
            borderRight: "none",
            color: selected === opt.key ? "#d0d0d0" : "#666",
            fontSize: 11,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
      <div style={{ borderRight: "1px solid #2a2a2a" }} />
    </div>
  );
}

// ─── Audio source toggle ───

function SourceToggle({
  selected,
  onChange,
  onTipEnter,
  onTipLeave,
}: {
  selected: AudioSourceType;
  onChange: (s: AudioSourceType) => void;
  onTipEnter: (e: React.MouseEvent, text: string) => void;
  onTipLeave: () => void;
}) {
  const options: Array<{ key: AudioSourceType; label: string; tip: string }> = [
    { key: "loopback", label: "Incoming", tip: "Capture audio playing through your speakers." },
    { key: "microphone", label: "Outgoing", tip: "Capture audio from your microphone." },
    { key: "both", label: "Both", tip: "Capture both speakers and microphone simultaneously." },
  ];

  return (
    <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden" }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          onMouseEnter={(e) => onTipEnter(e, opt.tip)}
          onMouseLeave={onTipLeave}
          style={{
            background: selected === opt.key ? "#2a2a2a" : "transparent",
            border: "1px solid #2a2a2a",
            borderRight: "none",
            color: selected === opt.key ? "#d0d0d0" : "#666",
            fontSize: 11,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
      <div style={{ borderRight: "1px solid #2a2a2a" }} />
    </div>
  );
}

// ─── Main component ───

export function LiveTranscript() {
  const segments = useSessionStore((s) => s.capturedText);
  const detections = useSessionStore((s) => s.detections);
  const captureStatus = useSessionStore((s) => s.captureStatus);
  const analyzeClip = useSessionStore((s) => s.analyzeClip);
  const getClipWindow = useSessionStore((s) => s.getClipWindow);
  const modelDownloadProgress = useSessionStore((s) => s.modelDownloadProgress);
  const isAudioCapturing = useSessionStore((s) => s.isAudioCapturing);
  const audioError = useSessionStore((s) => s.audioError);
  const settings = useSessionStore((s) => s.settings);
  const updateSetting = useSessionStore((s) => s.updateSetting);
  const captureMode = useSessionStore((s) => s.captureMode);
  const autoAnalyse = useSessionStore((s) => s.autoAnalyse);
  const deepAnalyzing = useSessionStore((s) => s.deepAnalyzing);
  const deepTimerSeconds = useSessionStore((s) => s.deepTimerSeconds);
  const deepAccumulationStart = useSessionStore((s) => s.deepAccumulationStart);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [showClipDropdown, setShowClipDropdown] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTip = useCallback((e: React.MouseEvent, text: string) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    const mx = e.clientX;
    const my = e.clientY;
    tipTimer.current = setTimeout(() => {
      setTip({ text, x: mx, y: my });
    }, 1000);
  }, []);

  const hideTip = useCallback(() => {
    if (tipTimer.current) { clearTimeout(tipTimer.current); tipTimer.current = null; }
    setTip(null);
  }, []);

  // Read display settings
  const collapseThreshold = settings.segmentCompressionThreshold ?? DEFAULT_COLLAPSE_THRESHOLD;
  const timestampFormat = settings.timestampFormat ?? "exact";
  const showSourceLabels = settings.showSourceLabels ?? true;

  // Audio state — synced from settings
  const [audioSource, setAudioSource] = useState<AudioSourceType>(settings.audioSource ?? "loopback");
  const [modelStatus, setModelStatus] = useState<ModelStatusResult | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lastClipMeta, setLastClipMeta] = useState<{ sources: string[]; startTime: number; endTime: number } | null>(null);

  // Sync audio source from settings (if changed via Settings tab)
  useEffect(() => {
    if (settings.audioSource && settings.audioSource !== audioSource) {
      setAudioSource(settings.audioSource);
    }
  }, [settings.audioSource]);

  // Sync audio capture status from backend on mount
  useEffect(() => {
    invoke<boolean>("get_audio_capture_status")
      .then((running) => {
        useSessionStore.getState().setAudioCapturing(running);
      })
      .catch(() => {});
  }, []);

  // Update relative timestamps every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll to bottom on new segments
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [segments.length]);

  // Check model status on mount
  useEffect(() => {
    invoke<ModelStatusResult>("get_model_status")
      .then(setModelStatus)
      .catch((err) => console.error("[LIVE] Failed to get model status:", err));
  }, []);

  // Handle model download
  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    useSessionStore.getState().setAudioError(null);
    try {
      await invoke<string>("download_model");
      // Refresh status
      const status = await invoke<ModelStatusResult>("get_model_status");
      setModelStatus(status);
    } catch (err) {
      useSessionStore.getState().setAudioError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsDownloading(false);
      useSessionStore.getState().setModelDownloadProgress(null);
    }
  }, []);

  // Start/stop audio capture
  const toggleAudioCapture = useCallback(async () => {
    const store = useSessionStore.getState();
    if (store.isAudioCapturing) {
      try {
        await invoke("stop_audio_capture");
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
      }
      store.setAudioCapturing(false);
      // Flush partial deep buffer in background — don't block the UI
      if (captureMode === "deep") {
        const current = useSessionStore.getState();
        if (current.deepBuffer.length > 0 && !current.deepAnalyzing) {
          current.flushDeepBuffer().catch(() => { /* flushDeepBuffer has its own fallback */ });
        }
      }
    } else {
      // Warn if there's an unsaved session with content
      if (store.capturedText.length > 0) {
        const proceed = window.confirm(
          "You have an unsaved capture session. Starting a new capture will discard it.\n\nContinue?"
        );
        if (!proceed) return;
        store.clearSession();
      }
      store.setAudioError(null);
      try {
        await invoke("start_audio_capture", { source: audioSource, mode: captureMode });
        store.setAudioCapturing(true);
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [audioSource, captureMode]);

  // Switch audio source — auto-restart if currently capturing
  const handleSourceChange = useCallback(async (newSource: AudioSourceType) => {
    setAudioSource(newSource);
    updateSetting("audioSource", newSource);
    const store = useSessionStore.getState();
    if (store.isAudioCapturing) {
      store.setAudioError(null);
      try {
        // start_audio_capture stops the old capture automatically
        await invoke("start_audio_capture", { source: newSource, mode: captureMode });
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
        store.setAudioCapturing(false);
      }
    }
  }, [updateSetting]);

  // Deep mode 1-second timer
  useEffect(() => {
    if (captureMode !== "deep" || !isAudioCapturing) return;
    const interval = setInterval(() => {
      const store = useSessionStore.getState();
      if (store.deepAccumulationStart) {
        const elapsed = Math.floor((Date.now() - store.deepAccumulationStart) / 1000);
        store.setDeepTimerSeconds(elapsed);
        if (elapsed >= 60 && !store.deepAnalyzing) {
          store.flushDeepBuffer();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [captureMode, isAudioCapturing]);

  // Auto-analyse — triggers when a new paragraph is completed
  const liveParagraphs = useMemo(() => mergeSegmentsIntoParagraphs(segments), [segments]);
  const liveParagraphCount = liveParagraphs.length;
  const prevLiveParagraphCount = useRef(0);
  useEffect(() => {
    if (!autoAnalyse || !isAudioCapturing) {
      prevLiveParagraphCount.current = liveParagraphCount;
      return;
    }
    if (liveParagraphCount <= prevLiveParagraphCount.current) {
      prevLiveParagraphCount.current = liveParagraphCount;
      return;
    }
    prevLiveParagraphCount.current = liveParagraphCount;

    const timer = setTimeout(() => {
      const store = useSessionStore.getState();
      if (store.autoAnalyseRunning) return;
      if (store.capturedText.length === 0) return;
      const textLen = store.capturedText.reduce((a, s) => a + s.text.length, 0);
      if (textLen <= store.lastAutoAnalysedLength) return;

      // Respect configured cooldown interval (default 5 min)
      const cooldownMs = (store.settings.autoAnalyseIntervalMinutes ?? 5) * 60_000;
      if (store.lastAutoAnalyseAt > 0 && Date.now() - store.lastAutoAnalyseAt < cooldownMs) return;

      const text = store.capturedText.map((s) => s.text).join(" ");
      if (text.trim().length === 0) return;

      // Fire-and-forget — transcript rendering is never blocked
      useSessionStore.setState({ autoAnalyseRunning: true });
      store.analyzeLive(text).then(() => {
        useSessionStore.setState({
          autoAnalyseRunning: false,
          lastAutoAnalyseAt: Date.now(),
          lastAutoAnalysedLength: textLen,
        });
      }).catch(() => {
        useSessionStore.setState({ autoAnalyseRunning: false });
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [autoAnalyse, isAudioCapturing, liveParagraphCount]);

  // Mode switch handler
  const handleModeChange = useCallback(async (newMode: CaptureMode) => {
    useSessionStore.getState().setCaptureMode(newMode);
    updateSetting("captureMode", newMode);
    // Restart capture with new mode if currently running
    const store = useSessionStore.getState();
    if (store.isAudioCapturing) {
      store.setAudioError(null);
      try {
        await invoke("start_audio_capture", { source: audioSource, mode: newMode });
      } catch (err) {
        store.setAudioError(err instanceof Error ? err.message : String(err));
        store.setAudioCapturing(false);
      }
    }
  }, [audioSource, updateSetting]);

  // Apply preset
  const applyPreset = useCallback((presetId: string) => {
    const preset = (settings.presets ?? []).find((p: CapturePreset) => p.id === presetId);
    if (!preset) return;
    const store = useSessionStore.getState();
    store.setCaptureMode(preset.captureMode);
    store.setAutoAnalyse(preset.autoAnalyse);
    updateSetting("captureMode", preset.captureMode);
    updateSetting("autoAnalyse", preset.autoAnalyse);
    updateSetting("autoAnalyseIntervalMinutes", preset.autoAnalyseIntervalMinutes);
    updateSetting("chunkSizeSeconds", preset.chunkSizeSeconds);
    updateSetting("confidenceFloor", preset.confidenceFloor);
    updateSetting("audioSource", preset.audioSource);
    updateSetting("dedupSensitivity", preset.dedupSensitivity);
    setAudioSource(preset.audioSource);
    // Restart capture with new settings if running
    if (store.isAudioCapturing) {
      invoke("start_audio_capture", { source: preset.audioSource, mode: preset.captureMode }).catch(() => {});
    }
  }, [settings.presets, updateSetting]);

  // Reset transcript (keep capture running)
  const handleReset = useCallback(async () => {
    const store = useSessionStore.getState();
    // Flush partial deep buffer in background before resetting visible text
    if (store.deepBuffer.length > 0 && !store.deepAnalyzing) {
      store.flushDeepBuffer().catch(() => {});
    }
    useSessionStore.setState({
      capturedText: [],
      detections: [],
    });
    setShowResetConfirm(false);
  }, []);

  // New session (stop capture, save, clear)
  const handleNewSession = useCallback(async () => {
    setShowNewSessionConfirm(false);
    const store = useSessionStore.getState();
    if (store.isAudioCapturing) {
      try { await invoke("stop_audio_capture"); } catch {}
      store.setAudioCapturing(false);
    }
    // Flush partial deep buffer — raw segments land in capturedText immediately
    if (store.deepBuffer.length > 0 && !store.deepAnalyzing) {
      store.flushDeepBuffer().catch(() => {});
    }
    // Re-read state after flush pushed raw segments
    const current = useSessionStore.getState();
    // Save current session if there's content
    if (current.capturedText.length > 0) {
      let sessionId = current.currentSessionId;
      if (!sessionId) {
        sessionId = `live-${Date.now()}`;
        useSessionStore.setState({ currentSessionId: sessionId });
      }
      const text = current.capturedText.map((s) => s.text).join(" ");
      api.saveSession({
        id: sessionId,
        text,
        detections: current.detections,
        createdAt: new Date().toISOString(),
        segments: current.capturedText,
        sources: [...new Set(current.capturedText.map((s) => s.source))],
        wordCount: text.trim().split(/\s+/).filter(Boolean).length,
        hasAudio: !!current.audioSessionId,
        hasMicAudio: !!current.audioSessionId && (current.settings.audioSource === "microphone" || current.settings.audioSource === "both"),
        hasSystemAudio: !!current.audioSessionId && (current.settings.audioSource === "loopback" || current.settings.audioSource === "both"),
        ...(current.audioSessionId ? { audioSessionId: current.audioSessionId } : {}),
        checkIns: current.checkIns.filter((c) =>
          c.sessionId === sessionId || c.sessionId === current.audioSessionId
        ),
      }).catch(() => {});
    }
    store.clearSession();
    useSessionStore.setState({
      deepBuffer: [],
      deepAccumulationStart: null,
      deepAnalyzing: false,
      deepTimerSeconds: 0,
    });
  }, []);

  const handleClip = (windowMs: number) => {
    setShowClipDropdown(false);
    const clip = reconstructClip(segments, windowMs);
    if (clip.text.trim().length > 0) {
      setLastClipMeta({
        sources: clip.sources,
        startTime: clip.startTime,
        endTime: clip.endTime,
      });
      analyzeClip(clip.text);
    }
  };

  // Build rendered items: merge segments into paragraphs, add gap markers + source dividers
  const renderedItems = useMemo(() => {
    const paragraphs = mergeSegmentsIntoParagraphs(segments);

    const items: Array<
      | { type: "gap"; label: string; key: string }
      | { type: "source-divider"; source: string; timestamp: number; key: string }
      | { type: "paragraph"; para: MergedParagraph; afterDivider: boolean; key: string }
    > = [];

    let lastSource: string | null = null;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i]!;

      // Insert gap marker if > 2 min gap from previous paragraph
      if (i > 0) {
        const prev = paragraphs[i - 1]!;
        const gap = para.timestamp - prev.timestamp;
        const label = gapLabel(gap);
        if (label) {
          items.push({ type: "gap", label, key: `gap-${i}` });
        }
      }

      // Insert source divider when source changes
      let insertedDivider = false;
      if (showSourceLabels && para.source && para.source !== lastSource) {
        items.push({
          type: "source-divider",
          source: para.source,
          timestamp: para.timestamp,
          key: `src-${i}`,
        });
        lastSource = para.source;
        insertedDivider = true;
      }

      items.push({ type: "paragraph", para, afterDivider: insertedDivider, key: `para-${para.timestamp}-${i}` });
    }

    return items;
  }, [segments, showSourceLabels]);

  const hasText = segments.length > 0;
  const modelReady = modelStatus?.downloaded === true;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Floating tooltip — spawns at mouse after 1s, flips at edges */}
      {tip && (() => {
        const pad = 12;
        const flipX = tip.x > window.innerWidth * 0.65;
        const flipY = tip.y > window.innerHeight - 60;
        const s: React.CSSProperties = {
          position: "fixed",
          background: "#1a1a1a",
          border: "1px solid #333",
          color: "#aaa",
          fontSize: 12,
          lineHeight: 1.4,
          padding: "4px 8px",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 9999,
          whiteSpace: "nowrap",
        };
        if (flipX) { s.right = window.innerWidth - tip.x + pad; } else { s.left = tip.x + pad; }
        if (flipY) { s.bottom = window.innerHeight - tip.y + pad; } else { s.top = tip.y + pad; }
        return <div style={s}>{tip.text}</div>;
      })()}

      {/* Toolbar Row 1: Mode, Source, Start/Stop, Status */}
      <div style={{ padding: "4px 24px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ModeSelector selected={captureMode} onChange={handleModeChange} onTipEnter={showTip} onTipLeave={hideTip} />
          <SourceToggle selected={audioSource} onChange={handleSourceChange} onTipEnter={showTip} onTipLeave={hideTip} />
          {modelReady && (
            <button
              onClick={toggleAudioCapture}
              onMouseEnter={(e) => showTip(e, "Start or stop audio capture.")}
              onMouseLeave={hideTip}
              style={{ background: isAudioCapturing ? "#3a1a1a" : "transparent", border: `1px solid ${isAudioCapturing ? "#5a2a2a" : "#2a2a2a"}`, borderRadius: 4, color: isAudioCapturing ? "#e55" : "#888", fontSize: 11, padding: "4px 12px", cursor: "pointer" }}
            >
              {isAudioCapturing ? "Stop" : "Start"}
            </button>
          )}
          {isAudioCapturing && (
            <span style={{ color: "#666", fontSize: 11 }}>
              <span style={{ color: "#c44", marginRight: 4 }}>&#9679;</span>
              {segments.length === 0 ? "Listening..." : `${segments.length} seg`}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar Row 2: Preset, Reset, New Session, Auto-Analyse, Clip */}
      <div style={{ padding: "4px 24px", borderBottom: "1px solid #1a1a1a", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Preset dropdown */}
          <select
            style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, color: "#888", fontSize: 11, padding: "3px 8px", outline: "none" }}
            value=""
            onChange={(e) => { if (e.target.value) { applyPreset(e.target.value); e.target.value = ""; } }}
            onMouseEnter={(e) => showTip(e, "Load a saved configuration of capture settings.")}
            onMouseLeave={hideTip}
          >
            <option value="">Preset...</option>
            {(settings.presets ?? []).map((p: CapturePreset) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Reset */}
          {showResetConfirm ? (
            <span style={{ fontSize: 11, color: "#888", display: "flex", alignItems: "center", gap: 4 }}>
              Clear transcript?
              <button onClick={handleReset} style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#d0d0d0", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>Clear</button>
              <button onClick={() => setShowResetConfirm(false)} style={{ background: "transparent", border: "none", color: "#555", fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </span>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              onMouseEnter={(e) => showTip(e, "Clear the current transcript display. Capture continues.")}
              onMouseLeave={hideTip}
              style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#666", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              Reset
            </button>
          )}

          {/* New Session */}
          {showNewSessionConfirm ? (
            <span style={{ fontSize: 11, color: "#888", display: "flex", alignItems: "center", gap: 4 }}>
              Save &amp; start fresh?
              <button onClick={handleNewSession} style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#d0d0d0", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>Save</button>
              <button onClick={() => setShowNewSessionConfirm(false)} style={{ background: "transparent", border: "none", color: "#555", fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </span>
          ) : (
            <button
              onClick={() => setShowNewSessionConfirm(true)}
              onMouseEnter={(e) => showTip(e, "Save this session and start a fresh one.")}
              onMouseLeave={hideTip}
              style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#666", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              New
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Auto-Analyse checkbox */}
          <label
            style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
            onMouseEnter={(e) => showTip(e, "Automatically detect rhetorical patterns in each paragraph as it arrives.")}
            onMouseLeave={hideTip}
          >
            <input type="checkbox" checked={autoAnalyse} onChange={(e) => { useSessionStore.getState().setAutoAnalyse(e.target.checked); updateSetting("autoAnalyse", e.target.checked); }} style={{ accentColor: "#666" }} />
            <span style={{ color: "#888", fontSize: 11 }}>Auto-Analyse</span>
          </label>

          {/* Clip & Analyse */}
          {hasText && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowClipDropdown(!showClipDropdown)}
                onMouseEnter={(e) => showTip(e, "Send the current transcript for rhetorical pattern analysis.")}
                onMouseLeave={hideTip}
                style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#d0d0d0", fontSize: 12, padding: "4px 14px", cursor: "pointer" }}
              >
                Clip &amp; Analyse
              </button>
              {showClipDropdown && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#111", border: "1px solid #2a2a2a", borderRadius: 4, overflow: "hidden", zIndex: 10, minWidth: 140 }}>
                  {CLIP_WINDOWS.map((w) => (
                    <button key={w.label} onClick={() => handleClip(w.ms)} style={{ display: "block", width: "100%", background: "transparent", border: "none", color: "#d0d0d0", fontSize: 12, padding: "8px 14px", cursor: "pointer", textAlign: "left" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      {w.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Model download status */}
      {!modelReady && !isDownloading && (
        <div style={{ padding: "24px", textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
            Whisper Large v3 model required for audio transcription
          </div>
          <div style={{ color: "#555", fontSize: 11, marginBottom: 16 }}>
            ~3.1 GB download, runs locally on your GPU
          </div>
          <button
            onClick={handleDownload}
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#d0d0d0",
              fontSize: 12,
              padding: "8px 20px",
              cursor: "pointer",
            }}
          >
            Download Model
          </button>
        </div>
      )}

      {/* Download progress */}
      {isDownloading && modelDownloadProgress && (
        <ModelDownloadBar progress={modelDownloadProgress} />
      )}
      {isDownloading && !modelDownloadProgress && (
        <div style={{ padding: "16px 24px", color: "#888", fontSize: 12 }}>
          Starting download...
        </div>
      )}

      {/* Error display */}
      {audioError && (
        <div style={{ padding: "8px 24px", color: "#c44", fontSize: 11 }}>
          {audioError}
        </div>
      )}

      {/* Model ready indicator */}
      {modelReady && !isAudioCapturing && segments.length === 0 && (
        <div style={{ padding: "24px", color: "#555", fontSize: 13, textAlign: "center" }}>
          Model ready. Select a source and click Start.
        </div>
      )}

      {/* Deep mode accumulation indicator */}
      {captureMode === "deep" && isAudioCapturing && deepAccumulationStart && !deepAnalyzing && (
        <div style={{ padding: "16px 24px", flexShrink: 0 }}>
          <div style={{ color: "#666", fontSize: 12, marginBottom: 6 }}>
            Recording... {deepTimerSeconds}s / 60s
          </div>
          <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (deepTimerSeconds / 60) * 100)}%`, background: "#333", borderRadius: 2, transition: "width 0.5s linear" }} />
          </div>
        </div>
      )}

      {/* Deep mode analyzing indicator */}
      {captureMode === "deep" && deepAnalyzing && (
        <div style={{ padding: "16px 24px", flexShrink: 0 }}>
          <span style={{ color: "#666", fontSize: 12 }}>
            {isAudioCapturing ? "Analysing..." : "updating speaker attribution..."}{" "}
            <span style={{ color: "#c44", animation: "pulse 1.5s infinite" }}>&#9679;</span>
          </span>
          <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
        </div>
      )}

      {/* Clip context banner — shows after Clip & Analyse */}
      {lastClipMeta && (
        <div
          style={{
            padding: "6px 24px",
            borderBottom: "1px solid #1a1a1a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#555", fontSize: 11 }}>
            Clipped: {lastClipMeta.sources.join(", ") || "Unknown"} | {exactTime(lastClipMeta.startTime)} — {exactTime(lastClipMeta.endTime)}
          </span>
          <button
            onClick={() => setLastClipMeta(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#444",
              fontSize: 11,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Transcript body */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
        }}
      >
        {isAudioCapturing && segments.length === 0 ? (
          <div style={{ color: "#555", fontSize: 13 }}>
            Waiting for audio...
          </div>
        ) : (
          renderedItems.map((item) => {
            if (item.type === "gap") {
              return (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    margin: "16px 0",
                  }}
                >
                  <div
                    style={{ flex: 1, height: 1, background: "#1a1a1a" }}
                  />
                  <span
                    style={{
                      color: "#555",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.label}
                  </span>
                  <div
                    style={{ flex: 1, height: 1, background: "#1a1a1a" }}
                  />
                </div>
              );
            }

            if (item.type === "source-divider") {
              return (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    margin: "14px 0 6px",
                  }}
                >
                  <span
                    style={{
                      color: "#666",
                      fontSize: 11,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.source}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
                  <span
                    style={{
                      color: "#444",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatTimestamp(item.timestamp, now, timestampFormat)}
                  </span>
                </div>
              );
            }

            // Compute paragraph detections by matching character offsets
            const allParas = renderedItems.filter(x => x.type === "paragraph").map(x => x.para);
            const paraIdx = allParas.indexOf(item.para);
            let charOff = 0;
            for (let pi = 0; pi < paraIdx; pi++) charOff += allParas[pi]!.text.length + 1;
            const paraEnd = charOff + item.para.text.length;
            const pDets = detections
              .filter(d => d.phrasePosition.start < paraEnd && d.phrasePosition.end > charOff)
              .map(d => ({ ...d, phrasePosition: { start: Math.max(0, d.phrasePosition.start - charOff), end: Math.min(item.para.text.length, d.phrasePosition.end - charOff) } }))
              .filter(d => d.phrasePosition.end > d.phrasePosition.start);

            return (
              <ParagraphCard
                key={item.key}
                para={item.para}
                now={now}
                collapseThreshold={collapseThreshold}
                timestampFormat={timestampFormat}
                hideTimestamp={item.afterDivider}
                paraDetections={pDets}
              />
            );
          })
        )}
      </div>

      {/* Close dropdowns when clicking outside */}
      {showClipDropdown && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9,
          }}
          onClick={() => setShowClipDropdown(false)}
        />
      )}
    </div>
  );
}
