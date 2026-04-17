import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type { DetectionInstance } from "@fides/pattern-library";
import type { PatternCategory } from "@fides/pattern-library";
import { api, DEFAULT_SETTINGS, type FidesSettings, type CheckIn } from "../bridge";
import { useDisplayStore } from "./display-store";

export interface CapturedSegment {
  text: string;
  source: string;
  timestamp: number;
  capturedAt: number;
  speaker?: string;
  hasOverlap?: boolean;
  overlapSpeakers?: string[];
}

const BUFFER_MAX_MS = 30 * 60 * 1000; // 30 minutes

export interface RitualData {
  state: { energy: number; clarity: number; groundedness: number; openness: number; sovereignty: number; presence: number };
  intentionTag?: string;
  relationshipTags: string[];
  outcomeTag?: string;
  sourceType?: string;
  timestamp: number;
}

export interface ModelDownloadProgress {
  downloaded: number;
  total: number;
}

interface SessionState {
  captureStatus: "idle" | "capturing" | "paused";
  currentSessionId: string | null;
  capturedText: CapturedSegment[];
  detections: DetectionInstance[];
  /** IDs of detections that arrived on the most recent analysis tick and
   *  haven't yet finished their fade-in animation. Frontend-only — never
   *  persisted to disk. Cleared by a single setTimeout after the longest
   *  staggered animation completes. */
  newDetectionIds: string[];
  error: string | null;

  // Clip analysis state
  clipText: string | null;
  clipAnalyzing: boolean;
  clipError: string | null;

  // Session history
  lastSavedAt: number | null;

  // Model download progress
  modelDownloadProgress: ModelDownloadProgress | null;

  // Audio capture
  isAudioCapturing: boolean;
  audioError: string | null;

  // Settings
  settings: FidesSettings;
  settingsLoaded: boolean;

  // Capture modes
  captureMode: "capture" | "live" | "deep";
  autoAnalyse: boolean;

  // Deep mode accumulation
  deepBuffer: CapturedSegment[];
  deepAccumulationStart: number | null;
  deepAnalyzing: boolean;
  deepTimerSeconds: number;

  // Auto-analyse tracking. No cooldown — detection fires every time new text
  // arrives (per-paragraph). `lastAutoAnalysedLength` only prevents redundant
  // re-analysis of unchanged text, not timed gating.
  autoAnalyseRunning: boolean;
  lastAutoAnalysedLength: number;
  setLastAutoAnalysedLength: (n: number) => void;

  // Rec audio
  recordAudio: boolean;
  audioSessionId: string | null;

  // Source type tagging
  selectedSourceType: string | undefined;
  setSelectedSourceType: (v: string | undefined) => void;

  setCaptureStatus: (status: "idle" | "capturing" | "paused") => void;
  setAudioCapturing: (running: boolean) => void;
  setAudioError: (error: string | null) => void;
  addCapturedText: (segment: { text: string; source: string; timestamp: number; speaker?: string; hasOverlap?: boolean; overlapSpeakers?: string[] }) => void;
  addDetections: (detections: DetectionInstance[]) => void;
  setError: (error: string | null) => void;
  clearSession: () => void;
  analyzeClip: (text: string) => Promise<void>;
  analyzeLive: (text: string, mode?: "replace" | "merge") => Promise<void>;
  resetClip: () => void;
  loadSavedSession: (sessionId: string) => Promise<void>;
  getClipWindow: (windowMs: number) => string;
  setModelDownloadProgress: (progress: ModelDownloadProgress | null) => void;
  setCaptureMode: (mode: "capture" | "live" | "deep") => void;
  setAutoAnalyse: (on: boolean) => void;
  flushDeepBuffer: () => Promise<void>;
  setDeepTimerSeconds: (s: number) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: FidesSettings) => Promise<void>;
  updateSetting: <K extends keyof FidesSettings>(key: K, value: FidesSettings[K]) => void;
  resetSettingsToDefaults: () => Promise<void>;
  setRecordAudio: (on: boolean) => void;
  setAudioSessionId: (id: string | null) => void;
  saveDraft: () => Promise<void>;
  loadDraft: () => Promise<boolean>;
  deleteDraft: () => Promise<void>;

  // Session Ritual
  ritualEntry: RitualData | null;
  ritualExit: RitualData | null;
  showEntryCard: boolean;
  showExitCard: boolean;
  setRitualEntry: (data: RitualData | null) => void;
  setRitualExit: (data: RitualData | null) => void;
  setShowEntryCard: (show: boolean) => void;
  setShowExitCard: (show: boolean) => void;

  // Check-ins
  checkIns: CheckIn[];
  addCheckIn: (c: CheckIn) => void;
  loadCheckIns: () => Promise<void>;
}

/**
 * Clear `newDetectionIds` after the longest staggered fade-in animation has
 * completed. Uses reference equality on the array we just scheduled so that
 * an overlapping analyzeLive call can't prematurely clear a newer batch —
 * if the value has changed, the timeout is a no-op.
 *
 * Timing math: first animation starts at t=0 with a 300ms fade; each
 * subsequent annotation starts 50ms later; add 200ms of slack for safety.
 */
function scheduleClearNewIds(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
  scheduledIds: string[],
): void {
  if (scheduledIds.length === 0) return;
  const totalMs = scheduledIds.length * 50 + 300 + 200;
  setTimeout(() => {
    if (get().newDetectionIds === scheduledIds) {
      set({ newDetectionIds: [] });
    }
  }, totalMs);
}

export const useSessionStore = create<SessionState>((set, get) => ({
  captureStatus: "idle",
  currentSessionId: null,
  capturedText: [],
  detections: [],
  newDetectionIds: [],
  error: null,

  clipText: null,
  clipAnalyzing: false,
  clipError: null,

  lastSavedAt: null,

  modelDownloadProgress: null,

  isAudioCapturing: false,
  audioError: null,

  settings: { ...DEFAULT_SETTINGS },
  settingsLoaded: false,

  captureMode: "live",
  // Pattern detection is always on — no longer a user preference.
  // Kept in the store as a runtime flag for components that still read it,
  // but never persisted to disk and never flipped off from the UI.
  autoAnalyse: true,
  deepBuffer: [],
  deepAccumulationStart: null,
  deepAnalyzing: false,
  deepTimerSeconds: 0,
  autoAnalyseRunning: false,
  lastAutoAnalysedLength: 0,
  setLastAutoAnalysedLength: (n) => set({ lastAutoAnalysedLength: n }),
  recordAudio: true,
  audioSessionId: null,
  selectedSourceType: undefined,
  setSelectedSourceType: (v) => set({ selectedSourceType: v }),
  ritualEntry: null,
  ritualExit: null,
  showEntryCard: false,
  showExitCard: false,
  setRitualEntry: (data) => set({ ritualEntry: data }),
  setRitualExit: (data) => set({ ritualExit: data }),
  setShowEntryCard: (show) => set({ showEntryCard: show }),
  setShowExitCard: (show) => set({ showExitCard: show }),

  setCaptureStatus: (status) => {
    set({ captureStatus: status, error: null });
    // Generate a stable session ID when capture starts
    if (status === "capturing" && !get().currentSessionId) {
      set({ currentSessionId: `session-${Date.now()}` });
    }
  },
  setAudioCapturing: (running) => {
    set({ isAudioCapturing: running });
    // Generate a stable session ID when audio capture starts
    if (running && !get().currentSessionId) {
      set({ currentSessionId: `session-${Date.now()}` });
    }
  },
  setAudioError: (error) => set({ audioError: error }),

  addCapturedText: (segment) =>
    set((state) => {
      const now = Date.now();
      const newSeg: CapturedSegment = {
        text: segment.text,
        source: segment.source,
        timestamp: segment.timestamp,
        capturedAt: now,
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
        ...(segment.hasOverlap ? { hasOverlap: segment.hasOverlap } : {}),
        ...(segment.overlapSpeakers?.length ? { overlapSpeakers: segment.overlapSpeakers } : {}),
      };

      // Deep mode: accumulate in buffer, not in capturedText
      if (state.captureMode === "deep") {
        return {
          deepBuffer: [...state.deepBuffer, newSeg],
          deepAccumulationStart: state.deepAccumulationStart ?? now,
        };
      }

      const cutoff = now - BUFFER_MAX_MS;
      const pruned = state.capturedText.filter((s) => s.capturedAt >= cutoff);
      return {
        capturedText: [...pruned, newSeg],
      };
    }),

  addDetections: (detections) =>
    set((state) => ({ detections: [...state.detections, ...detections] })),

  setError: (error) => set({ error }),

  clearSession: () => {
    set({
      currentSessionId: null,
      capturedText: [],
      detections: [],
      newDetectionIds: [],
      error: null,
      audioSessionId: null,
      lastAutoAnalysedLength: 0,
      selectedSourceType: undefined,
      ritualEntry: null,
      ritualExit: null,
      showEntryCard: false,
      showExitCard: false,
    });
    api.deleteDraft().catch(() => {});
  },

  analyzeClip: async (text: string) => {
    const sessionId = get().currentSessionId ?? `clip-${Date.now()}`;
    set({
      clipText: text,
      clipAnalyzing: true,
      clipError: null,
      detections: [],
      newDetectionIds: [],
      currentSessionId: sessionId,
    });

    try {
      const detections = await api.analyze(text, sessionId);
      const newIds = detections.map((d) => d.id);
      set({ detections, newDetectionIds: newIds, clipAnalyzing: false });
      scheduleClearNewIds(set, get, newIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      set({ clipError: message, clipAnalyzing: false });
    }
  },

  // Analysis on the current live text.
  //
  //   mode = "replace" — overwrite the existing detections. Use when the user
  //     explicitly clicks Analyse / Re-analyse: they asked for a fresh result.
  //   mode = "merge" — union new detections with existing ones, deduped by
  //     (patternId, phrasePosition). Use for the auto-analyse timer tick so
  //     previously-surfaced annotations don't flicker out when the probabilistic
  //     backend returns a slightly smaller set on the next call. Preserves the
  //     UX promise: annotations appear and stay during a live session.
  //
  // Default is "replace" for backward compatibility with existing call sites.
  //
  // After state update, the ids of genuinely new detections (absent from the
  // previous set) are recorded in `newDetectionIds` so the renderer can fade
  // them in one by one instead of flashing all at once.
  analyzeLive: async (text: string, mode: "replace" | "merge" = "replace") => {
    if (!text.trim()) return;
    const prevIds = new Set(get().detections.map((d) => d.id));
    set({ clipAnalyzing: true, clipError: null });
    try {
      const sessionId = get().currentSessionId ?? `live-${Date.now()}`;
      const detections = await api.analyze(text, sessionId);
      let finalSet: DetectionInstance[];
      if (mode === "merge") {
        const existing = get().detections;
        const seen = new Set<string>();
        const merged: DetectionInstance[] = [];
        // Existing first so their ids/timestamps take precedence on duplicates.
        for (const d of existing) {
          const key = `${d.patternId}@${d.phrasePosition.start}:${d.phrasePosition.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(d);
        }
        for (const d of detections) {
          const key = `${d.patternId}@${d.phrasePosition.start}:${d.phrasePosition.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(d);
        }
        finalSet = merged;
      } else {
        finalSet = detections;
      }
      const newIds = finalSet.filter((d) => !prevIds.has(d.id)).map((d) => d.id);
      set({ detections: finalSet, newDetectionIds: newIds, clipAnalyzing: false });
      scheduleClearNewIds(set, get, newIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      set({ clipError: message, clipAnalyzing: false });
    }
  },

  resetClip: () =>
    set({
      clipText: null,
      clipAnalyzing: false,
      clipError: null,
      detections: [],
      currentSessionId: null,
    }),

  loadSavedSession: async (sessionId: string) => {
    try {
      const session = await api.loadSession(sessionId);
      set({
        clipText: session.text,
        clipAnalyzing: false,
        clipError: null,
        detections: session.detections,
        currentSessionId: session.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load session";
      set({ clipError: message });
    }
  },

  setModelDownloadProgress: (progress) => set({ modelDownloadProgress: progress }),

  setCaptureMode: (mode) => {
    const state = get();
    // When switching FROM deep mode, flush pending buffer into capturedText
    if (state.captureMode === "deep" && mode !== "deep" && state.deepBuffer.length > 0) {
      set((s) => ({
        capturedText: [...s.capturedText, ...s.deepBuffer],
        deepBuffer: [],
        deepAccumulationStart: null,
        deepAnalyzing: false,
        deepTimerSeconds: 0,
        captureMode: mode,
      }));
    } else {
      set({
        captureMode: mode,
        deepBuffer: [],
        deepAccumulationStart: null,
        deepAnalyzing: false,
        deepTimerSeconds: 0,
      });
    }
  },

  setAutoAnalyse: (on) => set({ autoAnalyse: on }),

  setDeepTimerSeconds: (s) => set({ deepTimerSeconds: s }),

  flushDeepBuffer: async () => {
    const state = get();
    if (state.deepBuffer.length === 0 || state.deepAnalyzing) return;

    // Immediately show raw buffer in transcript as placeholder
    const rawSegments = state.deepBuffer.map((seg) => ({ ...seg }));
    const rawCount = rawSegments.length;
    set((s) => ({
      deepAnalyzing: true,
      capturedText: [...s.capturedText, ...rawSegments],
      deepBuffer: [],
      deepAccumulationStart: null,
      deepTimerSeconds: 0,
    }));

    const text = rawSegments.map((s) => s.text).join(" ");
    const sessionId = `deep-${Date.now()}`;

    try {
      const result = await api.analyzeDeep(text, sessionId);
      const now = Date.now();

      // Convert LLM speaker-attributed segments into CapturedSegments
      const newSegments: CapturedSegment[] = result.segments.map((seg, i) => ({
        text: seg.text,
        source: rawSegments[0]?.source ?? "Incoming Audio",
        timestamp: (rawSegments[0]?.timestamp ?? Math.floor(now / 1000)) + i,
        capturedAt: (state.deepAccumulationStart ?? now) + i * 1000,
        speaker: seg.speaker,
      }));

      // Replace raw placeholders with speaker-attributed segments
      set((s) => ({
        capturedText: [...s.capturedText.slice(0, s.capturedText.length - rawCount), ...newSegments],
        deepAnalyzing: false,
      }));
    } catch (err) {
      console.error("[DEEP] Speaker attribution failed, keeping raw segments:", err);
      // Raw segments are already in capturedText — just clear the flag
      set({ deepAnalyzing: false });
    }
  },

  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      set({ settings: merged, settingsLoaded: true });

      // Sync to display store
      const displayStore = useDisplayStore.getState();
      displayStore.setConfidenceFloor(merged.confidenceFloor);
      const allCats: PatternCategory[] = [
        "manipulation", "authority", "fallacy", "emotional",
        "framing", "narrative", "cognitive-bias",
      ];
      for (const cat of allCats) {
        displayStore.setCategoryVisible(cat, merged.enabledCategories.includes(cat));
      }
    } catch {
      set({ settingsLoaded: true });
    }
  },

  saveSettings: async (settings: FidesSettings) => {
    set({ settings });
    try {
      await api.saveSettings(settings);
    } catch (err) {
      console.error("[SETTINGS] Failed to save:", err);
    }
  },

  updateSetting: <K extends keyof FidesSettings>(key: K, value: FidesSettings[K]) => {
    const current = get().settings;
    const updated = { ...current, [key]: value };
    set({ settings: updated });
    api.saveSettings(updated).catch((err) => {
      console.error("[SETTINGS] Failed to save:", err);
    });
  },

  setRecordAudio: (on: boolean) => set({ recordAudio: on }),
  setAudioSessionId: (id: string | null) => set({ audioSessionId: id }),

  saveDraft: async () => {
    const s = get();
    if (s.capturedText.length === 0) return;
    try {
      await api.saveDraft({
        segments: s.capturedText,
        detections: s.detections,
        captureMode: s.captureMode,
        audioSessionId: s.audioSessionId,
        currentSessionId: s.currentSessionId,
        recordAudio: s.recordAudio,
        createdAt: s.capturedText[0]?.capturedAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("[DRAFT] Failed to save:", err);
    }
  },

  loadDraft: async () => {
    try {
      const draft = await api.loadDraft();
      if (!draft || !Array.isArray(draft.segments) || draft.segments.length === 0) return false;
      set({
        capturedText: draft.segments as CapturedSegment[],
        detections: Array.isArray(draft.detections) ? draft.detections as DetectionInstance[] : [],
        captureMode: (draft.captureMode as "capture" | "live" | "deep") ?? "live",
        audioSessionId: (draft.audioSessionId as string) ?? null,
        currentSessionId: (draft.currentSessionId as string) ?? null,
        recordAudio: (draft.recordAudio as boolean) ?? true,
      });
      return true;
    } catch {
      return false;
    }
  },

  deleteDraft: async () => {
    try { await api.deleteDraft(); } catch {}
  },

  resetSettingsToDefaults: async () => {
    const defaults = { ...DEFAULT_SETTINGS };
    set({ settings: defaults });
    try {
      await api.saveSettings(defaults);
    } catch (err) {
      console.error("[SETTINGS] Failed to save defaults:", err);
    }
  },

  getClipWindow: (windowMs: number): string => {
    const segments = get().capturedText;
    if (windowMs <= 0) {
      return segments.map((s) => s.text).join("\n\n");
    }
    const cutoff = Date.now() - windowMs;
    return segments
      .filter((s) => s.capturedAt >= cutoff)
      .map((s) => s.text)
      .join("\n\n");
  },

  // Check-ins
  checkIns: [],
  addCheckIn: (c) => {
    set((s) => ({ checkIns: [c, ...s.checkIns] }));
    api.saveCheckIn(c).catch((err) => console.error("[CHECKIN] Failed to save:", err));
    // Patch session file if check-in is linked to a session
    if (c.sessionId && (c.context === "before" || c.context === "after")) {
      api.loadSession(c.sessionId).then((session) => {
        const existing = Array.isArray(session.checkIns) ? session.checkIns : [];
        if (!existing.some((e) => e.id === c.id)) {
          api.patchSession(c.sessionId!, { checkIns: [...existing, c] }).catch((err) =>
            console.error("[CHECKIN] Failed to patch session:", err)
          );
          set({ lastSavedAt: Date.now() });
        }
      }).catch(() => {
        // Session not saved yet — will be attached at save time
      });
    }
  },
  loadCheckIns: async () => {
    try {
      const checkIns = await api.getCheckIns();
      set({ checkIns });
    } catch { /* silent */ }
  },
}));

/**
 * Initialize Tauri event listeners for the session store.
 * Call this once on app mount. Returns a cleanup function that
 * unsubscribes all listeners.
 */
export async function initSessionListeners(): Promise<() => void> {
  const unlisteners: Array<() => void> = [];

  // Listen for capture status changes from the Rust backend
  const unlistenStatus = await listen<string>(
    "fides://capture-status",
    (event) => {
      console.log("[SESSION] raw event:", JSON.stringify(event));
      console.log("[SESSION] capture-status event:", event.payload);
      let status: string = event.payload;
      // Handle Tauri v2 double-serialization of string payloads
      // event.payload may arrive as '"capturing"' rather than 'capturing'
      if (typeof status === "string" && status.startsWith('"')) {
        try {
          status = JSON.parse(status) as string;
        } catch {
          // keep original
        }
      }
      if (
        status === "idle" ||
        status === "capturing" ||
        status === "paused"
      ) {
        useSessionStore.getState().setCaptureStatus(status);
      }
    },
  );
  unlisteners.push(unlistenStatus);

  // Listen for annotation results from the capture pipeline
  const unlistenAnnotations = await listen<string>(
    "fides://annotations",
    (event) => {
      try {
        // The payload is a JSON string of DetectionInstance[]
        // The Rust backend emits it as a string via app_handle.emit()
        const payload = event.payload;
        const detections: DetectionInstance[] =
          typeof payload === "string"
            ? (JSON.parse(payload) as DetectionInstance[])
            : (payload as unknown as DetectionInstance[]);

        if (Array.isArray(detections) && detections.length > 0) {
          useSessionStore.getState().addDetections(detections);
        }
      } catch (err) {
        console.error("[SESSION] Failed to parse annotations:", err);
      }
    },
  );
  unlisteners.push(unlistenAnnotations);

  // Listen for transcript events from the audio capture pipeline
  const unlistenTranscript = await listen<string>(
    "fides://transcript",
    (event) => {
      try {
        const payload = event.payload;
        const data =
          typeof payload === "string"
            ? (JSON.parse(payload) as {
                text: string;
                source: string;
                timestamp: number;
                speaker?: string;
                has_overlap?: boolean;
                overlap_speakers?: string[];
              })
            : (payload as unknown as {
                text: string;
                source: string;
                timestamp: number;
                speaker?: string;
                has_overlap?: boolean;
                overlap_speakers?: string[];
              });

        if (data.text) {
          const seg: { text: string; source: string; timestamp: number; speaker?: string; hasOverlap?: boolean; overlapSpeakers?: string[] } = {
            text: data.text,
            source: data.source,
            timestamp: data.timestamp,
          };
          if (data.speaker) seg.speaker = data.speaker;
          if (data.has_overlap) seg.hasOverlap = data.has_overlap;
          if (data.overlap_speakers?.length) seg.overlapSpeakers = data.overlap_speakers;
          useSessionStore.getState().addCapturedText(seg);
        }
      } catch (err) {
        console.error("[SESSION] Failed to parse transcript event:", err);
      }
    },
  );
  unlisteners.push(unlistenTranscript);

  // Listen for model download progress
  const unlistenModelProgress = await listen<string>(
    "fides://model-download-progress",
    (event) => {
      try {
        const payload = event.payload;
        const data =
          typeof payload === "string"
            ? (JSON.parse(payload) as { downloaded: number; total: number })
            : (payload as unknown as { downloaded: number; total: number });
        useSessionStore.getState().setModelDownloadProgress(data);
      } catch {
        // ignore
      }
    },
  );
  unlisteners.push(unlistenModelProgress);

  // Listen for capture errors
  const unlistenError = await listen<string>(
    "fides://capture-error",
    (event) => {
      let msg: string = event.payload;
      if (typeof msg === "string" && msg.startsWith('"')) {
        try { msg = JSON.parse(msg) as string; } catch {}
      }
      useSessionStore.getState().setAudioError(msg);
    },
  );
  unlisteners.push(unlistenError);

  // Listen for audio session ID (emitted when archiver starts recording)
  const unlistenAudioId = await listen<string>(
    "fides://audio-session-id",
    (event) => {
      let id: string = event.payload;
      if (typeof id === "string" && id.startsWith('"')) {
        try { id = JSON.parse(id) as string; } catch {}
      }
      useSessionStore.getState().setAudioSessionId(id);
    },
  );
  unlisteners.push(unlistenAudioId);

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}