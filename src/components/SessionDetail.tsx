import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api, type SavedSession, type CheckIn, SOURCE_TYPES, SOURCE_TYPE_LABELS } from "../bridge";
import { useSessionStore } from "../stores/session-store";
import type { DetectionInstance } from "@fides/pattern-library";
import { AnnotationMark } from "./AnnotationMark";
import type { SetupState } from "./setup/setupTypes";
import { isModeAvailable, type CaptureMode } from "../lib/modeAvailability";

/**
 * Retranscribe picker uses its own label vocabulary: "transcribe" /
 * "speakers" / "deep" (as displayed). These are not the internal capture
 * mode keys ("capture" / "live" / "deep"), so gating has to translate
 * across vocabularies before calling isModeAvailable.
 */
type RetranscribeMode = "deep" | "speakers" | "transcribe";
function retranscribeToCaptureMode(m: RetranscribeMode): CaptureMode {
  if (m === "speakers") return "live";
  if (m === "transcribe") return "capture";
  return "deep";
}

function speakerColor(speaker: string): string {
  if (speaker === "Mic") return "#4a4a99";
  if (speaker === "Incoming Audio" || speaker === "Incoming") return "#555";
  return "#3a7aaa";
}

function exactTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Segment {
  text: string;
  source: string;
  speaker?: string;
  timestamp?: number;
  capturedAt: number;
  estimated?: boolean;
}

// ─── Auto-expanding textarea ───

function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} style={{
      width: "100%", background: "#0e0e16", border: "1px solid #1a1a28", borderRadius: 5,
      color: "#a0a0a8", fontSize: 13, lineHeight: 1.8, padding: "8px 10px",
      resize: "none", overflow: "hidden", minHeight: 40, outline: "none", fontFamily: "inherit",
    }} />
  );
}

// ─── Inline pattern underlines ───

function AnnotatedText({ text, detections, onNavigateToPattern }: { text: string; detections: DetectionInstance[]; onNavigateToPattern?: ((patternId: string) => void) | undefined }) {
  if (!detections.length) return <span style={{ fontSize: 14, lineHeight: 1.8, color: "#a8a6a0", whiteSpace: "pre-wrap" }}>{text}</span>;

  // Use tier-based colors matching AnnotationMark.tsx
  const tierColors: Record<string, string> = { possible: "#c4a24e", likely: "#d4822e", strong: "#c44e4e" };

  const sorted = [...detections].filter((d) => d.phrasePosition.start >= 0 && d.phrasePosition.end <= text.length)
    .sort((a, b) => a.phrasePosition.start - b.phrasePosition.start);
  const resolved: DetectionInstance[] = [];
  for (const det of sorted) {
    const last = resolved[resolved.length - 1];
    if (last && det.phrasePosition.start < last.phrasePosition.end) {
      if (det.confidence > last.confidence) resolved[resolved.length - 1] = det;
    } else { resolved.push(det); }
  }

  const elements: React.ReactNode[] = [];
  let cursor = 0;
  for (const det of resolved) {
    const { start, end } = det.phrasePosition;
    if (cursor < start) elements.push(<span key={`t-${cursor}`}>{text.slice(cursor, start)}</span>);
    // Use AnnotationMark for clickable underlines → PatternCard (tags shown below text, not inline)
    elements.push(
      <AnnotationMark key={`d-${det.id}`} detection={det} text={text.slice(start, end)} onNavigateToPattern={onNavigateToPattern} />
    );
    cursor = end;
  }
  if (cursor < text.length) elements.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>);
  return <span style={{ fontSize: 14, lineHeight: 1.8, color: "#a8a6a0", whiteSpace: "pre-wrap" }}>{elements}</span>;
}

// ─── Time formatting for scrubber ───

function fmtTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ─── Main component ───

export function SessionDetail({
  sessionId,
  onBack,
  onNavigateToPattern,
  setupState,
  onOpenSetupWizard,
}: {
  sessionId: string;
  onBack: () => void;
  onNavigateToPattern?: ((patternId: string) => void) | undefined;
  /** Guided Setup state for gating retranscribe modes (spec §22.5 2b.1). */
  setupState?: SetupState | null;
  /** Open the Guided Setup wizard, optionally at a specific step (1..=7). */
  onOpenSetupWizard?: (step?: number) => void;
}) {
  const [session, setSession] = useState<SavedSession | null>(null);
  // Re-analyse is blocked while any recording is active — even if the user is
  // viewing an unrelated past session — because analyzeLive mutates the shared
  // live-session detections store. We'd rather refuse than corrupt state.
  const isRecording = useSessionStore((s) => s.isAudioCapturing);
  const [editing, setEditing] = useState(false);
  const [editSegments, setEditSegments] = useState<Segment[]>([]);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});
  const [showOriginal, setShowOriginal] = useState(false);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitFirst, setSplitFirst] = useState("");
  const [splitSecond, setSplitSecond] = useState("");
  const [splitSpeaker, setSplitSpeaker] = useState("Person ?");
  const [editName, setEditName] = useState("");
  const [editColorTag, setEditColorTag] = useState<string | null>(null);
  const [editHashtags, setEditHashtags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [editSourceType, setEditSourceType] = useState<string | undefined>(undefined);

  // Dual-track audio state
  const micAudioRef = useRef<HTMLAudioElement>(null);
  const sysAudioRef = useRef<HTMLAudioElement>(null);
  const [micExists, setMicExists] = useState(false);
  const [sysExists, setSysExists] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [sysMuted, setSysMuted] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);

  useEffect(() => {
    // Reset all edit state when switching sessions
    setEditing(false);
    setEditName("");
    setEditColorTag(null);
    setSplitIndex(null);
    setShowOriginal(false);
    setMicExists(false);
    setSysExists(false);
    setPlaybackTime(0);
    setIsPlaying(false);
    setAudioDuration(0);

    api.loadSession(sessionId).then((s) => {
      setSession(s);
      if (s.segments) setEditSegments(s.segments.map((seg) => ({ ...seg })));
      setSpeakerMap(s.speakerMap ?? {});
      if (s.hasMicAudio) setMicExists(true);
      if (s.hasSystemAudio) setSysExists(true);
      if (s.hasAudio && !s.hasMicAudio && !s.hasSystemAudio) setSysExists(true);
    }).catch(() => {});
  }, [sessionId]);

  const segments: Segment[] = useMemo(() => {
    if (!session) return [];
    if (session.segments) return session.segments.map((s) => ({ ...s } as Segment));
    return [{ text: session.text, source: "Unknown", capturedAt: new Date(session.createdAt).getTime() }];
  }, [session]);

  const wordCount = useMemo(() => segments.reduce((a, s) => a + s.text.trim().split(/\s+/).filter(Boolean).length, 0), [segments]);
  const speakers = useMemo(() => { const set = new Set<string>(); for (const s of segments) if (s.speaker) set.add(s.speaker); return Array.from(set); }, [segments]);

  // Audio offsets for transcript sync
  // Use segment.timestamp (epoch seconds from Rust, when audio chunk was captured)
  // minus the audio recording start time (from audioSessionId "live-{epoch_seconds}")
  const audioOffsets = useMemo(() => {
    if (!segments.length) return [];

    // Extract recording start time from audioSessionId
    let t0Sec = 0;
    if (session?.audioSessionId) {
      const match = session.audioSessionId.match(/(\d+)$/);
      if (match) {
        const epochSec = parseInt(match[1]!, 10);
        if (epochSec > 1000000000) t0Sec = epochSec;
      }
    }

    // Use timestamp (Rust epoch seconds) if available, fall back to capturedAt (JS epoch ms)
    return segments.map((s) => {
      if (s.timestamp && t0Sec) {
        // timestamp is epoch seconds from Rust — subtract audio start
        // timestamp = epoch seconds when this 5s chunk was sent to transcriber
        // The actual speech starts ~4s earlier (beginning of the 5s capture window)
        // timestamp = epoch seconds after Whisper finished processing this 5s chunk
        // Subtract 5s (chunk duration) + ~2s (Whisper processing time) to get chunk start
        return Math.max(0, s.timestamp - t0Sec - 8);
      }
      // Fallback: use capturedAt
      if (t0Sec) return Math.max(0, (s.capturedAt - t0Sec * 1000) / 1000 - 8);
      // Last resort: relative to first segment
      return Math.max(0, (s.capturedAt - segments[0]!.capturedAt) / 1000);
    });
  }, [segments, session?.audioSessionId]);

  const activeSegIndex = useMemo(() => {
    if (!isPlaying || !audioOffsets.length) return -1;
    let idx = -1;
    for (let i = 0; i < audioOffsets.length; i++) {
      if (audioOffsets[i]! <= playbackTime) idx = i; else break;
    }
    return idx;
  }, [isPlaying, playbackTime, audioOffsets]);

  // Auto-scroll
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (activeSegIndex >= 0 && isPlaying) {
      segmentRefs.current.get(activeSegIndex)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSegIndex, isPlaying]);

  // Click-to-seek (seek only — no auto-play)
  const [flashedSeg, setFlashedSeg] = useState(-1);
  const hasAnyAudio = micExists || sysExists;
  const handleSegmentClick = useCallback((index: number) => {
    if (editing) return;
    const offset = audioOffsets[index];
    if (offset === undefined || offset < 0) return;

    const mic = micAudioRef.current;
    const sys = sysAudioRef.current;

    if (mic) mic.pause();
    if (sys) sys.pause();
    if (mic) mic.currentTime = offset;
    if (sys) sys.currentTime = offset;
    setPlaybackTime(offset);

    setTimeout(() => {
      if (mic && micExists) mic.play().catch(() => {});
      if (sys && sysExists) sys.play().catch(() => {});
      setIsPlaying(true);
    }, 150);

    setFlashedSeg(index);
    setTimeout(() => setFlashedSeg(-1), 600);
  }, [editing, audioOffsets]);

  // Shared play/pause
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      micAudioRef.current?.pause();
      sysAudioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (micExists) micAudioRef.current?.play();
      if (sysExists) sysAudioRef.current?.play();
      setIsPlaying(true);
    }
  }, [isPlaying, micExists, sysExists]);

  // Shared seek
  const handleSeek = useCallback((pct: number) => {
    const t = pct * audioDuration;
    if (micAudioRef.current) micAudioRef.current.currentTime = t;
    if (sysAudioRef.current) sysAudioRef.current.currentTime = t;
  }, [audioDuration]);

  // ±5s nudge
  const handleNudge = useCallback((delta: number) => {
    const clamped = Math.max(0, Math.min(playbackTime + delta, audioDuration));
    if (micAudioRef.current) micAudioRef.current.currentTime = clamped;
    if (sysAudioRef.current) sysAudioRef.current.currentTime = clamped;
    setPlaybackTime(clamped);
  }, [playbackTime, audioDuration]);

  // Mute toggles
  useEffect(() => { if (micAudioRef.current) micAudioRef.current.muted = micMuted; }, [micMuted]);
  useEffect(() => { if (sysAudioRef.current) sysAudioRef.current.muted = sysMuted; }, [sysMuted]);

  // Edit handlers
  const handleSaveEdits = useCallback(async () => {
    if (!session) return;
    const patchSegs = editSegments.map((s) => {
      const seg: { text: string; source: string; timestamp: number; capturedAt: number; speaker?: string } = {
        text: s.text, source: s.source, timestamp: s.timestamp ?? 0, capturedAt: s.capturedAt,
      };
      const resolved = speakerMap[s.speaker ?? ""] || s.speaker;
      if (resolved) seg.speaker = resolved;
      return seg;
    });
    // Only mark as edited when actual text or speaker assignments changed
    const hasTextChanges = !session?.segments || editSegments.some((seg, i) => {
      const orig = session.segments?.[i];
      if (!orig) return true; // new segment (from split)
      return seg.text !== orig.text || seg.speaker !== orig.speaker;
    }) || editSegments.length !== (session?.segments?.length ?? 0);

    const patch: Record<string, unknown> = { segments: patchSegs, speakerMap, text: editSegments.map((s) => s.text).join(" ") };
    if (hasTextChanges) {
      patch.edited = true;
      if (!session.originalSegments?.length) {
        patch.originalSegments = session.segments;
        patch.originalText = session.text;
      }
    }
    if (editName.trim()) patch.name = editName.trim();
    // Always include colorTag — it was initialized from session.colorTag when edit started
    patch.colorTag = editColorTag;
    patch.hashtags = editHashtags;
    patch.sourceType = editSourceType ?? null;
    try {
      await api.patchSession(sessionId, patch as Partial<import("../bridge").SavedSession>);
      const updated = await api.loadSession(sessionId);
      setSession(updated); setEditing(false); setSplitIndex(null); setEditColorTag(null);
      useSessionStore.setState({ lastSavedAt: Date.now() });
    } catch (err) {
      console.error("[SESSION] Failed to save edits:", err);
    }
  }, [session, sessionId, editSegments, speakerMap, editName, editColorTag, editHashtags, editSourceType]);

  const handleCancelEdit = () => {
    setEditing(false); setSplitIndex(null);
    if (session?.segments) setEditSegments(session.segments.map((s) => ({ ...s })));
    setSpeakerMap(session?.speakerMap ?? {});
  };

  // State (check-in) panel
  const [showStatePanel, setShowStatePanel] = useState(false);

  // Reprocess panel
  const [showReprocess, setShowReprocess] = useState(false);
  const [reprocessMode, setReprocessMode] = useState<"patterns" | "transcript" | "full">("patterns");
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessStatus, setReprocessStatus] = useState<string | null>(null);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  // Retranscribe sub-options (only relevant when mode !== "patterns")
  const [retranscribeMode, setRetranscribeMode] = useState<RetranscribeMode>("speakers");
  const [cleanupWithAI, setCleanupWithAI] = useState(false);

  // Spec §22.5 Prompt 2b.1 edge case: if the selected retranscribe mode
  // becomes unavailable (e.g. the user pulled their HF token or
  // uninstalled pyannote mid-session), auto-fall-back to "transcribe" if
  // that mode is still available. If even "transcribe" is unavailable
  // (can_use_transcribe = false), leave the selection alone — the Run
  // button will error with a clear message rather than silently doing
  // nothing. We do NOT open the wizard automatically here: the user
  // hasn't asked for setup, only for a retranscribe.
  useEffect(() => {
    if (!setupState) return;
    const current = isModeAvailable(retranscribeToCaptureMode(retranscribeMode), setupState);
    if (current.available) return;
    const transcribeOk = isModeAvailable("capture", setupState).available;
    if (transcribeOk && retranscribeMode !== "transcribe") {
      setRetranscribeMode("transcribe");
      setCleanupWithAI(false);
    }
  }, [setupState, retranscribeMode]);

  // Diff preview (shown after retranscribe step completes, before applying)
  const [retranscribePreview, setRetranscribePreview] = useState<{
    oldSegments: Array<{ text: string; source: string; speaker?: string; timestamp: number; capturedAt: number }>;
    newSegments: Array<{ text: string; source: string; speaker?: string; timestamp: number; capturedAt: number }>;
    stats: { added: number; removed: number; modified: number; unchanged: number };
  } | null>(null);

  const handleReprocess = useCallback(async () => {
    if (!session) return;
    if (isRecording) {
      setReprocessError("Stop the recording before re-analysing");
      return;
    }
    setReprocessing(true);
    setReprocessError(null);
    setReprocessStatus(null);
    setRetranscribePreview(null);
    try {
      if (reprocessMode === "patterns") {
        // Patterns only: re-run analysis on current transcript
        setReprocessStatus("Detecting patterns...");
        const text = segments.map((s) => s.text).join(" ");
        const detections = await api.analyze(text, sessionId);
        await api.patchSession(sessionId, { detections });
        const updated = await api.loadSession(sessionId);
        setSession(updated);
        setShowReprocess(false);
      } else {
        // Transcript or Full: retranscribe first, show preview
        setReprocessStatus("Transcribing audio...");
        const { invoke } = await import("@tauri-apps/api/core");
        const rawSegments = await invoke<Array<{ text: string; speaker: string | null; start: number; end: number }>>(
          "retranscribe_session",
          {
            sessionId: session.id,
            audioSessionId: session.audioSessionId ?? session.id,
            mode: retranscribeMode === "deep" ? 2 : retranscribeMode === "speakers" ? 1 : 0,
          }
        );

        let finalSegments = rawSegments;
        if (retranscribeMode === "deep" && cleanupWithAI) {
          setReprocessStatus("Refining with AI...");
          try {
            const cleaned = await api.retranscribeCleanup(
              rawSegments.map((s) => {
                const r: { text: string; speaker?: string; start: number; end: number } = { text: s.text, start: s.start, end: s.end };
                if (s.speaker) r.speaker = s.speaker;
                return r;
              }),
              session.id
            );
            if (cleaned?.segments?.length) finalSegments = cleaned.segments;
          } catch (e) {
            console.error("[REPROCESS] AI cleanup failed, using raw segments:", e);
          }
        }

        const createdAtMs = new Date(session.createdAt).getTime();
        const newSegments = finalSegments.map((seg) => {
          const s: { text: string; source: string; speaker?: string; timestamp: number; capturedAt: number } = {
            text: seg.text,
            source: seg.speaker ?? "Unknown",
            timestamp: Math.floor(createdAtMs / 1000 + seg.start),
            capturedAt: createdAtMs + seg.start * 1000,
          };
          if (seg.speaker) s.speaker = seg.speaker;
          return s;
        });

        // Compute diff
        const oldSegs = session.segments ?? [];
        const maxLen = Math.max(oldSegs.length, newSegments.length);
        let added = 0, removed = 0, modified = 0, unchanged = 0;
        for (let i = 0; i < maxLen; i++) {
          const oldS = oldSegs[i];
          const newS = newSegments[i];
          if (!oldS && newS) { added++; continue; }
          if (oldS && !newS) { removed++; continue; }
          if (oldS && newS) {
            if (oldS.text?.trim() === newS.text.trim() && (oldS.speaker ?? "") === (newS.speaker ?? "")) {
              unchanged++;
            } else {
              modified++;
            }
          }
        }

        setRetranscribePreview({ oldSegments: oldSegs, newSegments, stats: { added, removed, modified, unchanged } });
        setReprocessStatus(null);
      }
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : "Re-analyse failed");
    } finally {
      setReprocessing(false);
      setReprocessStatus(null);
    }
  }, [session, sessionId, segments, reprocessMode, retranscribeMode, cleanupWithAI, isRecording]);

  const handleApplyReprocess = useCallback(async () => {
    if (!session || !retranscribePreview) return;
    setReprocessing(true);
    setReprocessError(null);
    try {
      // Step 1: Apply new transcript
      const patch: Record<string, unknown> = {
        segments: retranscribePreview.newSegments,
        text: retranscribePreview.newSegments.map((s) => s.text).join(" "),
        edited: true,
        detections: [],
        patternCount: 0,
      };
      if (!session.originalSegments?.length) {
        patch.originalSegments = session.segments;
        patch.originalText = session.text;
      }
      await api.patchSession(sessionId, patch as any);

      // Step 2: If "full" mode, immediately re-analyse using the NEW text
      if (reprocessMode === "full") {
        setReprocessStatus("Detecting patterns...");
        const newText = retranscribePreview.newSegments.map((s) => s.text).join(" ");
        const detections = await api.analyze(newText, sessionId);
        await api.patchSession(sessionId, { detections });
      }

      // Step 3: Reload session and close panel
      const updated = await api.loadSession(sessionId);
      setSession(updated);
      if (updated.segments) setEditSegments(updated.segments.map((s) => ({ ...s })));
      setShowReprocess(false);
      setRetranscribePreview(null);
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setReprocessing(false);
      setReprocessStatus(null);
    }
  }, [session, sessionId, retranscribePreview, reprocessMode]);

  const getSpeakerLabel = (raw?: string) => raw ? (speakerMap[raw] || raw) : undefined;

  const openSplit = (index: number) => { setSplitIndex(index); setSplitFirst(""); setSplitSecond(""); setSplitSpeaker("Person ?"); };
  const confirmSplit = () => {
    if (splitIndex === null) return;
    const seg = editSegments[splitIndex];
    if (!seg || !splitFirst.trim() || !splitSecond.trim()) return;
    const newSegs = [...editSegments];
    newSegs[splitIndex] = { ...seg, text: splitFirst };
    newSegs.splice(splitIndex + 1, 0, { text: splitSecond, source: seg.source, speaker: splitSpeaker, capturedAt: seg.capturedAt + 3000, estimated: true });
    setEditSegments(newSegs); setSplitIndex(null);
  };

  const displaySegments = useMemo(() => {
    if (showOriginal && session) {
      if (session.originalSegments?.length) return session.originalSegments.map((s) => ({ ...s } as Segment));
      if (session.originalText) return [{ text: session.originalText, source: "Original", capturedAt: new Date(session.createdAt).getTime() }] as Segment[];
    }
    return editing ? editSegments : segments;
  }, [showOriginal, session, editing, editSegments, segments]);

  const detections = session?.detections ?? [];

  if (!session) return <div style={{ flex: 1, padding: 32, color: "#444", fontSize: 12 }}>Loading...</div>;

  const micUrl = micExists ? api.getSessionMicAudioUrl(sessionId) : null;
  const sysUrl = sysExists ? api.getSessionSystemAudioUrl(sessionId) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 24px", borderBottom: "1px solid #1a1a1e" }}>
        {/* Row 1: identity + actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          {/* Left cluster */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
              <button onClick={onBack} style={{ background: "none", border: "none", color: "#333", fontSize: 18, cursor: "pointer", padding: 0 }}>←</button>
              {(editColorTag || session.colorTag) && (
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: editColorTag ?? session.colorTag ?? undefined, flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 14, color: "#ccc" }}>{editing ? editName : (session.name || session.label || session.text?.slice(0, 50))}</span>
              {session.edited && (
                <span style={{ fontSize: 8, color: "#b08a50", background: "#b08a5015", border: "1px solid #b08a5030", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.04em", textTransform: "uppercase" }}>edited</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: "#303030", letterSpacing: "0.05em", marginLeft: 28, display: "flex", alignItems: "center", gap: 4 }}>
              <span>{formatDate(session.createdAt)} · {wordCount} words · {speakers.length} speaker{speakers.length !== 1 ? "s" : ""} · {detections.length} patterns</span>
              {session.sourceType && (
                <span style={{ fontSize: 8, color: "#5a5a8a", background: "#1a1a28", border: "1px solid #2a2a3a", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.03em" }}>
                  {SOURCE_TYPE_LABELS[session.sourceType] ?? session.sourceType}
                </span>
              )}
            </div>
            {session.edited && (session.originalSegments?.length || session.originalText) && !editing && (
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = showOriginal ? "underline" : "none")}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 28, marginTop: 2,
                  fontSize: 9, color: showOriginal ? "#8888cc" : "#999", textDecoration: showOriginal ? "underline" : "none",
                }}
              >
                {showOriginal ? "hide original" : "show original"}
              </button>
            )}
            {!editing && session.hashtags && session.hashtags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, marginLeft: 28 }}>
                {session.hashtags.map((tag) => (
                  <span key={tag} style={{ fontSize: 9, color: "#5a5a8a", background: "#1a1a28", border: "1px solid #2a2a3a", borderRadius: 3, padding: "1px 6px", letterSpacing: "0.03em" }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right cluster: action buttons */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {editing ? (
              <>
                <button onClick={handleCancelEdit} style={{ background: "transparent", border: "1px solid #1e1e24", borderRadius: 5, color: "#444", fontSize: 10, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                <button onClick={handleSaveEdits} style={{ background: "#181828", border: "1px solid #303050", borderRadius: 5, color: "#8888cc", fontSize: 10, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}>✓ Save Edits</button>
              </>
            ) : (
              <button onClick={() => { setEditing(true); setShowOriginal(false); setEditSegments(segments.map((s) => ({ ...s }))); setEditName(session?.name ?? session?.text?.slice(0, 60) ?? ""); setEditColorTag(session?.colorTag ?? null); setEditHashtags(session?.hashtags ?? []); setTagInput(""); setEditSourceType(session?.sourceType ?? undefined); }}
                style={{ background: "transparent", border: "1px solid #1e1e24", borderRadius: 5, color: "#444", fontSize: 10, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                Edit
              </button>
            )}
            {!editing && (
              <button
                onClick={() => { if (!isRecording) setShowReprocess(!showReprocess); }}
                disabled={isRecording}
                title={isRecording
                  ? "Stop the recording before re-analysing"
                  : "Re-run pattern detection on this session's transcript"}
                style={{
                  background: showReprocess ? "#181828" : "transparent",
                  border: "1px solid #1e1e24", borderRadius: 5,
                  color: isRecording ? "#333" : showReprocess ? "#8888cc" : "#444",
                  fontSize: 10, padding: "5px 12px",
                  cursor: isRecording ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: isRecording ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                Re-analyse <span style={{ fontSize: 8, color: "#555" }}>▾</span>
              </button>
            )}
            {session.checkIns && session.checkIns.length > 0 && !editing && (
              <button onClick={() => setShowStatePanel((p) => !p)} style={{
                background: showStatePanel ? "#181828" : "transparent",
                border: "1px solid #2a2a4a", borderRadius: 5,
                color: showStatePanel ? "#8888cc" : "#555",
                fontSize: 10, padding: "5px 12px", cursor: "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: showStatePanel ? "#8888cc" : "#555" }} />
                state
              </button>
            )}
          </div>
        </div>
      </div>

      {/* State comparison panel */}
      {showStatePanel && session.checkIns && session.checkIns.length > 0 && (() => {
        const DIMS = [
          { key: "energy" as const, label: "energy", colour: "#378ADD" },
          { key: "clarity" as const, label: "clarity", colour: "#1D9E75" },
          { key: "groundedness" as const, label: "groundedness", colour: "#BA7517" },
          { key: "openness" as const, label: "openness", colour: "#7F77DD" },
        ];
        const before = session.checkIns.find((c: CheckIn) => c.context === "before");
        const after = session.checkIns.find((c: CheckIn) => c.context === "after");
        return (
          <div style={{ margin: "0 24px 12px", padding: "14px 16px", background: "#0c0c14", border: "1px solid #1a1a2e", borderRadius: 8, position: "relative" }}>
            <button onClick={() => setShowStatePanel(false)} style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 14 }}>×</button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {DIMS.map((d) => {
                const bv = before ? before[d.key] : null;
                const av = after ? after[d.key] : null;
                const delta = bv !== null && av !== null ? av - bv : null;
                return (
                  <div key={d.key} style={{ background: "#111118", border: "1px solid #1a1a1e", borderRadius: 6, padding: "8px 12px" }}>
                    <div style={{ fontSize: 9, color: "#555", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{d.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      {bv !== null && <span style={{ fontSize: 16, fontWeight: 700, color: d.colour }}>{bv}°</span>}
                      {bv !== null && av !== null && <span style={{ fontSize: 10, color: "#333" }}>→</span>}
                      {av !== null && <span style={{ fontSize: 16, fontWeight: 700, color: d.colour }}>{av}°</span>}
                      {delta !== null && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: delta > 0 ? "#1D9E75" : delta < 0 ? "#BA7517" : "#444", marginLeft: 4 }}>
                          {delta > 0 ? `↑${delta}°` : delta < 0 ? `↓${Math.abs(delta)}°` : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {before?.note && <div style={{ fontSize: 10, fontStyle: "italic", color: "#555", marginTop: 8 }}>before: {before.note}</div>}
            {after?.note && <div style={{ fontSize: 10, fontStyle: "italic", color: "#555", marginTop: 4 }}>after: {after.note}</div>}
          </div>
        );
      })()}

      {/* Reprocess panel */}
      {showReprocess && !editing && (
        <div style={{ margin: "0 24px 12px", padding: "14px 16px", background: "#0c0c14", border: "1px solid #1a1a2e", borderRadius: 8, position: "relative" }}>
          <button onClick={() => { setShowReprocess(false); setReprocessError(null); setRetranscribePreview(null); }} style={{
            position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 14,
          }}>×</button>

          {/* Step 1 — What to refresh */}
          <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 8 }}>what to refresh</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {(["patterns", "transcript", "full"] as const).map((m) => {
              const labels: Record<typeof m, string> = { patterns: "PATTERNS ONLY", transcript: "TRANSCRIPT ONLY", full: "FULL RE-ANALYSE" };
              const disabled = m !== "patterns" && !hasAnyAudio;
              return (
                <button
                  key={m}
                  onClick={() => { if (!disabled) { setReprocessMode(m); setRetranscribePreview(null); setReprocessError(null); } }}
                  disabled={disabled}
                  style={{
                    background: reprocessMode === m ? "#191920" : "transparent",
                    border: reprocessMode === m ? "1px solid #303050" : "1px solid #1a1a1e",
                    borderRadius: 4,
                    color: disabled ? "#222" : reprocessMode === m ? "#aaa" : "#444",
                    fontSize: 10, padding: "4px 12px", cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit", textTransform: "uppercase",
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>

          {/* Subtitle */}
          <div style={{ fontSize: 10, color: "#444", marginBottom: 12 }}>
            {reprocessMode === "patterns" && "re-run pattern detection on the current transcript"}
            {reprocessMode === "transcript" && "re-run Whisper on the recorded audio to produce a new transcript"}
            {reprocessMode === "full" && "retranscribe audio, then automatically re-run pattern detection on the new transcript"}
          </div>

          {/* Step 2 — Audio settings (only for transcript / full) */}
          {reprocessMode !== "patterns" && (
            <>
              <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 8 }}>audio settings</div>
              {!hasAnyAudio ? (
                <div style={{ fontSize: 10, color: "#333", marginBottom: 12 }}>This session has no recorded audio.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                    {(["deep", "speakers", "transcribe"] as const).map((m) => {
                      // Bridge the retranscribe vocab → CaptureMode before gating.
                      const availability = isModeAvailable(
                        retranscribeToCaptureMode(m),
                        setupState ?? null,
                      );
                      const disabled = !availability.available;
                      const title = disabled
                        ? `${availability.reason} \u2192`
                        : m === "deep"
                          ? "Transcription + AI speaker attribution."
                          : m === "speakers"
                            ? "Transcription + audio-based speaker detection."
                            : "Transcription only.";
                      return (
                        <button
                          key={m}
                          title={title}
                          onClick={() => {
                            if (disabled) {
                              onOpenSetupWizard?.(availability.blockingStep ?? undefined);
                              return;
                            }
                            setRetranscribeMode(m);
                            setCleanupWithAI(m === "deep");
                          }}
                          style={{
                            background: retranscribeMode === m ? "#191920" : "transparent",
                            border: retranscribeMode === m ? "1px solid #303050" : "1px solid #1a1a1e",
                            borderRadius: 4,
                            color: retranscribeMode === m ? "#aaa" : "#444",
                            fontSize: 10,
                            padding: "4px 12px",
                            cursor: disabled ? "help" : "pointer",
                            opacity: disabled ? 0.5 : 1,
                            fontFamily: "inherit",
                            textTransform: "uppercase",
                          }}
                        >
                          {m === "speakers" ? "SPEAKERS" : m === "transcribe" ? "TRANSCRIBE" : "DEEP"}
                        </button>
                      );
                    })}
                  </div>
                  {retranscribeMode === "deep" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={cleanupWithAI} onChange={(e) => setCleanupWithAI(e.target.checked)} style={{ accentColor: "#6366f1" }} />
                      <span style={{ fontSize: 10, color: "#555" }}>Clean up with AI</span>
                    </label>
                  )}
                </>
              )}
            </>
          )}

          {/* Status / Error */}
          {reprocessStatus && <div style={{ fontSize: 10, color: "#6366f1", marginBottom: 8 }}>⏳ {reprocessStatus}</div>}
          {reprocessError && <div style={{ fontSize: 10, color: "#c44e4e", marginBottom: 8 }}>{reprocessError}</div>}

          {/* Run button (hidden when diff preview is showing) */}
          {!retranscribePreview && (
            <button onClick={handleReprocess} disabled={reprocessing || (reprocessMode !== "patterns" && !hasAnyAudio)} style={{
              background: "#181828", border: "1px solid #303050", borderRadius: 5,
              color: reprocessing ? "#999" : "#8888cc", fontSize: 10, padding: "5px 14px",
              cursor: reprocessing ? "wait" : "pointer", fontFamily: "inherit", opacity: reprocessing ? 0.6 : 1,
            }}>{reprocessing ? "Running..." : "Run"}</button>
          )}

          {/* Diff preview (for transcript / full modes) */}
          {retranscribePreview && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "#0a0a12", border: "1px solid #1a1a2e", borderRadius: 6 }}>
              {/* Stats summary */}
              <div style={{ fontSize: 10, color: "#888", marginBottom: 10 }}>
                {retranscribePreview.stats.modified === 0 && retranscribePreview.stats.added === 0 && retranscribePreview.stats.removed === 0 ? (
                  <span style={{ color: "#555" }}>no changes detected</span>
                ) : (
                  <>
                    {retranscribePreview.stats.modified > 0 && <span style={{ color: "#BA7517" }}>{retranscribePreview.stats.modified} modified</span>}
                    {retranscribePreview.stats.modified > 0 && retranscribePreview.stats.added > 0 && " · "}
                    {retranscribePreview.stats.added > 0 && <span style={{ color: "#1D9E75" }}>{retranscribePreview.stats.added} added</span>}
                    {(retranscribePreview.stats.modified > 0 || retranscribePreview.stats.added > 0) && retranscribePreview.stats.removed > 0 && " · "}
                    {retranscribePreview.stats.removed > 0 && <span style={{ color: "#c44e4e" }}>{retranscribePreview.stats.removed} removed</span>}
                    {" · "}
                    <span style={{ color: "#444" }}>{retranscribePreview.stats.unchanged} unchanged</span>
                  </>
                )}
              </div>
              {/* Diff view — show first 10 changed segments */}
              <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
                {(() => {
                  const items: React.ReactNode[] = [];
                  const maxLen = Math.max(retranscribePreview.oldSegments.length, retranscribePreview.newSegments.length);
                  for (let i = 0; i < maxLen; i++) {
                    const oldSeg = retranscribePreview.oldSegments[i];
                    const newSeg = retranscribePreview.newSegments[i];
                    if (!oldSeg && !newSeg) continue;
                    const oldText = oldSeg?.text?.trim() ?? "";
                    const newText = newSeg?.text?.trim() ?? "";
                    const oldSpk = oldSeg?.speaker ?? "";
                    const newSpk = newSeg?.speaker ?? "";
                    if (oldText === newText && oldSpk === newSpk) continue;
                    if (items.length >= 10) break;
                    items.push(
                      <div key={i} style={{ marginBottom: 8, fontSize: 11, lineHeight: 1.5 }}>
                        {oldText && (
                          <div style={{ color: "#c44e4e", textDecoration: "line-through", opacity: 0.7 }}>
                            {oldSpk && <span style={{ color: "#555", fontSize: 9 }}>[{oldSpk}] </span>}
                            {oldText}
                          </div>
                        )}
                        {newText && (
                          <div style={{ color: "#1D9E75" }}>
                            {newSpk && <span style={{ color: "#555", fontSize: 9 }}>[{newSpk}] </span>}
                            {newText}
                          </div>
                        )}
                      </div>
                    );
                  }
                  const totalChanges = retranscribePreview.stats.modified + retranscribePreview.stats.added + retranscribePreview.stats.removed;
                  if (totalChanges > 10) {
                    items.push(
                      <div key="overflow" style={{ fontSize: 9, color: "#444", marginTop: 4 }}>
                        ...and {totalChanges - 10} more change{totalChanges - 10 !== 1 ? "s" : ""}
                      </div>
                    );
                  }
                  return items;
                })()}
              </div>

              {/* "full" mode note */}
              {reprocessMode === "full" && (
                <div style={{ fontSize: 9, color: "#6366f1", marginBottom: 8, opacity: 0.7 }}>
                  applying will also re-run pattern detection on the new transcript
                </div>
              )}

              {/* Apply / Discard */}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleApplyReprocess} disabled={reprocessing} style={{
                  background: "#181828", border: "1px solid #303050", borderRadius: 5,
                  color: "#1D9E75", fontSize: 10, padding: "5px 14px",
                  cursor: reprocessing ? "wait" : "pointer", fontFamily: "inherit",
                }}>{reprocessing ? (reprocessMode === "full" ? "Applying & analysing..." : "Applying...") : "Apply"}</button>
                <button onClick={() => { setRetranscribePreview(null); }} style={{
                  background: "transparent", border: "1px solid #1a1a1e", borderRadius: 5,
                  color: "#444", fontSize: 10, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit",
                }}>Discard</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit controls: name, color, hint */}
      {editing && (
        <div style={{ margin: "12px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Name + Color row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Session name..."
              style={{ flex: 1, background: "#0e0e16", border: "1px solid #1a1a28", borderRadius: 5, color: "#ccc", fontSize: 12, padding: "6px 10px", outline: "none", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {["#e85d4a", "#e8a04a", "#4ae8a0", "#6366f1", "#4a8ae8", "#a04ae8", "#888"].map((c) => (
                <button key={c} onClick={() => setEditColorTag(editColorTag === c ? (session?.colorTag ?? null) : c)} style={{
                  width: 14, height: 14, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
                  border: editColorTag === c ? "2px solid #ddd" : "2px solid transparent", outline: "none",
                }} />
              ))}
              {editColorTag && (
                <button onClick={() => setEditColorTag(null)} style={{
                  background: "none", border: "none", color: "#444", fontSize: 10, cursor: "pointer", padding: "0 2px",
                }}>✕</button>
              )}
            </div>
          </div>
          {/* Hashtag editor */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "4px 10px", background: "#0e0e16", border: "1px solid #1a1a28", borderRadius: 5, minHeight: 30 }}>
            {editHashtags.map((tag) => (
              <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#1a1a28", border: "1px solid #2a2a3a", borderRadius: 3, padding: "2px 6px", fontSize: 10, color: "#7a7aaa" }}>
                #{tag}
                <button onClick={() => setEditHashtags((h) => h.filter((t) => t !== tag))}
                  style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1 }}>
                  ×
                </button>
              </span>
            ))}
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value.replace(/^#/, ""))}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                  e.preventDefault();
                  const tag = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
                  if (!editHashtags.includes(tag)) setEditHashtags((h) => [...h, tag]);
                  setTagInput("");
                }
                if (e.key === "Backspace" && tagInput === "" && editHashtags.length > 0) {
                  setEditHashtags((h) => h.slice(0, -1));
                }
              }}
              placeholder={editHashtags.length === 0 ? "Add tags... (Enter or comma)" : "Add more..."}
              style={{ background: "transparent", border: "none", outline: "none", color: "#888", fontSize: 10, minWidth: 120, padding: "2px 0" }}
            />
          </div>
          {/* Source type selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "4px 0" }}>
            <span style={{ fontSize: 9, color: "#333", textTransform: "uppercase", letterSpacing: "0.08em" }}>source type</span>
            {SOURCE_TYPES.map((st) => (
              <button
                key={st.value}
                onClick={() => setEditSourceType(editSourceType === st.value ? undefined : st.value)}
                style={{
                  background: editSourceType === st.value ? "#191920" : "transparent",
                  border: editSourceType === st.value ? "1px solid #303050" : "1px solid #1a1a1e",
                  borderRadius: 4,
                  color: editSourceType === st.value ? "#aaa" : "#333",
                  fontSize: 9, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {st.label}
              </button>
            ))}
          </div>
          {/* Hint */}
          <div style={{ padding: "6px 10px", background: "#111118", border: "1px solid #1e1e2e", borderRadius: 6, fontSize: 10, color: "#3a3a4a" }}>
            Edit mode — click speaker labels to rename · click "Split here" to split a segment
          </div>
        </div>
      )}

      {/* Dual-track audio player */}
      {hasAnyAudio && (
        <div style={{ margin: "12px 24px", padding: "12px 14px", background: "#0f0f12", border: "1px solid #1a1a1e", borderRadius: 8 }}>
          {/* Row 1: nudge + play + nudge + timestamp */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <button onClick={() => handleNudge(-5)} style={{
              background: "none", border: "1px solid #1a1a1e", borderRadius: 4,
              color: "#444", fontSize: 9, padding: "3px 6px", cursor: "pointer", fontFamily: "inherit",
            }}>« -5s</button>
            <button onClick={togglePlay} style={{
              width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 12,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: isPlaying ? "#141e14" : "#141414",
              border: isPlaying ? "1px solid #4ade8033" : "1px solid #222",
              color: isPlaying ? "#4ade80" : "#555",
            }}>{isPlaying ? "■" : "▶"}</button>
            <button onClick={() => handleNudge(5)} style={{
              background: "none", border: "1px solid #1a1a1e", borderRadius: 4,
              color: "#444", fontSize: 9, padding: "3px 6px", cursor: "pointer", fontFamily: "inherit",
            }}>+5s »</button>
            <span style={{ fontSize: 10, color: "#303030", marginLeft: 4 }}>{fmtTime(playbackTime)} / {fmtTime(audioDuration)}</span>
            <div style={{ flex: 1 }} />
            {isPlaying && <span style={{ fontSize: 10, color: "#4ade80", animation: "blink 1.5s infinite" }}>▶ Syncing...</span>}
          </div>

          {/* All bars share the same container for equal width */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Row 2: main scrub bar with knob — left-padded to align with MIC/SYS bars */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 38, flexShrink: 0 }} />
            <div style={{ flex: 1, height: 4, background: "#1a1a1e", borderRadius: 2, cursor: "pointer", position: "relative" }}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - r.left) / r.width); }}
            >
              <div style={{ height: "100%", width: `${audioDuration > 0 ? (playbackTime / audioDuration) * 100 : 0}%`, background: "#303048", borderRadius: 2 }} />
              {/* Scrub knob */}
              {audioDuration > 0 && (
                <div style={{
                  position: "absolute", left: `${(playbackTime / audioDuration) * 100}%`, top: "50%",
                  transform: "translate(-50%, -50%)", width: 10, height: 10, borderRadius: "50%",
                  background: "#6366f1", cursor: "grab", boxShadow: "0 0 4px #6366f144",
                }} />
              )}
              {/* Segment tick marks */}
              {audioDuration > 0 && audioOffsets.map((offset, idx) => {
                if (idx === 0) return null;
                const pct = (offset / audioDuration) * 100;
                return pct <= 100 ? <div key={`tick-${idx}`} style={{ position: "absolute", left: `${pct}%`, top: -2, width: 1, height: 8, background: "#2a2a3a" }} /> : null;
              })}
            </div>
            </div>

            {/* Row 3: MIC track bar */}
            {micExists && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: micMuted ? 0.5 : 1, transition: "opacity 0.2s" }}>
                <button onClick={() => setMicMuted(!micMuted)} style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: 11,
                  color: micMuted ? "#e85d4a44" : "#e85d4a", padding: 0, width: 16, textAlign: "center",
                }}>{micMuted ? "🔇" : "🔊"}</button>
                <span style={{ fontSize: 9, fontWeight: 600, color: micMuted ? "#e85d4a44" : "#e85d4a", width: 22 }}>MIC</span>
                <div style={{ flex: 1, height: 2, background: "#1a1a1e", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${audioDuration > 0 ? (playbackTime / audioDuration) * 100 : 0}%`, background: micMuted ? "#e85d4a22" : "#e85d4a", borderRadius: 1 }} />
                </div>
              </div>
            )}

            {/* Row 4: SYS track bar */}
            {sysExists && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: sysMuted ? 0.5 : 1, transition: "opacity 0.2s" }}>
                <button onClick={() => setSysMuted(!sysMuted)} style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: 11,
                  color: sysMuted ? "#e8a04a44" : "#e8a04a", padding: 0, width: 16, textAlign: "center",
                }}>{sysMuted ? "🔇" : "🔊"}</button>
                <span style={{ fontSize: 9, fontWeight: 600, color: sysMuted ? "#e8a04a44" : "#e8a04a", width: 22 }}>SYS</span>
                <div style={{ flex: 1, height: 2, background: "#1a1a1e", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${audioDuration > 0 ? (playbackTime / audioDuration) * 100 : 0}%`, background: sysMuted ? "#e8a04a22" : "#e8a04a", borderRadius: 1 }} />
                </div>
              </div>
            )}
          </div>

          {/* Hidden audio elements */}
          {micUrl && <audio ref={micAudioRef} src={micUrl} preload="auto"
            onTimeUpdate={() => { if (micAudioRef.current) setPlaybackTime(micAudioRef.current.currentTime); }}
            onDurationChange={() => { if (micAudioRef.current) setAudioDuration((d) => Math.max(d, micAudioRef.current!.duration)); }}
            onPlay={() => setIsPlaying(true)} onPause={() => { if (!sysAudioRef.current || sysAudioRef.current.paused) setIsPlaying(false); }}
            onEnded={() => { if (!sysAudioRef.current || sysAudioRef.current.ended) setIsPlaying(false); }}
            onError={() => setMicExists(false)}
          />}
          {sysUrl && <audio ref={sysAudioRef} src={sysUrl} preload="auto"
            onTimeUpdate={() => { if (sysAudioRef.current && !micExists) setPlaybackTime(sysAudioRef.current.currentTime); }}
            onDurationChange={() => { if (sysAudioRef.current) setAudioDuration((d) => Math.max(d, sysAudioRef.current!.duration)); }}
            onPlay={() => setIsPlaying(true)} onPause={() => { if (!micAudioRef.current || micAudioRef.current.paused) setIsPlaying(false); }}
            onEnded={() => { if (!micAudioRef.current || micAudioRef.current.ended) setIsPlaying(false); }}
            onError={() => setSysExists(false)}
          />}
        </div>
      )}

      {/* Transcript */}
      <div ref={transcriptRef} style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        {displaySegments.map((seg, i) => {
          const label = getSpeakerLabel(seg.speaker);
          const isActive = activeSegIndex === i;
          return (
            <div key={`seg-${i}`} ref={(el) => { if (el) segmentRefs.current.set(i, el); else segmentRefs.current.delete(i); }}>
              {seg.estimated && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", opacity: 0.4 }}>
                  <div style={{ flex: 1, borderTop: "1px dashed #2a2a3a" }} />
                  <span style={{ fontSize: 9, color: "#2a2a3a" }}>injected split</span>
                  <div style={{ flex: 1, borderTop: "1px dashed #2a2a3a" }} />
                </div>
              )}
              <div onClick={() => handleSegmentClick(i)} style={{
                marginBottom: 18, padding: "8px 12px",
                background: flashedSeg === i ? "#16162a" : isActive ? "#14141a" : "transparent",
                borderLeft: flashedSeg === i ? "2px solid #6366f1" : isActive ? "2px solid #4a4a88" : "2px solid transparent",
                borderRadius: 4, transition: "background 0.3s ease, border-left 0.3s ease",
                cursor: hasAnyAudio && !editing ? "pointer" : undefined,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  {editing && label ? (
                    <input value={speakerMap[seg.speaker ?? ""] || seg.speaker || ""}
                      onChange={(e) => { if (seg.speaker) setSpeakerMap((m) => ({ ...m, [seg.speaker!]: e.target.value })); }}
                      onClick={(e) => e.stopPropagation()} style={{
                        background: "#161622", border: "1px solid #222232", borderRadius: 3,
                        color: speakerColor(label), fontSize: 10, width: 90, padding: "2px 6px", outline: "none", fontFamily: "inherit",
                      }}
                    />
                  ) : label ? (
                    <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: speakerColor(label) }}>{label}</span>
                  ) : null}
                  {seg.capturedAt && <span style={{ fontSize: 10, color: "#252525" }}>{exactTime(seg.capturedAt)}</span>}
                  {isActive && <span style={{ fontSize: 9, color: "#4a9eed" }}>▶ now</span>}
                </div>
                {editing ? (
                  <>
                    <AutoTextarea value={editSegments[i]?.text ?? ""} onChange={(v) => {
                      const newSegs = [...editSegments]; newSegs[i] = { ...newSegs[i]!, text: v }; setEditSegments(newSegs);
                    }} />
                    {splitIndex === i ? (
                      <div style={{ marginTop: 8, padding: 12, background: "#0e0e18", border: "1px solid #1e1e30", borderRadius: 6 }}>
                        <div style={{ fontSize: 10, color: "#4a4a6a", marginBottom: 8 }}>Split segment — type first part and second part below</div>
                        <div style={{ fontSize: 10, color: "#303030", marginBottom: 8, padding: "6px 8px", background: "#0a0a12", borderRadius: 4, maxHeight: 80, overflow: "auto", whiteSpace: "pre-wrap" }}>{editSegments[i]?.text ?? ""}</div>
                        <AutoTextarea value={splitFirst} onChange={setSplitFirst} />
                        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0", opacity: 0.5 }}>
                          <div style={{ flex: 1, borderTop: "1px dashed #2a2a3a" }} /><span style={{ fontSize: 9, color: "#2a2a3a" }}>split</span><div style={{ flex: 1, borderTop: "1px dashed #2a2a3a" }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 9, color: "#4a4a6a" }}>Speaker:</span>
                          <input value={splitSpeaker} onChange={(e) => setSplitSpeaker(e.target.value)} style={{ background: "#161622", border: "1px solid #222232", borderRadius: 3, color: "#8888cc", fontSize: 10, width: 90, padding: "2px 6px", outline: "none", fontFamily: "inherit" }} />
                        </div>
                        <AutoTextarea value={splitSecond} onChange={setSplitSecond} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={confirmSplit} style={{ background: "#181828", border: "1px solid #2a2a44", borderRadius: 4, color: "#7777aa", fontSize: 9, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit" }}>Confirm Split</button>
                          <button onClick={() => setSplitIndex(null)} style={{ background: "transparent", border: "1px solid #1e1e2a", borderRadius: 4, color: "#3a3a55", fontSize: 9, padding: "4px 12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => openSplit(i)} style={{ background: "none", border: "1px solid #1e1e2a", borderRadius: 4, color: "#3a3a55", fontSize: 9, padding: "3px 8px", cursor: "pointer", marginTop: 4, fontFamily: "inherit" }}>⊕ Split here / Inject new speaker</button>
                    )}
                  </>
                ) : (() => {
                  const segStart = session.text.indexOf(seg.text);
                  const segmentDetections = segStart >= 0 ? detections.filter((d) =>
                    d.phrasePosition.start >= segStart && d.phrasePosition.end <= segStart + seg.text.length
                  ).map((d) => ({
                    ...d, phrasePosition: { start: d.phrasePosition.start - segStart, end: d.phrasePosition.end - segStart },
                  })) : [];
                  const tierColors: Record<string, string> = { possible: "#c4a24e", likely: "#d4822e", strong: "#c44e4e" };
                  return (
                    <>
                      <AnnotatedText text={seg.text} detections={segmentDetections} onNavigateToPattern={onNavigateToPattern} />
                      {segmentDetections.length > 0 && (
                        <>
                          <div style={{ borderTop: "1px solid #1a1a1e", margin: "8px 0 6px" }} />
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {segmentDetections.map((det) => {
                              const c = tierColors[det.confidenceTier] ?? "#888";
                              return (
                                <span key={`tag-${det.id}`} onClick={(e) => e.stopPropagation()} style={{
                                  fontSize: 10, padding: "2px 8px", background: `${c}18`,
                                  border: `1px solid ${c}44`, borderRadius: 3, color: c,
                                  letterSpacing: "0.04em", cursor: "default",
                                }}>
                                  {det.patternId.replace(/-/g, " ")} · {Math.round(det.confidence * 100)}%
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
