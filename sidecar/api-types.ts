/**
 * Fides Public API — Type Definitions
 *
 * These types define the JSON shapes returned by /api/* routes.
 * Designed for external consumers (DreamOS, third-party tools).
 * Internal UI uses the existing /sessions, /library, etc. routes.
 */

// ─── Confidence ───

export type ConfidenceTier = "possible" | "likely" | "strong";

export type PatternCategory =
  | "manipulation"
  | "authority"
  | "fallacy"
  | "emotional"
  | "framing"
  | "narrative"
  | "cognitive-bias";

export type SourceType =
  | "podcast"
  | "news"
  | "conversation"
  | "ai-assistant"
  | "lecture"
  | "meeting"
  | "social-media"
  | "other";

// ─── Pattern Detection (within a session) ───

export interface ApiPatternDetection {
  /** Unique detection ID */
  id: string;
  /** Pattern identifier (e.g. "appeal-to-authority") */
  patternId: string;
  /** Human-readable pattern name */
  patternName: string;
  /** Category of the pattern */
  category: PatternCategory;
  /** Confidence score 0–1 */
  confidence: number;
  /** Confidence tier */
  confidenceTier: ConfidenceTier;
  /** Matched text excerpt */
  phrase: string;
  /** Character range in the full transcript text */
  phrasePosition: { start: number; end: number };
  /** Speaker who produced this phrase (if known) */
  speaker?: string | undefined;
  /** ISO timestamp of when the segment was captured */
  timestamp: string;
}

// ─── Speaker Metadata ───

export interface ApiSpeaker {
  /** Speaker label (e.g. "MIC", "PERSON 1") */
  label: string;
  /** Display name if user-renamed via speakerMap */
  displayName?: string | undefined;
  /** Number of transcript segments by this speaker */
  turnCount: number;
  /** Total speech duration in seconds (estimated from segment timestamps) */
  totalSpeechSeconds: number;
  /** Number of pattern detections attributed to this speaker */
  patternCount: number;
}

// ─── Audio Archive Metadata ───

export interface ApiAudioInfo {
  /** Whether any audio archive exists */
  hasAudio: boolean;
  /** Mic track info (null if not present) */
  mic: { sizeBytes: number; url: string } | null;
  /** System track info (null if not present) */
  system: { sizeBytes: number; url: string } | null;
  /** Audio session ID (used to locate the archive directory) */
  audioSessionId?: string | undefined;
}

// ─── Session Summary (list item) ───

export interface ApiSessionSummary {
  id: string;
  createdAt: string;
  name?: string | undefined;
  /** Short preview of transcript text */
  textPreview: string;
  /** Duration in seconds (first to last segment) */
  durationSeconds: number;
  /** Total word count */
  wordCount: number;
  /** Number of distinct speakers */
  speakerCount: number;
  /** Total pattern detections */
  patternCount: number;
  /** Whether audio archive exists */
  hasAudio: boolean;
  hasMicAudio: boolean;
  hasSystemAudio: boolean;
  /** Session source type */
  sourceType?: SourceType | undefined;
  /** Color tag */
  colorTag?: string | null | undefined;
  /** User-applied hashtags */
  hashtags: string[];
  /** Whether session transcript was edited */
  edited: boolean;
}

// ─── Full Session Detail ───

export interface ApiSessionDetail extends ApiSessionSummary {
  /** Full transcript text */
  text: string;
  /** Transcript segments with timing and speaker info */
  segments: Array<{
    text: string;
    source: string;
    speaker?: string | undefined;
    capturedAt: number;
    timestamp: number;
  }>;
  /** All pattern detections in this session */
  patterns: ApiPatternDetection[];
  /** Speaker breakdown */
  speakers: ApiSpeaker[];
  /** Audio archive metadata */
  audio: ApiAudioInfo;
  /** Check-in data (if any) */
  checkIns: Array<{
    type: "before" | "after";
    energy: number;
    clarity: number;
    groundedness: number;
    openness: number;
    timestamp: string;
  }>;
}

// ─── Cross-Session Pattern Aggregate ───

export interface ApiPatternAggregate {
  /** Pattern identifier */
  patternId: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: PatternCategory;
  /** Neutral definition */
  definition: string;
  /** Total detections across all sessions */
  totalDetections: number;
  /** Breakdown by confidence tier */
  confidenceTiers: { strong: number; likely: number; possible: number };
  /** Number of sessions containing this pattern */
  sessionCount: number;
  /** Session IDs where this pattern was detected */
  sessionIds: string[];
  /** Most recent detection timestamp */
  lastSeenAt: string;
}

// ─── API Response Wrappers ───

export interface ApiSessionListResponse {
  sessions: ApiSessionSummary[];
  total: number;
}

export interface ApiPatternListResponse {
  patterns: ApiPatternAggregate[];
  total: number;
}

export interface ApiAudioMetadataResponse extends ApiAudioInfo {
  sessionId: string;
}
