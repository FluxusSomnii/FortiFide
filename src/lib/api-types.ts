/**
 * Fides Export Types — Canonical shapes for downstream consumers.
 *
 * Used by: storage-queries.ts (sidecar), GET /export endpoint,
 * DreamOS feed layer, third-party integrations.
 *
 * These are FLAT, self-contained types — no internal IDs or refs
 * that require Fides internals to interpret.
 */

// ─── Session (flat summary, no transcript text) ───

export interface FidesSession {
  id: string;
  createdAt: string;
  modifiedAt?: string | undefined;
  name?: string | undefined;
  sourceType?: string | undefined;
  wordCount: number;
  durationEstimatedMinutes: number;
  speakers: string[];
  patternCount: number;
  hasAudio: boolean;
  hasMicAudio: boolean;
  hasSystemAudio: boolean;
  audioSessionId?: string | undefined;
  edited: boolean;
  colorTag?: string | undefined;
  hashtags: string[];
  checkInCount: number;
  captureMode?: string | undefined;
}

// ─── Pattern detection (denormalized — one row per detection) ───

export interface FidesPattern {
  sessionId: string;
  sessionCreatedAt: string;
  patternId: string;
  patternName: string;
  category: string;
  confidence: number;
  confidenceTier: "strong" | "likely" | "possible";
  speaker?: string | undefined;
  textExcerpt: string;
  capturedAt?: number | undefined;
}

// ─── Speaker stats (aggregated per speaker per session) ───

export interface FidesSpeaker {
  sessionId: string;
  label: string;
  turnCount: number;
  totalWords: number;
  firstAppearance?: number | undefined;
}

// ─── Audio file info ───

export interface FidesAudioInfo {
  sessionId: string;
  audioSessionId: string;
  hasMic: boolean;
  hasSys: boolean;
  micPath?: string | undefined;
  sysPath?: string | undefined;
}

// ─── Full export package ───

export interface FidesExportPackage {
  exportedAt: string;
  version: "1.0";
  sessions: FidesSession[];
  patterns: FidesPattern[];
  speakers: FidesSpeaker[];
  checkins: unknown[];
  synthesis: unknown[];
}
