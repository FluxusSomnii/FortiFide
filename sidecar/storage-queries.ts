/**
 * Fides Storage Query Layer
 *
 * Read-only query functions on top of the existing JSON file storage.
 * Does NOT change how files are written to disk.
 * Used by GET /export and future DreamOS integration.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { getPattern } from "@fides/pattern-library";
import type {
  FidesSession,
  FidesPattern,
  FidesSpeaker,
  FidesAudioInfo,
  FidesExportPackage,
} from "../src/lib/api-types.js";

// Re-export types for consumers
export type {
  FidesSession,
  FidesPattern,
  FidesSpeaker,
  FidesAudioInfo,
  FidesExportPackage,
};

const settingsDir = join(homedir(), ".fides");
const sessionsDir = join(settingsDir, "sessions");

// ─── Helpers ───

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type RawSession = Record<string, unknown>;

async function loadAllRawSessions(): Promise<RawSession[]> {
  await mkdir(sessionsDir, { recursive: true });
  const files = await readdir(sessionsDir);
  const sessions: RawSession[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const data = await readJsonFile<RawSession>(join(sessionsDir, file));
    if (data) sessions.push(data);
  }
  return sessions;
}

function wordCount(s: RawSession): number {
  const wc = s.wordCount as number | undefined;
  if (wc !== undefined) return wc;
  const text = (s.text as string) ?? "";
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sessionCreatedAtMs(s: RawSession): number {
  return new Date(String(s.createdAt)).getTime();
}

function periodCutoff(period: string): number {
  const now = Date.now();
  switch (period) {
    case "7d": return now - 7 * 86400000;
    case "30d": return now - 30 * 86400000;
    case "90d": return now - 90 * 86400000;
    default: return 0;
  }
}

function uniqueSpeakers(s: RawSession): string[] {
  const segs = (s.segments ?? []) as Array<{ speaker?: string }>;
  return [...new Set(segs.map((seg) => seg.speaker ?? "Unknown"))];
}

function rawToFidesSession(s: RawSession): FidesSession {
  const wc = wordCount(s);
  const dets = Array.isArray(s.detections) ? s.detections : [];
  const checkIns = Array.isArray(s.checkIns) ? s.checkIns : [];
  const speakers = uniqueSpeakers(s);

  return {
    id: String(s.id),
    createdAt: String(s.createdAt),
    modifiedAt: s.modifiedAt ? String(s.modifiedAt) : undefined,
    name: (s.name as string) ?? undefined,
    sourceType: (s.sourceType as string) ?? undefined,
    wordCount: wc,
    durationEstimatedMinutes: Math.round((wc / 130) * 10) / 10,
    speakers,
    patternCount: dets.length,
    hasAudio: !!(s.hasAudio ?? s.audioSessionId),
    hasMicAudio: !!(s.hasMicAudio),
    hasSystemAudio: !!(s.hasSystemAudio),
    audioSessionId: (s.audioSessionId as string) ?? undefined,
    edited: !!(s.edited),
    colorTag: (s.colorTag as string) ?? undefined,
    hashtags: Array.isArray(s.hashtags) ? (s.hashtags as string[]) : [],
    checkInCount: checkIns.length,
    captureMode: (s.captureMode as string) ?? undefined,
  };
}

// ─── Query: All Sessions ───

export async function getAllSessions(filter?: {
  period?: "7d" | "30d" | "90d" | "all";
  sourceType?: string;
  hasAudio?: boolean;
  hasPatternsOnly?: boolean;
}): Promise<FidesSession[]> {
  let raw = await loadAllRawSessions();

  if (filter?.period && filter.period !== "all") {
    const cutoff = periodCutoff(filter.period);
    raw = raw.filter((s) => sessionCreatedAtMs(s) >= cutoff);
  }

  if (filter?.sourceType) {
    raw = raw.filter((s) => s.sourceType === filter.sourceType);
  }

  if (filter?.hasAudio !== undefined) {
    raw = raw.filter((s) => !!(s.hasAudio ?? s.audioSessionId) === filter.hasAudio);
  }

  if (filter?.hasPatternsOnly) {
    raw = raw.filter((s) => {
      const dets = Array.isArray(s.detections) ? s.detections : [];
      return dets.length > 0;
    });
  }

  const sessions = raw.map(rawToFidesSession);
  sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sessions;
}

// ─── Query: Single Session ───

export async function getSession(id: string): Promise<FidesSession | null> {
  const filePath = join(sessionsDir, `${sanitizeFilename(id)}.json`);
  const data = await readJsonFile<RawSession>(filePath);
  return data ? rawToFidesSession(data) : null;
}

// ─── Query: All Patterns (flat, denormalized) ───

export async function getAllPatterns(filter?: {
  sessionIds?: string[];
  patternId?: string;
  category?: string;
  tier?: "strong" | "likely" | "possible";
  period?: "7d" | "30d" | "90d" | "all";
}): Promise<FidesPattern[]> {
  let raw = await loadAllRawSessions();

  if (filter?.period && filter.period !== "all") {
    const cutoff = periodCutoff(filter.period);
    raw = raw.filter((s) => sessionCreatedAtMs(s) >= cutoff);
  }

  if (filter?.sessionIds) {
    const idSet = new Set(filter.sessionIds);
    raw = raw.filter((s) => idSet.has(String(s.id)));
  }

  const patterns: FidesPattern[] = [];

  for (const s of raw) {
    const sessionId = String(s.id);
    const sessionCreatedAt = String(s.createdAt);
    const dets = (s.detections ?? []) as Array<{
      patternId: string; confidence: number; confidenceTier: string;
      phrase: string; speaker?: string; timestamp: string;
    }>;

    for (const d of dets) {
      if (filter?.patternId && d.patternId !== filter.patternId) continue;
      if (filter?.tier && d.confidenceTier !== filter.tier) continue;

      const pat = getPattern(d.patternId);
      const category = pat?.category ?? "framing";
      if (filter?.category && category !== filter.category) continue;

      patterns.push({
        sessionId,
        sessionCreatedAt,
        patternId: d.patternId,
        patternName: pat?.name ?? d.patternId.replace(/-/g, " "),
        category,
        confidence: d.confidence,
        confidenceTier: d.confidenceTier as FidesPattern["confidenceTier"],
        speaker: d.speaker,
        textExcerpt: d.phrase,
        capturedAt: d.timestamp ? new Date(d.timestamp).getTime() : undefined,
      });
    }
  }

  return patterns;
}

// ─── Query: Speaker Stats ───

export async function getSpeakerStats(sessionId?: string): Promise<FidesSpeaker[]> {
  let raw: RawSession[];

  if (sessionId) {
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);
    const data = await readJsonFile<RawSession>(filePath);
    raw = data ? [data] : [];
  } else {
    raw = await loadAllRawSessions();
  }

  const speakers: FidesSpeaker[] = [];

  for (const s of raw) {
    const sid = String(s.id);
    const segs = (s.segments ?? []) as Array<{ speaker?: string; text: string; capturedAt: number }>;
    const map = new Map<string, { turns: number; words: number; firstAt: number }>();

    for (const seg of segs) {
      const label = seg.speaker ?? "Unknown";
      const entry = map.get(label) ?? { turns: 0, words: 0, firstAt: seg.capturedAt };
      entry.turns++;
      entry.words += seg.text.trim().split(/\s+/).filter(Boolean).length;
      if (seg.capturedAt < entry.firstAt) entry.firstAt = seg.capturedAt;
      map.set(label, entry);
    }

    for (const [label, info] of map) {
      speakers.push({
        sessionId: sid,
        label,
        turnCount: info.turns,
        totalWords: info.words,
        firstAppearance: info.firstAt || undefined,
      });
    }
  }

  return speakers;
}

// ─── Query: Audio Info ───

export async function getAudioInfo(sessionId: string): Promise<FidesAudioInfo | null> {
  const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);
  const data = await readJsonFile<RawSession>(filePath);
  if (!data) return null;

  const audioSessionId = (data.audioSessionId as string) ?? sessionId;
  const audioDir = join(sessionsDir, sanitizeFilename(audioSessionId));

  let hasMic = false;
  let hasSys = false;
  let micPath: string | undefined;
  let sysPath: string | undefined;

  try {
    await stat(join(audioDir, "mic.wav"));
    hasMic = true;
    micPath = join(audioDir, "mic.wav");
  } catch { /* no mic file */ }

  try {
    await stat(join(audioDir, "system.wav"));
    hasSys = true;
    sysPath = join(audioDir, "system.wav");
  } catch { /* no system file */ }

  if (!hasMic && !hasSys) return null;

  return {
    sessionId,
    audioSessionId,
    hasMic,
    hasSys,
    micPath,
    sysPath,
  };
}

// ─── Export: Full Package ───

export async function exportAll(period?: "7d" | "30d" | "90d" | "all"): Promise<FidesExportPackage> {
  const filterPeriod = period ?? "all";

  const [sessions, patterns, speakers, checkins, synthesis] = await Promise.all([
    getAllSessions({ period: filterPeriod }),
    getAllPatterns({ period: filterPeriod }),
    getSpeakerStats(),
    readJsonFile<unknown[]>(join(settingsDir, "checkins.json")).then((d) => d ?? []),
    readJsonFile<unknown[]>(join(settingsDir, "synthesis.json")).then((d) => d ?? []),
  ]);

  // Filter speakers to match the period-filtered sessions
  const sessionIdSet = new Set(sessions.map((s) => s.id));
  const filteredSpeakers = speakers.filter((sp) => sessionIdSet.has(sp.sessionId));

  return {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    sessions,
    patterns,
    speakers: filteredSpeakers,
    checkins,
    synthesis,
  };
}
