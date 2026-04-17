import type { DetectionInstance, PatternEntry } from "@fides/pattern-library";
import type { AccuracyFeedback, PatternAccuracy } from "@fides/feedback";

export interface SavedSession {
  id: string;
  text: string;
  detections: DetectionInstance[];
  createdAt: string;
  label?: string;
  name?: string;
  colorTag?: string | null;
  hashtags?: string[];
  sources?: string[];
  sourceType?: "podcast" | "news" | "conversation" | "ai-assistant" | "lecture" | "meeting" | "social-media" | "other";
  wordCount?: number;
  patternCount?: number;
  segments?: Array<{
    text: string;
    source: string;
    timestamp: number;
    capturedAt: number;
    speaker?: string;
    estimated?: boolean;
  }>;
  edited?: boolean;
  originalText?: string;
  originalSegments?: Array<{
    text: string;
    source: string;
    timestamp: number;
    capturedAt: number;
    speaker?: string;
  }>;
  speakerMap?: Record<string, string>;
  hasAudio?: boolean;
  hasMicAudio?: boolean;
  hasSystemAudio?: boolean;
  audioSessionId?: string;
  checkIns?: CheckIn[];
  intentionTag?: string;
  relationshipTags?: string[];
  outcomeTag?: string;
  editHistory?: Array<{
    savedAt: number;
    segments: Array<{ text: string; source: string; timestamp: number; capturedAt: number; speaker?: string }>;
    detections: DetectionInstance[];
    wordCount: number;
  }>;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  label?: string;
  name?: string;
  textPreview: string;
  detectionCount: number;
  colorTag?: string | null;
  hashtags?: string[];
  sources?: string[];
  sourceType?: "podcast" | "news" | "conversation" | "ai-assistant" | "lecture" | "meeting" | "social-media" | "other";
  wordCount?: number;
  hasAudio?: boolean;
  hasMicAudio?: boolean;
  hasSystemAudio?: boolean;
  hasCheckIns?: boolean;
  checkInCount?: number;
}

export interface FidesSettings {
  // Audio & Capture
  dedupSensitivity: "strict" | "balanced" | "minimal" | "none";
  chunkSizeSeconds: 3 | 5 | 10 | 15;
  audioSource: "microphone" | "loopback" | "both";
  noiseThreshold: number;
  transcriptionLanguage: string;

  // Analysis. Pattern detection is always on — no longer a user setting.
  contextWindowMinutes: 1 | 2 | 5 | 10;
  confidenceFloor: number;
  enabledCategories: string[];
  dailyTokenBudgetUsd: number | null;

  // Display
  timestampFormat: "exact" | "relative" | "both";
  segmentCompressionThreshold: number;
  showSourceLabels: boolean;

  // Privacy
  localOnlyMode: boolean;
  sessionAutoDeleteDays: null | 7 | 30 | 90;
  excludedWindows: string[];

  // Advanced
  whisperModel: "tiny" | "base" | "small" | "medium" | "large";
  analysisModel: string;
  humeApiKey: string | null;
  exportFormat: "json" | "text" | "markdown";

  // Diarization (kept for backward compat — mode selector replaces UI)
  huggingFaceToken: string | null;
  speakerDiarization: boolean;
  diarizationMinSpeakers: number;
  diarizationMaxSpeakers: number;

  // Microphone device
  micDevice: string | null; // device name or "none" to disable, null = system default

  // Capture modes
  captureMode: "capture" | "live" | "deep";

  // Presets
  presets: CapturePreset[];

  // Session Ritual
  lastSliderValues?: { energy: number; clarity: number; groundedness: number; openness: number; sovereignty: number; presence: number };
  customTags?: {
    intention?: string[];
    relationship?: string[];
    outcome?: string[];
  };

  // Digest
  digestSchedule?: "off" | "weekly" | "daily";
  lastDigestAt?: string;
}

export interface CapturePreset {
  id: string;
  name: string;
  isDefault: boolean;
  captureMode: "capture" | "live" | "deep";
  chunkSizeSeconds: 3 | 5 | 10 | 15;
  confidenceFloor: number;
  audioSource: "microphone" | "loopback" | "both";
  dedupSensitivity: "strict" | "balanced" | "minimal" | "none";
}

export interface CheckIn {
  id: string;
  timestamp: number;
  energy: number;
  clarity: number;
  groundedness: number;
  openness: number;
  sovereignty?: number | undefined;
  presence?: number | undefined;
  context: "before" | "after" | "standalone";
  sessionId?: string;
  note?: string;
}

export interface DataSummary {
  totalSessions: number;
  totalWords: number;
  totalPatterns: number;
  totalHours: number;
  sessionsWithAudio: number;
  sessionsWithCheckIns: number;
  sessionsEdited: number;
  priorPeriod: { totalSessions: number; totalPatterns: number; totalWords: number };
  patternFrequency: Array<{
    patternId: string;
    count: number;
    confidenceTiers: { strong: number; likely: number; possible: number };
    sessionIds: string[];
  }>;
  categoryBreakdown: Record<string, number>;
  sourceBreakdown: Record<string, { sessionCount: number; patternCount: number; wordCount: number }>;
  sourceTypeBreakdown: Record<string, { sessionCount: number; patternCount: number; wordCount: number }>;
  weeklyActivity: Array<{ weekStart: number; sessionCount: number; patternCount: number; wordCount: number; annotationDensity: number; sessionIds: string[] }>;
  sessionTimeline: Array<{ id: string; name: string; timestamp: number; durationHours: number; patternCount: number }>;
  drift: Array<{ patternId: string; currentCount: number; priorCount: number; deltaPercent: number; sessionIds: string[] }>;
  checkInSummary: {
    totalCheckIns: number;
    averages: { energy: number; clarity: number; groundedness: number; openness: number };
    recentTrend: "up" | "down" | "stable";
  } | null;
  checkInCorrelations: Array<{
    sourceType: string;
    sessionCount: number;
    meanDeltas: { energy: number; clarity: number; groundedness: number; openness: number; overall: number };
    sessionIds: string[];
  }>;
  resilienceProfile: Array<{
    observation: string;
    supportingSessionCount: number;
    sessionIds: string[];
  }>;
  absentPatterns: Array<{ patternId: string; name: string; category: string }>;
  sovereignty: { capturedHours: number; periodHours: number; offlinePercent: number; firstSessionAt?: number | undefined };
  speakerRatio?: { micWords: number; totalWords: number; micPercent: number } | undefined;
  questionRatio?: number | undefined;
  sovereigntyTrend?: Array<{ sessionId: string; date: string; score: number }> | undefined;
  beforeAfterDeltas?: {
    energy: number | null; clarity: number | null; groundedness: number | null;
    openness: number | null; sovereignty: number | null; presence: number | null;
    sessionCount: number;
  } | null | undefined;
}

export interface CorrelationData {
  // Per-pattern average state deltas on sessions where the pattern occurred.
  // Not a statistical correlation — named "co-occurrence" to reflect that.
  patternStateCoOccurrences: Array<{
    patternId: string;
    sessionCount: number;
    meanDeltas: { energy: number; clarity: number; groundedness: number; openness: number; sovereignty: number | null; presence: number | null };
    sessionIds: string[];
  }>;
  sourceTypeImpact: Array<{
    sourceType: string;
    sessionCount: number;
    sessionsWithPairs: number;
    sovereigntyDelta: number | null;
    groundednessDelta: number | null;
    dominantPattern: string | null;
    dominantPatternCount: number;
    sessionIds: string[];
  }>;
  intentionOutcomeMatrix: Array<{
    intentionTag: string;
    outcomeTag: string;
    count: number;
    sessionIds: string[];
  }>;
  allIntentionTags: string[];
  allOutcomeTags: string[];
  relationshipSovereignty?: Array<{
    relationshipTag: string;
    sessionCount: number;
    meanSovereigntyDelta: number | null;
    sessionIds: string[];
  }> | undefined;
  micPatternFrequency?: Array<{
    patternId: string;
    count: number;
    sessionIds: string[];
  }> | undefined;
}

export interface DigestSection {
  title: string;
  body: string;
}

export interface DigestData {
  generatedAt: string;
  period: string;
  sections: DigestSection[];
}

export const DEFAULT_SETTINGS: FidesSettings = {
  dedupSensitivity: "balanced",
  chunkSizeSeconds: 5,
  audioSource: "loopback",
  noiseThreshold: 0.1,
  transcriptionLanguage: "auto",
  contextWindowMinutes: 2,
  confidenceFloor: 0.4,
  enabledCategories: [
    "manipulation", "authority", "fallacy", "emotional",
    "framing", "narrative", "cognitive-bias",
  ],
  dailyTokenBudgetUsd: null,
  timestampFormat: "exact",
  segmentCompressionThreshold: 500,
  showSourceLabels: true,
  localOnlyMode: false,
  sessionAutoDeleteDays: null,
  excludedWindows: [],
  whisperModel: "large",
  analysisModel: "claude-sonnet-4-20250514",
  humeApiKey: null,
  exportFormat: "json",
  huggingFaceToken: null,
  micDevice: null,
  speakerDiarization: false,
  diarizationMinSpeakers: 1,
  diarizationMaxSpeakers: 5,
  captureMode: "live",
  presets: [
    {
      id: "interview",
      name: "Interview",
      isDefault: true,
      captureMode: "deep",
      chunkSizeSeconds: 5,
      confidenceFloor: 0.4,
      audioSource: "both",
      dedupSensitivity: "balanced",
    },
    {
      id: "meeting",
      name: "Meeting",
      isDefault: true,
      captureMode: "live",
      chunkSizeSeconds: 5,
      confidenceFloor: 0.5,
      audioSource: "loopback",
      dedupSensitivity: "strict",
    },
    {
      id: "lecture",
      name: "Lecture",
      isDefault: true,
      captureMode: "capture",
      chunkSizeSeconds: 10,
      confidenceFloor: 0.6,
      audioSource: "loopback",
      dedupSensitivity: "strict",
    },
    {
      id: "quick-capture",
      name: "Quick Capture",
      isDefault: true,
      captureMode: "capture",
      chunkSizeSeconds: 3,
      confidenceFloor: 0.4,
      audioSource: "loopback",
      dedupSensitivity: "none",
    },
  ],
};

const BASE = "http://127.0.0.1:19533";

async function request<T>(
  path: string,
  method: "GET" | "POST" | "DELETE" | "PATCH" = "GET",
  body?: unknown,
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  };
  if (body !== undefined && (method === "POST" || method === "PATCH" || method === "DELETE")) {
    init.body = JSON.stringify(body);
  }
  try {
    const resp = await fetch(`${BASE}${path}`, init);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`${method} ${path} failed (${resp.status}): ${errText}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const SOURCE_TYPES = [
  { value: "podcast", label: "Podcast" },
  { value: "news", label: "News / Media" },
  { value: "conversation", label: "Conversation" },
  { value: "ai-assistant", label: "AI Assistant" },
  { value: "lecture", label: "Lecture / Talk" },
  { value: "meeting", label: "Meeting" },
  { value: "social-media", label: "Social Media" },
  { value: "other", label: "Other" },
] as const;

export const SOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_TYPES.map((st) => [st.value, st.label])
);

export const api = {
  analyze: (text: string, sessionId: string) =>
    request<DetectionInstance[]>("/analyze", "POST", { text, sessionId }, 30000),

  analyzeDeep: (text: string, sessionId: string) =>
    request<{ segments: Array<{ text: string; speaker: string }> }>("/analyze-deep", "POST", { text, sessionId }, 60000),

  getLibrary: () =>
    request<PatternEntry[]>("/library"),

  getPattern: (id: string) =>
    request<PatternEntry>(`/library/${id}`),

  getStatus: () =>
    request<{ running: boolean; libraryVersion: string }>("/status"),

  submitFeedback: (feedback: AccuracyFeedback) =>
    request<{ ok: boolean }>("/feedback", "POST", feedback),

  getAccuracy: () =>
    request<PatternAccuracy[]>("/accuracy"),

  saveSession: (session: Partial<SavedSession>) =>
    request<{ ok: boolean }>("/sessions", "POST", session),

  listSessions: () =>
    request<SessionSummary[]>("/sessions"),

  loadSession: (id: string) =>
    request<SavedSession>(`/sessions/${encodeURIComponent(id)}`),

  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}`, "DELETE"),

  patchSession: (id: string, patch: Partial<SavedSession>) =>
    request<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}`, "PATCH", patch),

  getSettings: () =>
    request<FidesSettings>("/settings/all"),

  saveSettings: (settings: FidesSettings) =>
    request<{ ok: boolean }>("/settings/all", "POST", settings),

  // API settings (Anthropic key)
  getApiSettings: () =>
    request<{ apiKey: string | null }>("/settings"),
  saveApiSettings: (apiKey: string) =>
    request<{ ok: boolean }>("/settings", "POST", { apiKey }),

  // Draft session persistence
  loadDraft: () => request<Record<string, unknown>>("/draft").catch(() => null),
  saveDraft: (draft: Record<string, unknown>) => request<{ ok: true }>("/draft", "POST", draft),
  deleteDraft: () => request<{ ok: true }>("/draft", "DELETE").catch(() => ({ ok: true as const })),

  // Retranscribe cleanup (LLM transcript refinement)
  retranscribeCleanup: (segments: Array<{ text: string; speaker?: string; start: number; end: number }>, sessionId: string) =>
    request<{ segments: Array<{ text: string; speaker: string; start: number; end: number }> }>(
      "/retranscribe-cleanup", "POST", { segments, sessionId }, 60000
    ),

  // Audio URLs for dual-track player
  getSessionMicAudioUrl: (sessionId: string) =>
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/audio/mic`,
  getSessionSystemAudioUrl: (sessionId: string) =>
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/audio/system`,
  // Legacy single-track (backward compat)
  getSessionAudioUrl: (sessionId: string) =>
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/audio/system`,

  // Check-ins
  saveCheckIn: (checkIn: CheckIn) =>
    request<{ ok: boolean }>("/checkins", "POST", checkIn),
  getCheckIns: () =>
    request<CheckIn[]>("/checkins"),

  // Data summary
  getDataSummary: (period: "24h" | "7d" | "30d" | "90d" | "all" = "30d") =>
    request<DataSummary>(`/data/summary?period=${period}`, "GET", undefined, 15000),

  getCorrelations: (period: string) =>
    request<CorrelationData>(`/data/correlations?period=${period}`),

  // AI Analysis
  runAiAnalysis: (payload: {
    questions: Array<{ id: string; label: string; prompt: string }>;
    dataSummary: DataSummary;
    recentSessionPreviews: Array<{ id: string; name?: string | undefined; textPreview: string; detectionCount: number; createdAt: string }>;
  }) =>
    request<{ results: Array<{ questionId: string; answer: string; error?: string }> }>(
      "/ai-analysis", "POST", payload, 120000
    ),

  // Synthesis (stored AI insights)
  storeSynthesis: (entry: { questionId: string; questionLabel: string; answer: string; storedAt: string; period: string; context?: { patterns?: string[] | undefined; sessionIds?: string[] | undefined; sourceTypes?: string[] | undefined } | undefined }) =>
    request<{ ok: boolean; duplicate?: boolean | undefined }>("/synthesis", "POST", entry),

  getSynthesis: () =>
    request<Array<{ questionId: string; questionLabel: string; answer: string; storedAt: string; period: string; context?: { patterns?: string[] | undefined; sessionIds?: string[] | undefined; sourceTypes?: string[] | undefined } | undefined }>>("/synthesis"),

  deleteSynthesis: (questionId: string, storedAt: string) =>
    request<{ ok: boolean }>("/synthesis", "DELETE", { questionId, storedAt }),

  deleteSynthesisGroup: (entries: Array<{ questionId: string; storedAt: string }>) =>
    request<{ ok: boolean }>("/synthesis", "DELETE", { entries }),

  // Digest
  getDigest: () =>
    request<DigestData | null>("/digest"),

  generateDigest: (period: "7d" | "30d" = "7d") =>
    request<DigestData>("/digest", "POST", { period }, 120000),

  // Export (full data package for DreamOS / external consumers)
  exportData: (period?: string) =>
    request<import("./lib/api-types.js").FidesExportPackage>(
      `/export${period ? "?period=" + period : ""}`
    ),
};