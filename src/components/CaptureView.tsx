import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSessionStore, type CapturedSegment, type ModelDownloadProgress } from "../stores/session-store";
import { invoke } from "@tauri-apps/api/core";
import { api, SOURCE_TYPES, type SavedSession } from "../bridge";
import type { DetectionInstance } from "@fides/pattern-library";
import { AnnotationMark } from "./AnnotationMark";

// ─── Speaker colors ───

function speakerColor(speaker: string): string {
  if (speaker === "Mic") return "#4a4a99";
  if (speaker === "Incoming Audio" || speaker === "Incoming") return "#555";
  return "#3a7aaa";
}

// ─── Pattern annotation helpers ───

const TIER_COLORS: Record<string, string> = { possible: "#c4a24e", likely: "#d4822e", strong: "#c44e4e" };
function tierColor(tier: string): string { return TIER_COLORS[tier] ?? "#888"; }

function renderAnnotated(text: string, dets: DetectionInstance[]): React.ReactNode[] {
  const sorted = [...dets].sort((a, b) => a.phrasePosition.start - b.phrasePosition.start);
  // Resolve overlaps — keep higher confidence
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

// ─── Paragraph reconstruction ───

const PARA_GAP_MS = 30_000;
const PARA_MAX_WORDS = 400;

function endsSentence(text: string): boolean {
  const t = text.trimEnd();
  if (!t.length) return false;
  const c = t[t.length - 1]!;
  return c === "." || c === "?" || c === "!";
}

interface MergedParagraph {
  text: string;
  source: string;
  speaker?: string;
  timestamp: number;
  wordCount: number;
  hasOverlap?: boolean;
  overlapSpeakers?: string[];
}

function mergeSegments(segs: ReadonlyArray<CapturedSegment>): MergedParagraph[] {
  if (!segs.length) return [];
  const out: MergedParagraph[] = [];
  let txt = "", src = "", ts = 0, wc = 0, spk: string | undefined, hasOl = false, olSpk: string[] | undefined;

  const flush = () => {
    const t = txt.trim();
    if (t) {
      const p: MergedParagraph = { text: t, source: src, timestamp: ts, wordCount: wc };
      if (spk) p.speaker = spk;
      if (hasOl) p.hasOverlap = true;
      if (olSpk?.length) p.overlapSpeakers = olSpk;
      out.push(p);
    }
  };

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const sw = s.text.trim().split(/\s+/).filter(Boolean).length;
    if (i === 0) { txt = s.text.trim(); src = s.source; ts = s.capturedAt; wc = sw; spk = s.speaker; hasOl = !!s.hasOverlap; olSpk = s.overlapSpeakers; continue; }
    const prev = segs[i - 1]!;
    const gap = s.capturedAt - prev.capturedAt;
    const srcCh = s.source !== src || s.speaker !== spk;
    if (srcCh || gap > PARA_GAP_MS || (wc + sw > PARA_MAX_WORDS && endsSentence(txt))) {
      flush(); txt = s.text.trim(); src = s.source; ts = s.capturedAt; wc = sw; spk = s.speaker; hasOl = !!s.hasOverlap; olSpk = s.overlapSpeakers; continue;
    }
    txt += " " + s.text.trim(); wc += sw;
    if (s.hasOverlap) hasOl = true;
  }
  flush();
  return out;
}

function exactTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// ─── Model download ───

function ModelDownloadBar({ progress }: { progress: ModelDownloadProgress }) {
  const pct = progress.total > 0 ? (progress.downloaded / progress.total) * 100 : 0;
  const fmt = (b: number) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(0)} MB` : `${(b / 1073741824).toFixed(1)} GB`;
  return (
    <div style={{ padding: "16px 32px" }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>Downloading Whisper model... {fmt(progress.downloaded)} / {fmt(progress.total)}</div>
      <div style={{ height: 4, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#555", borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

// ─── Main component ───

export function CaptureView({ onCheckInOpen }: { onCheckInOpen?: () => void }) {
  const segments = useSessionStore((s) => s.capturedText);
  const isCapturing = useSessionStore((s) => s.isAudioCapturing);
  const detections = useSessionStore((s) => s.detections);
  const clipAnalyzing = useSessionStore((s) => s.clipAnalyzing);
  const captureMode = useSessionStore((s) => s.captureMode);
  const deepAnalyzing = useSessionStore((s) => s.deepAnalyzing);
  const deepTimerSeconds = useSessionStore((s) => s.deepTimerSeconds);
  const deepAccumulationStart = useSessionStore((s) => s.deepAccumulationStart);
  const modelDownloadProgress = useSessionStore((s) => s.modelDownloadProgress);
  const analyzeClip = useSessionStore((s) => s.analyzeClip);
  const selectedSourceType = useSessionStore((s) => s.selectedSourceType);
  const setSelectedSourceType = useSessionStore((s) => s.setSelectedSourceType);
  const ritualEntry = useSessionStore((s) => s.ritualEntry);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modelStatus, setModelStatus] = useState<{ downloaded: boolean } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Reprocess dropdown
  const [showReprocessMenu, setShowReprocessMenu] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessStatus, setReprocessStatus] = useState<string | null>(null);
  const [reprocessError, setReprocessError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ downloaded: boolean }>("get_model_status").then(setModelStatus).catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments.length]);

  // Auto-save draft every 10 seconds when there's captured text
  useEffect(() => {
    if (segments.length === 0) return;
    const timer = setInterval(() => {
      useSessionStore.getState().saveDraft();
    }, 10000);
    return () => clearInterval(timer);
  }, [segments.length > 0]);

  // Deep mode timer
  useEffect(() => {
    if (captureMode !== "deep" || !isCapturing) return;
    const iv = setInterval(() => {
      const store = useSessionStore.getState();
      if (store.deepAccumulationStart) {
        const elapsed = Math.floor((Date.now() - store.deepAccumulationStart) / 1000);
        store.setDeepTimerSeconds(elapsed);
        if (elapsed >= 60 && !store.deepAnalyzing) store.flushDeepBuffer();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [captureMode, isCapturing]);

  const paragraphs = useMemo(() => mergeSegments(segments), [segments]);

  // Auto-analyse — triggers when a new paragraph is completed
  const autoAnalyse = useSessionStore((s) => s.autoAnalyse);
  const paragraphCount = paragraphs.length;
  const prevParagraphCount = useRef(0);
  useEffect(() => {
    // Track paragraph count changes only when auto-analyse is active
    if (!autoAnalyse || !isCapturing) {
      prevParagraphCount.current = paragraphCount;
      return;
    }

    // A new paragraph was completed (count increased)
    if (paragraphCount <= prevParagraphCount.current) {
      prevParagraphCount.current = paragraphCount;
      return;
    }
    prevParagraphCount.current = paragraphCount;

    const timer = setTimeout(() => {
      const store = useSessionStore.getState();
      if (store.autoAnalyseRunning) return;
      if (store.capturedText.length === 0) return;
      const textLen = store.capturedText.reduce((a, s) => a + s.text.length, 0);
      if (textLen <= store.lastAutoAnalysedLength) return;

      const text = store.capturedText.map((s) => s.text).join(" ");
      if (text.trim().length === 0) return;

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
  }, [autoAnalyse, isCapturing, paragraphCount]);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      await invoke<string>("download_model");
      const status = await invoke<{ downloaded: boolean }>("get_model_status");
      setModelStatus(status);
    } catch {} finally {
      setIsDownloading(false);
      useSessionStore.getState().setModelDownloadProgress(null);
    }
  }, []);

  const modelReady = modelStatus?.downloaded === true;
  const hasText = segments.length > 0;

  const handleClipAnalyse = () => {
    const text = segments.map((s) => s.text).join(" ");
    if (text.trim()) useSessionStore.getState().analyzeLive(text);
  };

  const hasAnyAudio = !!useSessionStore((s) => s.audioSessionId);

  const handleReprocess = useCallback(async (mode: "patterns" | "transcript" | "full") => {
    setShowReprocessMenu(false);
    setReprocessing(true);
    setReprocessError(null);
    setReprocessStatus(null);
    try {
      const store = useSessionStore.getState();

      if (mode === "patterns") {
        setReprocessStatus("Detecting patterns...");
        const text = segments.map((s) => s.text).join(" ");
        if (text.trim()) await store.analyzeLive(text);
      } else {
        // Retranscribe audio
        const audioSessionId = store.audioSessionId;
        const sessionId = store.currentSessionId ?? `live-${Date.now()}`;
        if (!audioSessionId) throw new Error("No audio available");

        setReprocessStatus("Transcribing audio...");
        const rawSegments = await invoke<Array<{ text: string; speaker: string | null; start: number; end: number }>>(
          "retranscribe_session",
          { sessionId, audioSessionId, mode: captureMode === "deep" ? 2 : captureMode === "live" ? 1 : 0 }
        );

        // Replace capturedText with retranscribed segments
        const now = Date.now();
        const newSegments: CapturedSegment[] = rawSegments.map((seg) => {
          const s: CapturedSegment = {
            text: seg.text,
            source: seg.speaker ?? "Unknown",
            timestamp: Math.floor(now / 1000 + seg.start),
            capturedAt: now + seg.start * 1000,
          };
          if (seg.speaker) s.speaker = seg.speaker;
          return s;
        });
        useSessionStore.setState({ capturedText: newSegments, detections: [] });

        // If full mode, also re-analyse
        if (mode === "full") {
          setReprocessStatus("Detecting patterns...");
          const text = newSegments.map((s) => s.text).join(" ");
          if (text.trim()) {
            const detections = await api.analyze(text, sessionId);
            useSessionStore.setState({ detections });
          }
        }
      }
    } catch (err) {
      setReprocessError(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessing(false);
      setReprocessStatus(null);
    }
  }, [segments, captureMode]);

  const handleSaveSession = () => {
    const store = useSessionStore.getState();
    let id = store.currentSessionId;
    if (!id) {
      id = `session-${Date.now()}`;
      useSessionStore.setState({ currentSessionId: id });
    }
    const payload: Record<string, unknown> = {
      id,
      text: store.capturedText.map((s) => s.text).join(" "),
      detections: store.detections,
      createdAt: new Date().toISOString(),
      segments: store.capturedText.map((s) => {
        const seg: { text: string; source: string; timestamp: number; capturedAt: number; speaker?: string } = {
          text: s.text, source: s.source, timestamp: s.timestamp, capturedAt: s.capturedAt,
        };
        if (s.speaker) seg.speaker = s.speaker;
        return seg;
      }),
      wordCount: store.capturedText.reduce((a, s) => a + s.text.trim().split(/\s+/).filter(Boolean).length, 0),
      patternCount: store.detections.length,
      hasAudio: !!store.audioSessionId,
      hasMicAudio: !!store.audioSessionId && (store.settings.audioSource === "microphone" || store.settings.audioSource === "both"),
      hasSystemAudio: !!store.audioSessionId && (store.settings.audioSource === "loopback" || store.settings.audioSource === "both"),
      checkIns: store.checkIns.filter((c) =>
        c.sessionId === id || c.sessionId === store.audioSessionId
      ),
    };
    if (store.audioSessionId) payload.audioSessionId = store.audioSessionId;
    if (store.selectedSourceType) payload.sourceType = store.selectedSourceType;

    // Attach ritual data
    const ritualEntryData = store.ritualEntry;
    const ritualExitData = store.ritualExit;
    if (ritualEntryData?.intentionTag) payload.intentionTag = ritualEntryData.intentionTag;
    if (ritualExitData?.outcomeTag) payload.outcomeTag = ritualExitData.outcomeTag;

    // Merge relationship tags from both entry and exit
    const allRelTags = [
      ...(ritualEntryData?.relationshipTags ?? []),
      ...(ritualExitData?.relationshipTags ?? []),
    ];
    if (allRelTags.length > 0) payload.relationshipTags = [...new Set(allRelTags)];

    // Build check-ins from ritual state readings
    const ritualCheckIns: Array<Record<string, unknown>> = [];
    if (ritualEntryData) {
      ritualCheckIns.push({
        id: crypto.randomUUID(),
        timestamp: ritualEntryData.timestamp,
        ...ritualEntryData.state,
        context: "before" as const,
        sessionId: id,
      });
    }
    if (ritualExitData) {
      ritualCheckIns.push({
        id: crypto.randomUUID(),
        timestamp: ritualExitData.timestamp,
        ...ritualExitData.state,
        context: "after" as const,
        sessionId: id,
      });
    }
    // Merge with any standalone check-ins already recorded
    const existingCheckIns = (payload.checkIns as Array<Record<string, unknown>>) ?? [];
    payload.checkIns = [...ritualCheckIns, ...existingCheckIns];

    api.saveSession(payload as any).then(() => {
      useSessionStore.setState({ lastSavedAt: Date.now() });
    }).catch(() => {});
  };

  // Ritual card handlers moved to App.tsx (renders as fixed overlay from any tab)

  // Empty state
  if (!modelReady && !isDownloading && !modelDownloadProgress) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>Whisper model required</div>
        <button onClick={handleDownload} style={{
          background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4,
          color: "#d0d0d0", fontSize: 12, padding: "8px 20px", cursor: "pointer",
        }}>Download Model (~3.1 GB)</button>
      </div>
    );
  }

  if (isDownloading && modelDownloadProgress) return <ModelDownloadBar progress={modelDownloadProgress} />;

  if (!hasText && !isCapturing) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 100 }}>
        <div style={{ fontSize: 36, opacity: 0.3, color: "#222" }}>◎</div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "#333", marginTop: 12 }}>
          Select a mode and press Start
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Deep mode indicator */}
      {captureMode === "deep" && isCapturing && !deepAnalyzing && deepAccumulationStart && (
        <div style={{ padding: "12px 32px", borderBottom: "1px solid #141416" }}>
          <div style={{ color: "#666", fontSize: 11, marginBottom: 6 }}>Recording... {deepTimerSeconds}s / 60s</div>
          <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (deepTimerSeconds / 60) * 100)}%`, background: "#333", transition: "width 0.5s" }} />
          </div>
        </div>
      )}
      {captureMode === "deep" && deepAnalyzing && (
        <div style={{ padding: "12px 32px", color: "#666", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          Analysing... <span style={{ color: "#e85d4a", animation: "blink 1.5s infinite" }}>●</span>
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {isCapturing && !hasText && (
          <div style={{ color: "#333", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>Listening...</div>
        )}
        {paragraphs.map((para, i) => {
          // Compute paragraph's char offset in the full joined text for detection matching
          const fullText = paragraphs.map(p => p.text).join(" ");
          let charOffset = 0;
          for (let j = 0; j < i; j++) charOffset += paragraphs[j]!.text.length + 1;
          const paraEnd = charOffset + para.text.length;

          // Filter detections overlapping this paragraph and adjust positions
          const paraDetections = detections
            .filter(d => d.phrasePosition.start < paraEnd && d.phrasePosition.end > charOffset)
            .map(d => ({
              ...d,
              phrasePosition: {
                start: Math.max(0, d.phrasePosition.start - charOffset),
                end: Math.min(para.text.length, d.phrasePosition.end - charOffset),
              },
            }))
            .filter(d => d.phrasePosition.end > d.phrasePosition.start);

          return (
            <div key={`p-${para.timestamp}-${i}`} style={{ marginBottom: 18 }}>
              {/* Speaker + time */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {para.speaker && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em",
                    color: speakerColor(para.speaker),
                  }}>{para.speaker}</span>
                )}
                <span style={{ fontSize: 10, color: "#252525" }}>{exactTime(para.timestamp)}</span>
              </div>
              {/* Overlap indicator */}
              {para.hasOverlap && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#a86", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>⚡</span>
                  <span>Overlap — {para.overlapSpeakers?.join(" & ") ?? "multiple speakers"}</span>
                </div>
              )}
              {/* Annotated text */}
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#a8a6a0", whiteSpace: "pre-wrap" }}>
                {paraDetections.length > 0 ? renderAnnotated(para.text, paraDetections) : para.text}
              </div>
              {/* Pattern tags row */}
              {paraDetections.length > 0 && (
                <>
                  <div style={{ borderTop: "1px solid #1a1a1e", margin: "8px 0 6px" }} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {paraDetections.map(det => {
                      const c = tierColor(det.confidenceTier);
                      return (
                        <span key={`tag-${det.id}`} style={{
                          fontSize: 10, padding: "2px 8px", background: `${c}18`,
                          border: `1px solid ${c}44`, borderRadius: 3, color: c,
                          cursor: "pointer", letterSpacing: "0.04em",
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
        })}
      </div>

      {/* Bottom action bar */}
      {hasText && (
        <div style={{
          borderTop: "1px solid #141416", padding: "18px 32px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            {detections.length === 0 ? (
              <button onClick={handleClipAnalyse} disabled={clipAnalyzing || segments.length === 0} style={{
                background: "transparent", border: "1px solid #1e1e24", borderRadius: 5,
                color: clipAnalyzing ? "#555" : "#888", fontSize: 11, padding: "6px 14px",
                cursor: clipAnalyzing ? "wait" : "pointer", fontFamily: "inherit",
                opacity: clipAnalyzing ? 0.6 : 1,
              }}>{clipAnalyzing ? "Analysing..." : "Analyse"}</button>
            ) : (
              <button
                onClick={() => setShowReprocessMenu((p) => !p)}
                disabled={reprocessing || clipAnalyzing}
                style={{
                  background: showReprocessMenu ? "#181828" : "transparent",
                  border: "1px solid #1e1e24", borderRadius: 5,
                  color: reprocessing || clipAnalyzing ? "#555" : showReprocessMenu ? "#8888cc" : "#888",
                  fontSize: 11, padding: "6px 14px",
                  cursor: reprocessing || clipAnalyzing ? "wait" : "pointer", fontFamily: "inherit",
                  opacity: reprocessing || clipAnalyzing ? 0.6 : 1,
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                {reprocessing ? (reprocessStatus ?? "Reprocessing...") : "Reprocess"} <span style={{ fontSize: 8, color: "#555" }}>▴</span>
              </button>
            )}
            {/* Reprocess dropdown menu (pops upward) */}
            {showReprocessMenu && (
              <div style={{
                position: "absolute", bottom: "100%", left: 0, marginBottom: 4,
                background: "#0c0c14", border: "1px solid #1a1a2e", borderRadius: 6,
                padding: "6px 0", minWidth: 180, zIndex: 10,
              }}>
                <button onClick={() => handleReprocess("patterns")} style={{
                  display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                  color: "#888", fontSize: 10, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
                }}>
                  <div style={{ color: "#aaa", marginBottom: 2 }}>PATTERNS ONLY</div>
                  <div style={{ fontSize: 9, color: "#444" }}>re-run pattern detection</div>
                </button>
                <button onClick={() => handleReprocess("transcript")} disabled={!hasAnyAudio} style={{
                  display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                  color: hasAnyAudio ? "#888" : "#333", fontSize: 10, padding: "6px 14px",
                  cursor: hasAnyAudio ? "pointer" : "not-allowed", fontFamily: "inherit",
                  opacity: hasAnyAudio ? 1 : 0.4,
                }}>
                  <div style={{ color: hasAnyAudio ? "#aaa" : "#333", marginBottom: 2 }}>TRANSCRIPT ONLY</div>
                  <div style={{ fontSize: 9, color: "#444" }}>re-run Whisper on recorded audio</div>
                </button>
                <button onClick={() => handleReprocess("full")} disabled={!hasAnyAudio} style={{
                  display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                  color: hasAnyAudio ? "#888" : "#333", fontSize: 10, padding: "6px 14px",
                  cursor: hasAnyAudio ? "pointer" : "not-allowed", fontFamily: "inherit",
                  opacity: hasAnyAudio ? 1 : 0.4,
                }}>
                  <div style={{ color: hasAnyAudio ? "#aaa" : "#333", marginBottom: 2 }}>FULL REPROCESS</div>
                  <div style={{ fontSize: 9, color: "#444" }}>retranscribe + detect patterns</div>
                </button>
              </div>
            )}
            {reprocessError && <span style={{ color: "#c44e4e", fontSize: 10 }}>{reprocessError}</span>}
            {detections.length > 0 && !clipAnalyzing && !reprocessing && (
              <span style={{ fontSize: 10, color: "#555" }}>
                {detections.length} pattern{detections.length !== 1 ? "s" : ""} highlighted
              </span>
            )}
          </div>
          <span style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>
            audio:{useSessionStore.getState().audioSessionId ?? "null"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleSaveSession} style={{
              background: "transparent", border: "1px solid #1e2a1e", borderRadius: 5,
              color: "#3a5a3a", fontSize: 11, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
            }}>Save Session</button>
            {onCheckInOpen && (
              <button onClick={onCheckInOpen} style={{
                background: "transparent", border: "1px solid #1e1e2a", borderRadius: 5,
                color: "#3a3a5a", fontSize: 11, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
              }}>State</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
