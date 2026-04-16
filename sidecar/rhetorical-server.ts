import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, readdir, unlink, stat, rm } from "node:fs/promises";
import {
  loadLibrary,
  getPattern,
  LIBRARY_VERSION,
} from "@fides/pattern-library";
import {
  createJsonFeedbackStore,
  computeAccuracy,
  type AccuracyFeedback,
} from "@fides/feedback";
import { RhetoricalAnalyzer, lookupPatternId } from "./analyzer.js";
import type {
  ApiSessionSummary,
  ApiSessionDetail,
  ApiPatternDetection,
  ApiSpeaker,
  ApiAudioInfo,
  ApiPatternAggregate,
} from "./api-types.js";

const PORT = 19533;

// ─── Settings ───

const settingsDir = join(homedir(), ".fides");
const settingsPath = join(settingsDir, "settings.json");
const sessionsDir = join(settingsDir, "sessions");

interface Settings {
  apiKey?: string;
  model?: string;
}

interface FidesSettings {
  dedupSensitivity: "strict" | "balanced" | "minimal" | "none";
  chunkSizeSeconds: 3 | 5 | 10 | 15;
  audioSource: "microphone" | "loopback" | "both";
  noiseThreshold: number;
  transcriptionLanguage: string;
  autoAnalyse: boolean;
  autoAnalyseIntervalMinutes: number;
  contextWindowMinutes: 1 | 2 | 5 | 10;
  confidenceFloor: number;
  enabledCategories: string[];
  dailyTokenBudgetUsd: number | null;
  timestampFormat: "exact" | "relative" | "both";
  segmentCompressionThreshold: number;
  showSourceLabels: boolean;
  localOnlyMode: boolean;
  sessionAutoDeleteDays: null | 7 | 30 | 90;
  excludedWindows: string[];
  whisperModel: "tiny" | "base" | "small" | "medium" | "large";
  analysisModel: string;
  humeApiKey: string | null;
  exportFormat: "json" | "text" | "markdown";
  huggingFaceToken: string | null;
  speakerDiarization: boolean;
  diarizationMinSpeakers: number;
  diarizationMaxSpeakers: number;
  captureMode: "capture" | "live" | "deep";
  presets: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    captureMode: "capture" | "live" | "deep";
    autoAnalyse: boolean;
    autoAnalyseIntervalMinutes: number;
    chunkSizeSeconds: 3 | 5 | 10 | 15;
    confidenceFloor: number;
    audioSource: "microphone" | "loopback" | "both";
    dedupSensitivity: "strict" | "balanced" | "minimal" | "none";
  }>;
}

const allSettingsPath = join(settingsDir, "fides-settings.json");

async function loadAllSettings(): Promise<FidesSettings> {
  try {
    const raw = await readFile(allSettingsPath, "utf-8");
    return JSON.parse(raw) as FidesSettings;
  } catch {
    // Return defaults
    return {
      dedupSensitivity: "balanced",
      chunkSizeSeconds: 5,
      audioSource: "loopback",
      noiseThreshold: 0.1,
      transcriptionLanguage: "auto",
      autoAnalyse: false,
      autoAnalyseIntervalMinutes: 5,
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
      speakerDiarization: false,
      diarizationMinSpeakers: 1,
      diarizationMaxSpeakers: 5,
      captureMode: "live",
      presets: [
        { id: "interview", name: "Interview", isDefault: true, captureMode: "deep", autoAnalyse: true, autoAnalyseIntervalMinutes: 2, chunkSizeSeconds: 5, confidenceFloor: 0.4, audioSource: "both", dedupSensitivity: "balanced" },
        { id: "meeting", name: "Meeting", isDefault: true, captureMode: "live", autoAnalyse: false, autoAnalyseIntervalMinutes: 5, chunkSizeSeconds: 5, confidenceFloor: 0.5, audioSource: "loopback", dedupSensitivity: "strict" },
        { id: "lecture", name: "Lecture", isDefault: true, captureMode: "capture", autoAnalyse: false, autoAnalyseIntervalMinutes: 5, chunkSizeSeconds: 10, confidenceFloor: 0.6, audioSource: "loopback", dedupSensitivity: "strict" },
        { id: "quick-capture", name: "Quick Capture", isDefault: true, captureMode: "capture", autoAnalyse: false, autoAnalyseIntervalMinutes: 5, chunkSizeSeconds: 3, confidenceFloor: 0.4, audioSource: "loopback", dedupSensitivity: "none" },
      ],
    };
  }
}

async function saveAllSettings(settings: FidesSettings): Promise<void> {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(allSettingsPath, JSON.stringify(settings, null, 2));
}

async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(settingsPath, "utf-8");
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// ─── Services ───

const feedbackPath = join(settingsDir, "feedback.json");
const feedbackStore = createJsonFeedbackStore(feedbackPath);
const analyzer = new RhetoricalAnalyzer();

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ─── HTTP Helpers ───

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

// ─── Route Handler ───

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ─── Status ───

  if (path === "/status" && method === "GET") {
    json(res, { running: true, libraryVersion: LIBRARY_VERSION });
    return;
  }

  // ─── Draft session ───

  const draftPath = join(settingsDir, "draft.json");

  if (path === "/draft" && method === "GET") {
    try {
      const raw = await readFile(draftPath, "utf-8");
      json(res, JSON.parse(raw));
    } catch {
      error(res, "No draft", 404);
    }
    return;
  }

  if (path === "/draft" && method === "POST") {
    const body = await readBody(req);
    await mkdir(settingsDir, { recursive: true });
    await writeFile(draftPath, body);
    json(res, { ok: true });
    return;
  }

  if (path === "/draft" && method === "DELETE") {
    try { await unlink(draftPath); } catch {}
    json(res, { ok: true });
    return;
  }

  // ─── Settings ───

  if (path === "/settings" && method === "GET") {
    const settings = await loadSettings();
    const masked = settings.apiKey
      ? `${settings.apiKey.slice(0, 8)}...${settings.apiKey.slice(-4)}`
      : null;
    json(res, { apiKey: masked });
    return;
  }

  if (path === "/settings" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as Partial<Settings>;
    const current = await loadSettings();
    const merged = { ...current, ...body };
    await saveSettings(merged);

    // Update env and reinitialize analyzer if API key changed
    if (body.apiKey) {
      process.env["ANTHROPIC_API_KEY"] = body.apiKey;
      analyzer.reinitialize();
      console.log(`[SETTINGS] API key updated`);
    }

    json(res, { ok: true });
    return;
  }

  // ─── All Settings (full FidesSettings object) ───

  if (path === "/settings/all" && method === "GET") {
    const allSettings = await loadAllSettings();
    json(res, allSettings);
    return;
  }

  if (path === "/settings/all" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as FidesSettings;
    await saveAllSettings(body);

    // If analysisModel changed, update the analyzer
    if (body.analysisModel) {
      const current = await loadSettings();
      current.model = body.analysisModel;
      await saveSettings(current);
    }

    console.log("[SETTINGS] Full settings saved");
    json(res, { ok: true });
    return;
  }

  // ─── Analyze ───

  if (path === "/analyze" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      text: string;
      sessionId: string;
    };
    try {
      const detections = await analyzer.analyze(body.text, body.sessionId);
      json(res, detections);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      console.error("[ANALYZE] Error:", msg);
      error(res, msg, 500);
    }
    return;
  }

  // ─── Retranscribe Cleanup (LLM transcript refinement) ───

  if (path === "/retranscribe-cleanup" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      segments: Array<{ text: string; speaker?: string; start: number; end: number }>;
      sessionId: string;
    };
    try {
      const result = await analyzer.cleanupTranscript(body.segments, body.sessionId);
      json(res, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cleanup failed";
      error(res, msg, 500);
    }
    return;
  }

  // ─── Deep Analysis (speaker attribution) ───

  if (path === "/analyze-deep" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      text: string;
      sessionId: string;
    };
    const result = await analyzer.attributeSpeakers(body.text, body.sessionId);
    json(res, result);
    return;
  }

  // ─── Library ───

  if (path === "/library" && method === "GET") {
    json(res, loadLibrary());
    return;
  }

  if (path.startsWith("/library/") && method === "GET") {
    const patternId = path.slice("/library/".length);
    const pattern = getPattern(patternId);
    if (!pattern) {
      error(res, "Pattern not found", 404);
      return;
    }
    json(res, pattern);
    return;
  }

  // ─── Feedback ───

  if (path === "/feedback" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as AccuracyFeedback;
    await feedbackStore.record(body);
    json(res, { ok: true });
    return;
  }

  // ─── Accuracy ───

  if (path === "/accuracy" && method === "GET") {
    const feedbacks = await feedbackStore.getAll();
    const accuracy = computeAccuracy(feedbacks, lookupPatternId);
    json(res, accuracy);
    return;
  }

  // ─── Sessions ───

  if (path === "/sessions" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;

    if (!body.id || !body.text || !Array.isArray(body.detections) || !body.createdAt) {
      error(res, "Missing required fields: id, text, detections, createdAt");
      return;
    }

    await mkdir(sessionsDir, { recursive: true });
    const filePath = join(sessionsDir, `${sanitizeFilename(String(body.id))}.json`);

    // Check if session file already exists (re-save)
    let existing: Record<string, unknown> | null = null;
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch { /* first save — file doesn't exist */ }

    if (existing) {
      // Preserve original createdAt
      body.createdAt = existing.createdAt;

      // Preserve user-edited metadata if not in new body
      if (!body.name && existing.name) body.name = existing.name;
      if (!body.colorTag && existing.colorTag) body.colorTag = existing.colorTag;
      if (!body.hashtags && existing.hashtags) body.hashtags = existing.hashtags;
      if (!body.speakerMap && existing.speakerMap) body.speakerMap = existing.speakerMap;
      if (!body.sourceType && existing.sourceType) body.sourceType = existing.sourceType;

      // Preserve audio fields from original save
      if (existing.hasAudio && body.hasAudio === undefined) body.hasAudio = existing.hasAudio;
      if (existing.hasMicAudio && body.hasMicAudio === undefined) body.hasMicAudio = existing.hasMicAudio;
      if (existing.hasSystemAudio && body.hasSystemAudio === undefined) body.hasSystemAudio = existing.hasSystemAudio;
      if (existing.audioSessionId && !body.audioSessionId) body.audioSessionId = existing.audioSessionId;

      // Preserve check-ins from original save if not in new body
      if (existing.checkIns && !body.checkIns) body.checkIns = existing.checkIns;

      // Preserve existing edited/original fields
      if (existing.edited) body.edited = existing.edited;
      if (existing.originalText) body.originalText = existing.originalText;
      if (existing.originalSegments) body.originalSegments = existing.originalSegments;

      // Build edit history entry if segments changed
      const existingEditHistory = Array.isArray(existing.editHistory) ? existing.editHistory : [];
      const existingSegs = JSON.stringify(existing.segments ?? []);
      const newSegs = JSON.stringify(body.segments ?? []);

      if (existing.segments && existingSegs !== newSegs) {
        existingEditHistory.push({
          savedAt: Date.now(),
          segments: existing.segments,
          detections: existing.detections ?? [],
          wordCount: existing.wordCount ?? 0,
        });
      }
      body.editHistory = existingEditHistory;
    }

    await writeFile(filePath, JSON.stringify(body, null, 2));

    json(res, { ok: true });
    return;
  }

  if (path === "/sessions" && method === "GET") {
    await mkdir(sessionsDir, { recursive: true });

    const files = await readdir(sessionsDir);
    const summaries: {
      id: string;
      createdAt: string;
      label?: string;
      textPreview: string;
      detectionCount: number;
    }[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const session = JSON.parse(raw) as Record<string, unknown>;
        const text = (session.text as string) ?? "";
        const detections = Array.isArray(session.detections) ? session.detections : [];
        const summary: Record<string, unknown> = {
          id: session.id,
          createdAt: session.createdAt,
          textPreview: text.slice(0, 120),
          detectionCount: detections.length,
          name: session.name ?? undefined,
          colorTag: session.colorTag ?? null,
          hashtags: Array.isArray(session.hashtags) ? session.hashtags : [],
          sources: Array.isArray(session.sources) ? session.sources : [],
          wordCount: session.wordCount ?? text.trim().split(/\s+/).filter(Boolean).length,
          sourceType: session.sourceType ?? undefined,
        };
        if (session.label) summary.label = session.label;

        // Check for audio archives — mic.wav and system.wav
        const audioDir = session.audioSessionId
          ? sanitizeFilename(String(session.audioSessionId))
          : sanitizeFilename(String(session.id));
        let hasMic = false;
        let hasSys = false;
        try { await stat(join(sessionsDir, audioDir, "mic.wav")); hasMic = true; } catch {}
        try { await stat(join(sessionsDir, audioDir, "system.wav")); hasSys = true; } catch {}
        // Legacy: check for old audio.wav
        if (!hasMic && !hasSys) {
          try { await stat(join(sessionsDir, audioDir, "audio.wav")); hasSys = true; } catch {}
        }
        (summary as Record<string, unknown>).hasAudio = hasMic || hasSys;
        (summary as Record<string, unknown>).hasMicAudio = hasMic;
        (summary as Record<string, unknown>).hasSystemAudio = hasSys;

        const checkIns = Array.isArray(session.checkIns) ? session.checkIns : [];
        (summary as Record<string, unknown>).hasCheckIns = checkIns.length > 0;
        (summary as Record<string, unknown>).checkInCount = checkIns.length;

        summaries.push(summary as any);
      } catch {
        continue;
      }
    }

    summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    json(res, summaries);
    return;
  }

  // ─── Session audio serving (dual-track: /audio/mic, /audio/system) ───

  if (path.match(/^\/sessions\/[^/]+\/audio\/(mic|system)$/) && method === "GET") {
    const parts = path.split("/");
    // path = /sessions/{id}/audio/{track} → parts = ["", "sessions", "{id}", "audio", "mic"|"system"]
    const sessionId = decodeURIComponent(parts[2] ?? "");
    const track = parts[4]; // "mic" or "system"
    const sessionFile = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    let audioDir = sanitizeFilename(sessionId);
    try {
      const raw = await readFile(sessionFile, "utf-8");
      const sess = JSON.parse(raw) as Record<string, unknown>;
      if (sess.audioSessionId) {
        audioDir = sanitizeFilename(String(sess.audioSessionId));
      }
    } catch {
      // fall back to session ID
    }

    // Try the track-specific file, then fall back to legacy audio.wav for system track
    let audioPath = join(sessionsDir, audioDir, `${track}.wav`);
    try {
      await stat(audioPath);
    } catch {
      if (track === "system") {
        audioPath = join(sessionsDir, audioDir, "audio.wav");
      }
    }

    try {
      const audioStat = await stat(audioPath);
      const fileSize = audioStat.size;
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        // Handle Range request (HTTP 206 Partial Content) — required for audio seeking
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]!, 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          const { createReadStream } = await import("node:fs");
          const stream = createReadStream(audioPath, { start, end });

          res.writeHead(206, {
            "Content-Type": "audio/wav",
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Access-Control-Allow-Origin": "*",
          });
          stream.pipe(res);
        } else {
          res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
          res.end();
        }
      } else {
        // No Range header — serve full file with Accept-Ranges so browser knows it can seek
        const audioData = await readFile(audioPath);
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(audioData);
      }
    } catch {
      error(res, "Audio file not found", 404);
    }
    return;
  }

  // ─── Get single session ───

  if (path.startsWith("/sessions/") && method === "GET") {
    const sessionId = decodeURIComponent(path.slice("/sessions/".length));
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    try {
      const raw = await readFile(filePath, "utf-8");
      const session = JSON.parse(raw) as Record<string, unknown>;
      json(res, session);
    } catch {
      error(res, "Session not found", 404);
    }
    return;
  }

  // ─── Delete session ───

  if (path.startsWith("/sessions/") && !path.includes("/audio") && method === "DELETE") {
    const sessionId = decodeURIComponent(path.slice("/sessions/".length));
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    try {
      // Read session to find audio directory before deleting
      let audioDir: string | null = null;
      try {
        const raw = await readFile(filePath, "utf-8");
        const sess = JSON.parse(raw) as Record<string, unknown>;
        audioDir = sess.audioSessionId
          ? sanitizeFilename(String(sess.audioSessionId))
          : null;
      } catch { /* no session file or can't parse — proceed with delete */ }

      await unlink(filePath);

      // Clean up audio directory if it exists
      if (audioDir) {
        const audioDirPath = join(sessionsDir, audioDir);
        try {
          await rm(audioDirPath, { recursive: true, force: true });
          console.log(`[SESSIONS] Deleted audio dir: ${audioDirPath}`);
        } catch { /* audio dir might not exist */ }
      }

      json(res, { ok: true });
    } catch {
      error(res, "Session not found", 404);
    }
    return;
  }

  // ─── Patch session ───

  if (path.startsWith("/sessions/") && method === "PATCH") {
    const sessionId = decodeURIComponent(path.slice("/sessions/".length));
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    try {
      const raw = await readFile(filePath, "utf-8");
      const existing = JSON.parse(raw) as Record<string, unknown>;
      const patch = JSON.parse(await readBody(req)) as Record<string, unknown>;

      // If marking as edited for the first time, preserve original text and segments
      if (patch.edited === true && !existing.originalText && existing.text) {
        existing.originalText = existing.text;
      }
      if (patch.edited === true && !existing.originalSegments && existing.segments) {
        existing.originalSegments = JSON.parse(JSON.stringify(existing.segments));
      }

      // Merge patch into existing
      const merged = { ...existing, ...patch };
      await writeFile(filePath, JSON.stringify(merged, null, 2));
      json(res, { ok: true });
    } catch (err) {
      error(res, `Failed to patch session: ${err}`, 500);
    }
    return;
  }

  // ─── Check-ins ───

  const checkinsPath = join(settingsDir, "checkins.json");

  if (path === "/checkins" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    let existing: unknown[] = [];
    try {
      const raw = await readFile(checkinsPath, "utf-8");
      existing = JSON.parse(raw) as unknown[];
    } catch { /* file doesn't exist yet */ }
    existing.push(body);
    await mkdir(settingsDir, { recursive: true });
    await writeFile(checkinsPath, JSON.stringify(existing, null, 2));
    json(res, { ok: true });
    return;
  }

  if (path === "/checkins" && method === "GET") {
    try {
      const raw = await readFile(checkinsPath, "utf-8");
      const all = JSON.parse(raw) as Array<{ timestamp: number }>;
      all.sort((a, b) => b.timestamp - a.timestamp);
      json(res, all);
    } catch {
      json(res, []);
    }
    return;
  }

  // ─── Data Summary ───

  if (path === "/data/summary" && method === "GET") {
   try {
    const periodParam = url.searchParams.get("period") ?? "30d";
    const now = Date.now();
    const periodMs: Record<string, number> = {
      "24h": 86400000,
      "7d": 7 * 86400000,
      "30d": 30 * 86400000,
      "90d": 90 * 86400000,
      "all": now,
    };
    const windowMs = periodMs[periodParam] ?? periodMs["30d"]!;
    const cutoff = now - windowMs;
    const priorCutoff = cutoff - windowMs;

    await mkdir(sessionsDir, { recursive: true });
    const files = await readdir(sessionsDir);

    // Load all sessions
    const allSessions: Array<Record<string, unknown>> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        allSessions.push(JSON.parse(raw));
      } catch { continue; }
    }

    const sessionTime = (s: Record<string, unknown>) => {
      const t = new Date(s.createdAt as string).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    const currentSessions = allSessions.filter(s => sessionTime(s) >= cutoff);
    const priorSessions = allSessions.filter(s => {
      const t = sessionTime(s);
      return t >= priorCutoff && t < cutoff;
    });

    // Helper to get word count
    const wc = (s: Record<string, unknown>) =>
      (s.wordCount as number) ?? ((s.text as string) ?? "").trim().split(/\s+/).filter(Boolean).length;

    // Helper to get session hours from segments.
    // Returns 0 for sessions with <2 segments (no measurable duration) and the
    // raw duration otherwise — no floor. A 0.1h floor previously inflated
    // totalHours, sovereignty denominators, and session timeline widths.
    const sessionHours = (s: Record<string, unknown>): number => {
      const segs = s.segments as Array<{ capturedAt: number }> | undefined;
      if (!segs || segs.length < 2) return 0;
      return (segs[segs.length - 1]!.capturedAt - segs[0]!.capturedAt) / 3600000;
    };

    // Helper to get sources from session
    const getSources = (s: Record<string, unknown>): string[] => {
      if (Array.isArray(s.sources) && s.sources.length > 0) return s.sources as string[];
      const segs = s.segments as Array<{ source: string }> | undefined;
      if (segs) return [...new Set(segs.map(seg => seg.source))];
      return [];
    };

    // Basic totals
    const totalSessions = currentSessions.length;
    const totalWords = currentSessions.reduce((a, s) => a + wc(s), 0);
    const totalPatterns = currentSessions.reduce((a, s) => a + (Array.isArray(s.detections) ? s.detections.length : 0), 0);
    const totalHours = currentSessions.reduce((a, s) => a + sessionHours(s), 0);
    const sessionsWithAudio = currentSessions.filter(s => s.hasAudio || s.hasMicAudio || s.hasSystemAudio).length;
    const sessionsWithCheckIns = currentSessions.filter(s => Array.isArray(s.checkIns) && (s.checkIns as unknown[]).length > 0).length;
    const sessionsEdited = currentSessions.filter(s => s.edited === true).length;

    // Prior period totals
    const priorTotalSessions = priorSessions.length;
    const priorTotalPatterns = priorSessions.reduce((a, s) => a + (Array.isArray(s.detections) ? s.detections.length : 0), 0);
    const priorTotalWords = priorSessions.reduce((a, s) => a + wc(s), 0);

    // Pattern frequency
    const patternMap = new Map<string, { count: number; strong: number; likely: number; possible: number; sessionIds: Set<string> }>();
    for (const s of currentSessions) {
      const dets = s.detections as Array<{ patternId: string; confidenceTier: string }> | undefined;
      if (!Array.isArray(dets)) continue;
      const sid = (s.id as string) ?? "";
      for (const d of dets) {
        const entry = patternMap.get(d.patternId) ?? { count: 0, strong: 0, likely: 0, possible: 0, sessionIds: new Set<string>() };
        entry.count++;
        if (sid) entry.sessionIds.add(sid);
        if (d.confidenceTier === "strong") entry.strong++;
        else if (d.confidenceTier === "likely") entry.likely++;
        else entry.possible++;
        patternMap.set(d.patternId, entry);
      }
    }
    const patternFrequency = [...patternMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([patternId, v]) => ({
        patternId,
        count: v.count,
        confidenceTiers: { strong: v.strong, likely: v.likely, possible: v.possible },
        sessionIds: [...v.sessionIds],
      }));

    // Category breakdown — cache getPattern lookups to avoid O(n²)
    const categoryCache = new Map<string, string>();
    const categoryMap: Record<string, number> = {};
    for (const s of currentSessions) {
      const dets = s.detections as Array<{ patternId: string }> | undefined;
      if (!Array.isArray(dets)) continue;
      for (const d of dets) {
        let cat = categoryCache.get(d.patternId);
        if (cat === undefined) {
          const pattern = getPattern(d.patternId);
          cat = pattern?.category ?? "unknown";
          categoryCache.set(d.patternId, cat);
        }
        categoryMap[cat] = (categoryMap[cat] ?? 0) + 1;
      }
    }

    // Source breakdown — split word/pattern counts across sources to avoid double-counting
    const sourceMap = new Map<string, { sessionCount: number; patternCount: number; wordCount: number }>();
    for (const s of currentSessions) {
      const sources = getSources(s);
      if (sources.length === 0) continue;
      const sw = wc(s);
      const sp = Array.isArray(s.detections) ? s.detections.length : 0;
      const share = sources.length;
      for (const src of sources) {
        const entry = sourceMap.get(src) ?? { sessionCount: 0, patternCount: 0, wordCount: 0 };
        entry.sessionCount++;
        entry.patternCount += Math.round(sp / share);
        entry.wordCount += Math.round(sw / share);
        sourceMap.set(src, entry);
      }
    }
    const sourceBreakdown: Record<string, { sessionCount: number; patternCount: number; wordCount: number }> = {};
    for (const [k, v] of sourceMap) sourceBreakdown[k] = v;

    // Source type breakdown (content category)
    const sourceTypeMap = new Map<string, { sessionCount: number; patternCount: number; wordCount: number }>();
    for (const s of currentSessions) {
      const st = (s.sourceType as string) || "other";
      const entry = sourceTypeMap.get(st) ?? { sessionCount: 0, patternCount: 0, wordCount: 0 };
      entry.sessionCount++;
      entry.patternCount += Array.isArray(s.detections) ? s.detections.length : 0;
      entry.wordCount += wc(s);
      sourceTypeMap.set(st, entry);
    }
    const sourceTypeBreakdown: Record<string, { sessionCount: number; patternCount: number; wordCount: number }> = {};
    for (const [k, v] of sourceTypeMap) sourceTypeBreakdown[k] = v;

    // Weekly activity — 12 fixed buckets going back from now
    const nowDate = new Date(now);
    const nowDay = nowDate.getDay();
    const nowDiff = nowDay === 0 ? 6 : nowDay - 1;
    const thisMonday = new Date(nowDate);
    thisMonday.setHours(0, 0, 0, 0);
    thisMonday.setDate(thisMonday.getDate() - nowDiff);
    const weekBuckets: Array<{ weekStart: number; sessionCount: number; patternCount: number; wordCount: number; sessionIds: string[] }> = [];
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(thisMonday);
      ws.setDate(ws.getDate() - i * 7);
      weekBuckets.push({ weekStart: ws.getTime(), sessionCount: 0, patternCount: 0, wordCount: 0, sessionIds: [] });
    }
    for (const s of currentSessions) {
      const t = sessionTime(s);
      if (t === 0) continue;
      const sid = (s.id as string) ?? "";
      // Find the right bucket
      for (let b = weekBuckets.length - 1; b >= 0; b--) {
        if (t >= weekBuckets[b]!.weekStart) {
          weekBuckets[b]!.sessionCount++;
          weekBuckets[b]!.patternCount += Array.isArray(s.detections) ? s.detections.length : 0;
          weekBuckets[b]!.wordCount += wc(s);
          if (sid) weekBuckets[b]!.sessionIds.push(sid);
          break;
        }
      }
    }
    const weeklyActivity = weekBuckets.map(b => ({
      ...b,
      annotationDensity: b.patternCount / Math.max(b.wordCount, 1),
    }));

    // ── Session timeline (individual session blocks) ──
    const sessionTimeline = currentSessions
      .map(s => {
        const t = sessionTime(s);
        if (t === 0) return null;
        return {
          id: (s.id as string) ?? "",
          name: (s.name as string) ?? "",
          timestamp: t,
          durationHours: sessionHours(s),
          patternCount: Array.isArray(s.detections) ? s.detections.length : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a!.timestamp - b!.timestamp);

    // Drift — compare current vs prior pattern frequency
    const priorPatternMap = new Map<string, number>();
    for (const s of priorSessions) {
      const dets = s.detections as Array<{ patternId: string }> | undefined;
      if (!Array.isArray(dets)) continue;
      for (const d of dets) {
        priorPatternMap.set(d.patternId, (priorPatternMap.get(d.patternId) ?? 0) + 1);
      }
    }
    const allPatternIds = new Set([...patternMap.keys(), ...priorPatternMap.keys()]);
    const drift = [...allPatternIds]
      .map(patternId => {
        const pm = patternMap.get(patternId);
        const currentCount = pm?.count ?? 0;
        const priorCount = priorPatternMap.get(patternId) ?? 0;
        let deltaPercent: number;
        if (priorCount > 0) {
          deltaPercent = Math.round((currentCount - priorCount) / priorCount * 100);
        } else {
          deltaPercent = currentCount > 0 ? 100 : 0;
        }
        deltaPercent = Math.max(-500, Math.min(500, deltaPercent));
        return { patternId, currentCount, priorCount, deltaPercent, sessionIds: pm ? [...pm.sessionIds] : [] };
      })
      .filter(d => d.currentCount > 0 || d.priorCount > 0)
      .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
      .slice(0, 5);

    // Check-in summary
    let checkInSummary: {
      totalCheckIns: number;
      averages: { energy: number; clarity: number; groundedness: number; openness: number };
      recentTrend: "up" | "down" | "stable";
    } | null = null;
    try {
      const raw = await readFile(join(settingsDir, "checkins.json"), "utf-8");
      const allCheckIns = JSON.parse(raw) as Array<{
        timestamp: number; energy: number; clarity: number; groundedness: number; openness: number;
      }>;
      const periodCheckIns = allCheckIns.filter(c => c.timestamp >= cutoff);
      if (periodCheckIns.length > 0) {
        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const sorted = [...periodCheckIns].sort((a, b) => b.timestamp - a.timestamp);
        const recent5 = sorted.slice(0, 5);
        const prior5 = sorted.slice(5, 10);
        const recentAvg = avg(recent5.map(c => (c.energy + c.clarity + c.groundedness + c.openness) / 4));
        const priorAvg = prior5.length > 0
          ? avg(prior5.map(c => (c.energy + c.clarity + c.groundedness + c.openness) / 4))
          : recentAvg;
        const diff = recentAvg - priorAvg;
        checkInSummary = {
          totalCheckIns: periodCheckIns.length,
          averages: {
            energy: avg(periodCheckIns.map(c => c.energy)),
            clarity: avg(periodCheckIns.map(c => c.clarity)),
            groundedness: avg(periodCheckIns.map(c => c.groundedness)),
            openness: avg(periodCheckIns.map(c => c.openness)),
          },
          recentTrend: diff > 5 ? "up" : diff < -5 ? "down" : "stable",
        };
      }
    } catch { /* no checkins file */ }

    // ── Check-in correlations ──
    // Group by s.sourceType (consistent with sourceTypeImpact), not by the first
    // URL/app source. Only surface groups with n >= 3 paired sessions — smaller
    // samples are too noisy to interpret as a correlation.
    const CORR_MIN_SESSIONS = 3;
    const corrMap = new Map<string, { deltas: Array<{ energy: number; clarity: number; groundedness: number; openness: number }>; sessionIds: string[] }>();
    for (const s of currentSessions) {
      const cis = s.checkIns as Array<{ context: string; energy: number; clarity: number; groundedness: number; openness: number }> | undefined;
      if (!Array.isArray(cis)) continue;
      const before = cis.find(c => c.context === "before");
      const after = cis.find(c => c.context === "after");
      if (!before || !after) continue;
      const sourceType = (s.sourceType as string | undefined) ?? "other";
      const sid = (s.id as string) ?? "";
      const entry = corrMap.get(sourceType) ?? { deltas: [], sessionIds: [] };
      entry.deltas.push({
        energy: after.energy - before.energy,
        clarity: after.clarity - before.clarity,
        groundedness: after.groundedness - before.groundedness,
        openness: after.openness - before.openness,
      });
      if (sid) entry.sessionIds.push(sid);
      corrMap.set(sourceType, entry);
    }
    const checkInCorrelations: Array<{ sourceType: string; sessionCount: number; meanDeltas: { energy: number; clarity: number; groundedness: number; openness: number; overall: number }; sessionIds: string[] }> = [];
    for (const [sourceType, entry] of corrMap) {
      if (entry.deltas.length < CORR_MIN_SESSIONS) continue;
      const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const md = {
        energy: Math.round(mean(entry.deltas.map(d => d.energy)) * 10) / 10,
        clarity: Math.round(mean(entry.deltas.map(d => d.clarity)) * 10) / 10,
        groundedness: Math.round(mean(entry.deltas.map(d => d.groundedness)) * 10) / 10,
        openness: Math.round(mean(entry.deltas.map(d => d.openness)) * 10) / 10,
        overall: 0,
      };
      md.overall = Math.round((md.energy + md.clarity + md.groundedness + md.openness) / 4 * 10) / 10;
      checkInCorrelations.push({ sourceType, sessionCount: entry.deltas.length, meanDeltas: md, sessionIds: entry.sessionIds });
    }
    checkInCorrelations.sort((a, b) => a.meanDeltas.overall - b.meanDeltas.overall);

    // ── Resilience profile ──
    const resilienceProfile: Array<{ observation: string; supportingSessionCount: number; sessionIds: string[] }> = [];
    // Collect sessions with before+after check-ins and their overall deltas
    const pairedSessions: Array<{ sid: string; overallDelta: number; hour: number; words: number; hasPatterns: boolean }> = [];
    for (const s of currentSessions) {
      const cis = s.checkIns as Array<{ context: string; energy: number; clarity: number; groundedness: number; openness: number }> | undefined;
      if (!Array.isArray(cis)) continue;
      const before = cis.find(c => c.context === "before");
      const after = cis.find(c => c.context === "after");
      if (!before || !after) continue;
      const delta = ((after.energy - before.energy) + (after.clarity - before.clarity) + (after.groundedness - before.groundedness) + (after.openness - before.openness)) / 4;
      const createdHour = new Date(s.createdAt as string).getHours();
      pairedSessions.push({
        sid: (s.id as string) ?? "",
        overallDelta: delta,
        hour: Number.isNaN(createdHour) ? 12 : createdHour,
        words: wc(s),
        hasPatterns: Array.isArray(s.detections) && (s.detections as unknown[]).length > 0,
      });
    }
    if (pairedSessions.length >= 2) {
      const meanDelta = (arr: typeof pairedSessions) => arr.reduce((a, s) => a + s.overallDelta, 0) / arr.length;
      // Morning vs afternoon
      const morning = pairedSessions.filter(s => s.hour < 12);
      const afternoon = pairedSessions.filter(s => s.hour >= 12);
      if (morning.length >= 2 && afternoon.length >= 2) {
        const diff = meanDelta(morning) - meanDelta(afternoon);
        if (Math.abs(diff) >= 8) {
          const better = diff > 0 ? "morning" : "afternoon";
          resilienceProfile.push({
            observation: `Your state holds up better in the ${better} (${Math.abs(Math.round(diff))} points higher)`,
            supportingSessionCount: morning.length + afternoon.length,
            sessionIds: pairedSessions.map(s => s.sid).filter(Boolean),
          });
        }
      }
      // Short vs long sessions
      const short = pairedSessions.filter(s => s.words < 600);
      const long = pairedSessions.filter(s => s.words >= 600);
      if (short.length >= 2 && long.length >= 2) {
        const diff = meanDelta(short) - meanDelta(long);
        if (Math.abs(diff) >= 8) {
          const better = diff > 0 ? "shorter" : "longer";
          resilienceProfile.push({
            observation: `Your state holds up better in ${better} sessions (${Math.abs(Math.round(diff))} points higher)`,
            supportingSessionCount: short.length + long.length,
            sessionIds: pairedSessions.map(s => s.sid).filter(Boolean),
          });
        }
      }
      // With patterns vs without
      const withP = pairedSessions.filter(s => s.hasPatterns);
      const withoutP = pairedSessions.filter(s => !s.hasPatterns);
      if (withP.length >= 2 && withoutP.length >= 2) {
        const diff = meanDelta(withoutP) - meanDelta(withP);
        if (Math.abs(diff) >= 8) {
          const obs = diff > 0
            ? `Sessions without detected patterns show ${Math.abs(Math.round(diff))} points less state drop`
            : `Sessions with detected patterns show ${Math.abs(Math.round(diff))} points less state drop`;
          resilienceProfile.push({
            observation: obs,
            supportingSessionCount: withP.length + withoutP.length,
            sessionIds: pairedSessions.map(s => s.sid).filter(Boolean),
          });
        }
      }
    }

    // ── Absent patterns ──
    const allLibraryPatterns = loadLibrary();
    const detectedPatternIds = new Set(patternMap.keys());
    const absentPatterns = allLibraryPatterns
      .filter(p => !detectedPatternIds.has(p.id))
      .map(p => ({ patternId: p.id, name: p.name, category: p.category }));

    // Speaker ratio
    let micWords = 0;
    let totalWordsAllSegs = 0;
    for (const s of currentSessions) {
      const segs = s.segments as Array<{ text?: string; speaker?: string }> | undefined;
      if (!Array.isArray(segs)) continue;
      for (const seg of segs) {
        const words = ((seg.text as string) ?? "").trim().split(/\s+/).filter(Boolean).length;
        totalWordsAllSegs += words;
        if (seg.speaker === "MIC") micWords += words;
      }
    }
    const speakerRatio = {
      micWords,
      totalWords: totalWordsAllSegs,
      micPercent: totalWordsAllSegs > 0 ? Math.round((micWords / totalWordsAllSegs) * 1000) / 10 : 0,
    };

    // Question ratio
    let micSegmentCount = 0;
    let questionSegmentCount = 0;
    for (const s of currentSessions) {
      const segs = s.segments as Array<{ text?: string; speaker?: string }> | undefined;
      if (!Array.isArray(segs)) continue;
      for (const seg of segs) {
        if (seg.speaker !== "MIC") continue;
        micSegmentCount++;
        const text = ((seg.text as string) ?? "").trim();
        if (text.endsWith("?")) questionSegmentCount++;
      }
    }
    const questionRatio = micSegmentCount > 0 ? Math.round((questionSegmentCount / micSegmentCount) * 1000) / 10 : 0;

    // Sovereignty trend — one point per session, using ONLY the after check-in's
    // sovereignty value. Sessions without an after-context check-in, or whose
    // after-check-in has no sovereignty field, are excluded entirely (no bar,
    // no placeholder). No fallback to other dimensions.
    const sovereigntyTrend: Array<{ sessionId: string; date: string; score: number }> = [];
    for (const s of currentSessions) {
      const cis = s.checkIns as Array<{ context?: string; sovereignty?: number }> | undefined;
      if (!Array.isArray(cis) || cis.length === 0) continue;
      const after = cis.find(c => c.context === "after");
      if (!after || typeof after.sovereignty !== "number") continue;
      sovereigntyTrend.push({
        sessionId: String(s.id ?? ""),
        date: new Date(s.createdAt as string).toISOString().slice(0, 10),
        score: Math.round(after.sovereignty * 10) / 10,
      });
    }
    sovereigntyTrend.sort((a, b) => b.date.localeCompare(a.date));

    // Before/after deltas (global aggregate)
    const allDeltas: Array<{ energy: number; clarity: number; groundedness: number; openness: number; sovereignty: number | null; presence: number | null }> = [];
    for (const s of currentSessions) {
      const cis = s.checkIns as Array<{ context?: string; energy?: number; clarity?: number; groundedness?: number; openness?: number; sovereignty?: number; presence?: number }> | undefined;
      if (!Array.isArray(cis)) continue;
      const before = cis.find(c => c.context === "before");
      const after = cis.find(c => c.context === "after");
      if (!before || !after) continue;
      allDeltas.push({
        energy: (after.energy ?? 0) - (before.energy ?? 0),
        clarity: (after.clarity ?? 0) - (before.clarity ?? 0),
        groundedness: (after.groundedness ?? 0) - (before.groundedness ?? 0),
        openness: (after.openness ?? 0) - (before.openness ?? 0),
        sovereignty: typeof after.sovereignty === "number" && typeof before.sovereignty === "number"
          ? after.sovereignty - before.sovereignty : null,
        presence: typeof after.presence === "number" && typeof before.presence === "number"
          ? after.presence - before.presence : null,
      });
    }
    const beforeAfterDeltas = allDeltas.length > 0 ? {
      energy: Math.round(allDeltas.reduce((a, d) => a + d.energy, 0) / allDeltas.length * 10) / 10,
      clarity: Math.round(allDeltas.reduce((a, d) => a + d.clarity, 0) / allDeltas.length * 10) / 10,
      groundedness: Math.round(allDeltas.reduce((a, d) => a + d.groundedness, 0) / allDeltas.length * 10) / 10,
      openness: Math.round(allDeltas.reduce((a, d) => a + d.openness, 0) / allDeltas.length * 10) / 10,
      sovereignty: (() => {
        const vals = allDeltas.map(d => d.sovereignty).filter((v): v is number => v !== null);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
      })(),
      presence: (() => {
        const vals = allDeltas.map(d => d.presence).filter((v): v is number => v !== null);
        return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
      })(),
      sessionCount: allDeltas.length,
    } : null;

    // Sovereignty.
    // The denominator must reflect the *selected period*, not just the span from
    // the first session in the window. Previously the denominator collapsed to
    // "time since first session in window", which made any fresh window show
    // ~0% offline. Compute firstSessionAt from ALL sessions (not the window)
    // so daysSinceStart is correct; cap the denominator at the window length.
    const globalSessionTimes = allSessions.map(s => sessionTime(s)).filter(t => t > 0);
    const globalFirstSessionAt = globalSessionTimes.length > 0 ? Math.min(...globalSessionTimes) : now;
    const sinceStartMs = Math.max(0, now - globalFirstSessionAt);
    const denomMs = Math.min(windowMs, sinceStartMs);
    const periodHours = denomMs > 0 ? denomMs / 3600000 : 0;
    const offlinePercent = periodHours > 0
      ? Math.max(0, Math.min(100, ((periodHours - totalHours) / periodHours) * 100))
      : 0;

    json(res, {
      totalSessions,
      totalWords,
      totalPatterns,
      totalHours,
      sessionsWithAudio,
      sessionsWithCheckIns,
      sessionsEdited,
      priorPeriod: { totalSessions: priorTotalSessions, totalPatterns: priorTotalPatterns, totalWords: priorTotalWords },
      patternFrequency,
      categoryBreakdown: categoryMap,
      sourceBreakdown,
      sourceTypeBreakdown,
      weeklyActivity,
      sessionTimeline,
      drift,
      checkInSummary,
      checkInCorrelations,
      resilienceProfile,
      absentPatterns,
      sovereignty: { capturedHours: totalHours, periodHours, offlinePercent, firstSessionAt: globalFirstSessionAt },
      speakerRatio,
      questionRatio,
      sovereigntyTrend,
      beforeAfterDeltas,
    });
   } catch (e) {
    const msg = e instanceof Error ? e.message : "Data summary failed";
    console.error("[DATA SUMMARY] Error:", msg, e);
    error(res, msg, 500);
   }
    return;
  }

  // ─── Correlations ───

  if (path === "/data/correlations" && method === "GET") {
   try {
    const periodParam = url.searchParams.get("period") ?? "30d";
    const now = Date.now();
    const periodMs: Record<string, number> = { "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000, "90d": 90 * 86400000, "all": now };
    const windowMs = periodMs[periodParam] ?? periodMs["30d"]!;
    const cutoff = now - windowMs;

    await mkdir(sessionsDir, { recursive: true });
    const files = await readdir(sessionsDir);
    const sessions: Array<Record<string, unknown>> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const s = JSON.parse(raw) as Record<string, unknown>;
        const t = new Date(s.createdAt as string).getTime();
        if (!Number.isNaN(t) && t >= cutoff) sessions.push(s);
      } catch { continue; }
    }

    // Helper: get before/after check-in pair from inline checkIns
    type Delta6 = { energy: number; clarity: number; groundedness: number; openness: number; sovereignty: number | null; presence: number | null };
    function getStateDelta(s: Record<string, unknown>): Delta6 | null {
      const cis = s.checkIns as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(cis) || cis.length < 2) return null;
      const before = cis.find(c => c.context === "before");
      const after = cis.find(c => c.context === "after");
      if (!before || !after) return null;
      return {
        energy: (after.energy as number) - (before.energy as number),
        clarity: (after.clarity as number) - (before.clarity as number),
        groundedness: (after.groundedness as number) - (before.groundedness as number),
        openness: (after.openness as number) - (before.openness as number),
        sovereignty: typeof after.sovereignty === "number" && typeof before.sovereignty === "number" ? after.sovereignty - before.sovereignty : null,
        presence: typeof after.presence === "number" && typeof before.presence === "number" ? after.presence - before.presence : null,
      };
    }

    // 1. patternStateCoOccurrences
    // Co-occurring state changes for each pattern. Renamed from "correlation"
    // because we're not computing a statistical correlation — we're averaging
    // the state deltas on sessions where the pattern occurred. Gated at n >= 3
    // paired sessions (smaller samples are noise), sorted by signed overall
    // so lifts and drops rank separately (no abs).
    const PATTERN_MIN_SESSIONS = 3;
    const patternDeltas = new Map<string, { deltas: Delta6[]; sessionIds: string[] }>();
    for (const s of sessions) {
      const dets = Array.isArray(s.detections) ? s.detections as Array<{ patternId?: string }> : [];
      if (dets.length === 0) continue;
      const delta = getStateDelta(s);
      if (!delta) continue;
      const sid = String(s.id ?? "");
      const pids = [...new Set(dets.map(d => d.patternId).filter(Boolean) as string[])];
      for (const pid of pids) {
        let entry = patternDeltas.get(pid);
        if (!entry) { entry = { deltas: [], sessionIds: [] }; patternDeltas.set(pid, entry); }
        entry.deltas.push(delta);
        if (sid) entry.sessionIds.push(sid);
      }
    }
    const avgDelta = (arr: Delta6[]): Delta6 & { overall: number } => {
      const avg = (fn: (d: Delta6) => number | null): number | null => {
        const vals = arr.map(fn).filter((v): v is number => v !== null);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const e = avg(d => d.energy) ?? 0;
      const c = avg(d => d.clarity) ?? 0;
      const g = avg(d => d.groundedness) ?? 0;
      const o = avg(d => d.openness) ?? 0;
      return {
        energy: e, clarity: c, groundedness: g, openness: o,
        sovereignty: avg(d => d.sovereignty), presence: avg(d => d.presence),
        overall: e + c + g + o, // signed sum, not abs — direction is the point
      };
    };
    const patternStateCoOccurrences = [...patternDeltas.entries()]
      .filter(([_, { deltas }]) => deltas.length >= PATTERN_MIN_SESSIONS)
      .map(([patternId, { deltas, sessionIds }]) => {
        const mean = avgDelta(deltas);
        return { patternId, sessionCount: deltas.length, meanDeltas: { energy: mean.energy, clarity: mean.clarity, groundedness: mean.groundedness, openness: mean.openness, sovereignty: mean.sovereignty, presence: mean.presence }, sessionIds, _overall: mean.overall };
      })
      .sort((a, b) => b._overall - a._overall)
      .slice(0, 15)
      .map(({ _overall, ...rest }) => rest);

    // 2. sourceTypeImpact
    const stMap = new Map<string, { sessionIds: string[]; deltas: Delta6[]; patternCounts: Map<string, number>; total: number }>();
    for (const s of sessions) {
      const st = s.sourceType as string | undefined;
      if (!st) continue;
      let entry = stMap.get(st);
      if (!entry) { entry = { sessionIds: [], deltas: [], patternCounts: new Map(), total: 0 }; stMap.set(st, entry); }
      entry.total++;
      const sid = String(s.id ?? "");
      if (sid) entry.sessionIds.push(sid);
      const delta = getStateDelta(s);
      if (delta) entry.deltas.push(delta);
      const dets = Array.isArray(s.detections) ? s.detections as Array<{ patternId?: string }> : [];
      for (const d of dets) {
        if (d.patternId) entry.patternCounts.set(d.patternId, (entry.patternCounts.get(d.patternId) ?? 0) + 1);
      }
    }
    const sourceTypeImpact = [...stMap.entries()].map(([sourceType, e]) => {
      // Match numerator and denominator: only average over paired sessions that
      // actually carry the dimension. Previously avgSov's numerator included
      // rows whose sovereignty was null (counted as 0), biasing the mean toward
      // zero for early check-ins without sovereignty.
      const sovDeltas = e.deltas.filter(d => d.sovereignty !== null);
      const avgSov = sovDeltas.length > 0
        ? sovDeltas.reduce((a, d) => a + (d.sovereignty as number), 0) / sovDeltas.length
        : null;
      const gndDeltas = e.deltas.filter(d => typeof d.groundedness === "number");
      const avgGnd = gndDeltas.length > 0
        ? gndDeltas.reduce((a, d) => a + d.groundedness, 0) / gndDeltas.length
        : null;
      let dominantPattern: string | null = null;
      let dominantPatternCount = 0;
      for (const [pid, cnt] of e.patternCounts) {
        if (cnt > dominantPatternCount) { dominantPattern = pid; dominantPatternCount = cnt; }
      }
      return {
        sourceType, sessionCount: e.total, sessionsWithPairs: e.deltas.length,
        sovereigntyDelta: Number.isFinite(avgSov) ? avgSov : null,
        groundednessDelta: Number.isFinite(avgGnd) ? avgGnd : null,
        dominantPattern, dominantPatternCount, sessionIds: e.sessionIds,
      };
    }).sort((a, b) => b.sessionsWithPairs - a.sessionsWithPairs);

    // 3. intentionOutcomeMatrix
    const ioMap = new Map<string, { count: number; sessionIds: string[] }>();
    const intentionSet = new Set<string>();
    const outcomeSet = new Set<string>();
    for (const s of sessions) {
      const intent = s.intentionTag as string | undefined;
      const outcome = s.outcomeTag as string | undefined;
      if (intent) intentionSet.add(intent);
      if (outcome) outcomeSet.add(outcome);
      if (!intent || !outcome) continue;
      const key = `${intent}|${outcome}`;
      const entry = ioMap.get(key) ?? { count: 0, sessionIds: [] };
      entry.count++;
      const sid = String(s.id ?? "");
      if (sid) entry.sessionIds.push(sid);
      ioMap.set(key, entry);
    }
    const intentionOutcomeMatrix = [...ioMap.entries()]
      .map(([key, { count, sessionIds }]) => {
        const [intentionTag, outcomeTag] = key.split("|") as [string, string];
        return { intentionTag, outcomeTag, count, sessionIds };
      })
      .sort((a, b) => b.count - a.count);

    // 4. relationshipSovereignty
    const relMap = new Map<string, { deltas: Array<number | null>; sessionIds: string[] }>();
    for (const s of sessions) {
      const tags = s.relationshipTags as string[] | undefined;
      if (!Array.isArray(tags) || tags.length === 0) continue;
      const delta = getStateDelta(s);
      const sid = String(s.id ?? "");
      for (const tag of tags) {
        let entry = relMap.get(tag);
        if (!entry) { entry = { deltas: [], sessionIds: [] }; relMap.set(tag, entry); }
        entry.deltas.push(delta?.sovereignty ?? null);
        if (sid) entry.sessionIds.push(sid);
      }
    }
    const relationshipSovereignty = [...relMap.entries()].map(([relationshipTag, e]) => {
      const validDeltas = e.deltas.filter((v): v is number => v !== null);
      const meanSovereigntyDelta = validDeltas.length > 0
        ? Math.round(validDeltas.reduce((a, b) => a + b, 0) / validDeltas.length * 10) / 10
        : null;
      return { relationshipTag, sessionCount: e.deltas.length, meanSovereigntyDelta, sessionIds: e.sessionIds };
    }).sort((a, b) => b.sessionCount - a.sessionCount);

    // 5. micPatternFrequency — detections where speaker === "MIC"
    const micPatMap = new Map<string, { count: number; sessionIds: Set<string> }>();
    for (const s of sessions) {
      const dets = Array.isArray(s.detections) ? s.detections as Array<{ patternId?: string; speaker?: string }> : [];
      const sid = String(s.id ?? "");
      for (const d of dets) {
        if (d.speaker !== "MIC" || !d.patternId) continue;
        let entry = micPatMap.get(d.patternId);
        if (!entry) { entry = { count: 0, sessionIds: new Set() }; micPatMap.set(d.patternId, entry); }
        entry.count++;
        if (sid) entry.sessionIds.add(sid);
      }
    }
    const micPatternFrequency = [...micPatMap.entries()]
      .map(([patternId, { count, sessionIds }]) => ({ patternId, count, sessionIds: [...sessionIds] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    json(res, {
      patternStateCoOccurrences,
      sourceTypeImpact,
      intentionOutcomeMatrix,
      allIntentionTags: [...intentionSet].sort(),
      allOutcomeTags: [...outcomeSet].sort(),
      relationshipSovereignty,
      micPatternFrequency,
    });
   } catch (e) {
    const msg = e instanceof Error ? e.message : "Correlations failed";
    console.error("[CORRELATIONS] Error:", msg, e);
    error(res, msg, 500);
   }
    return;
  }

  // ─── AI Analysis ───

  if (path === "/ai-analysis" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      questions: Array<{ id: string; label: string; prompt: string }>;
      dataSummary: Record<string, unknown>;
      recentSessionPreviews: Array<{ id: string; name?: string; textPreview: string; detectionCount: number; createdAt: string }>;
    };

    const settings = await loadSettings();
    if (!settings.apiKey) {
      error(res, "No API key configured. Add your Anthropic API key in Settings.", 400);
      return;
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: settings.apiKey });

    const systemPrompt = `You are a rhetorical literacy advisor integrated into Forti Fide, a desktop app that detects rhetorical patterns (manipulation, framing, fallacies, emotional appeals, etc.) in the user's captured media sessions.

You will receive a data summary with statistics about the user's sessions and a specific question to answer. Your answers should be:
- Grounded in the data provided (reference specific patterns, counts, and trends)
- Concise (2-4 sentences unless the question warrants more)
- Written in a reflective, non-judgmental tone
- Focused on awareness rather than prescriptions
- Never alarming or condescending
- IMPORTANT: When referring to a specific session, you MUST include its exact session ID in your answer text — for example session-1711234567890 or live-1711234567890. These IDs are automatically converted into clickable links in the UI. Always prefer citing a concrete session ID over vague references like "one session" or "a recent capture". The available session IDs are listed in the user message.

The user is building rhetorical literacy — help them notice patterns, not fear them.`;

    const dataBrief = JSON.stringify({
      totalSessions: body.dataSummary.totalSessions,
      totalPatterns: body.dataSummary.totalPatterns,
      totalWords: body.dataSummary.totalWords,
      totalHours: body.dataSummary.totalHours,
      patternFrequency: (body.dataSummary.patternFrequency as unknown[])?.slice(0, 10),
      drift: body.dataSummary.drift,
      categoryBreakdown: body.dataSummary.categoryBreakdown,
      sourceBreakdown: body.dataSummary.sourceBreakdown,
      checkInCorrelations: body.dataSummary.checkInCorrelations,
      resilienceProfile: body.dataSummary.resilienceProfile,
      sovereignty: body.dataSummary.sovereignty,
    }, null, 0);

    const results: Array<{ questionId: string; answer: string; error?: string }> = [];

    for (const q of body.questions) {
      try {
        const message = await client.messages.create({
          model: "claude-opus-4-20250514",
          max_tokens: 600,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: `Here is the user's data summary for the current period:\n\n${dataBrief}\n\nRecent sessions (previews):\n${body.recentSessionPreviews.slice(0, 5).map(s => `- [${s.id}] "${s.textPreview}" (${s.detectionCount} patterns, ${s.createdAt}${s.name ? `, named "${s.name}"` : ""})`).join("\n")}\n\nAvailable session IDs for reference: ${body.recentSessionPreviews.slice(0, 8).map(s => s.id).join(", ")}\n\nQuestion: ${q.prompt}`,
          }],
        });

        let text = "";
        for (const block of message.content) {
          if (block.type === "text") text += block.text;
        }

        results.push({ questionId: q.id, answer: text });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI request failed";
        console.error(`[AI-ANALYSIS] Error on question ${q.id}:`, msg);
        results.push({ questionId: q.id, answer: "", error: msg });
      }
    }

    json(res, { results });
    return;
  }

  // ─── Synthesis (stored AI insights) ───

  const synthesisPath = join(settingsDir, "synthesis.json");

  if (path === "/synthesis" && method === "GET") {
    try {
      const raw = await readFile(synthesisPath, "utf-8");
      json(res, JSON.parse(raw));
    } catch {
      json(res, []);
    }
    return;
  }

  if (path === "/synthesis" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      questionId: string;
      questionLabel: string;
      answer: string;
      storedAt: string;
      period: string;
      context?: { patterns?: string[]; sessionIds?: string[]; sourceTypes?: string[] };
    };
    let existing: Array<{ questionId?: string; answer?: string; context?: unknown }> = [];
    try {
      const raw = await readFile(synthesisPath, "utf-8");
      existing = JSON.parse(raw) as Array<{ questionId?: string; answer?: string; context?: unknown }>;
    } catch { /* file doesn't exist yet */ }

    // Dedup: skip if same questionId + same answer already exists
    const isDuplicate = existing.some(
      (s) => s.questionId === body.questionId && s.answer === body.answer
    );

    if (!isDuplicate) {
      existing.unshift(body);
      // Keep max 100 stored syntheses
      if (existing.length > 100) existing = existing.slice(0, 100);
      await mkdir(settingsDir, { recursive: true });
      await writeFile(synthesisPath, JSON.stringify(existing, null, 2));
    }
    json(res, { ok: true, duplicate: isDuplicate });
    return;
  }

  if (path === "/synthesis" && method === "DELETE") {
    const body = JSON.parse(await readBody(req)) as {
      questionId?: string;
      storedAt?: string;
      entries?: Array<{ questionId: string; storedAt: string }>;
    };
    let existing: Array<{ questionId?: string; storedAt?: string }> = [];
    try {
      const raw = await readFile(synthesisPath, "utf-8");
      existing = JSON.parse(raw) as Array<{ questionId?: string; storedAt?: string }>;
    } catch { json(res, { ok: true }); return; }

    if (body.entries) {
      // Bulk delete
      for (const e of body.entries) {
        existing = existing.filter(
          (s) => !(s.questionId === e.questionId && s.storedAt === e.storedAt)
        );
      }
    } else if (body.questionId && body.storedAt) {
      existing = existing.filter(
        (s) => !(s.questionId === body.questionId && s.storedAt === body.storedAt)
      );
    }
    await mkdir(settingsDir, { recursive: true });
    await writeFile(synthesisPath, JSON.stringify(existing, null, 2));
    json(res, { ok: true });
    return;
  }

  if (path.startsWith("/synthesis/") && method === "DELETE") {
    const storedAt = decodeURIComponent(path.slice("/synthesis/".length));
    let existing: Array<{ storedAt?: string }> = [];
    try {
      const raw = await readFile(synthesisPath, "utf-8");
      existing = JSON.parse(raw) as Array<{ storedAt?: string }>;
    } catch { /* file doesn't exist */ }
    const filtered = existing.filter((e) => String(e.storedAt) !== storedAt);
    await mkdir(settingsDir, { recursive: true });
    await writeFile(synthesisPath, JSON.stringify(filtered, null, 2));
    json(res, { ok: true });
    return;
  }

  // ─── Digest (auto-generated periodic brief) ───

  const digestPath = join(settingsDir, "digest.json");

  if (path === "/digest" && method === "GET") {
    try {
      const raw = await readFile(digestPath, "utf-8");
      json(res, JSON.parse(raw));
    } catch {
      json(res, null);
    }
    return;
  }

  if (path === "/digest" && method === "POST") {
    const body = JSON.parse(await readBody(req)) as { period?: string };
    const period = body.period ?? "7d";

    const settings = await loadSettings();
    if (!settings.apiKey) {
      error(res, "No API key configured. Add your Anthropic API key in Settings.", 400);
      return;
    }

    // 1. Load sessions for the requested period
    await mkdir(sessionsDir, { recursive: true });
    const sessionFiles = await readdir(sessionsDir);
    const allDigestSessions: Array<Record<string, unknown>> = [];
    for (const file of sessionFiles) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        allDigestSessions.push(JSON.parse(raw) as Record<string, unknown>);
      } catch { /* skip corrupt files */ }
    }

    const periodMs: Record<string, number> = {
      "24h": 86400000,
      "7d": 604800000,
      "30d": 2592000000,
      "90d": 7776000000,
    };
    const cutoff = period === "all" ? 0 : Date.now() - (periodMs[period] ?? 604800000);
    const digestSessions = allDigestSessions.filter((s) => {
      const t = new Date(String(s.createdAt ?? "")).getTime();
      return !isNaN(t) && t >= cutoff;
    });

    if (digestSessions.length === 0) {
      const emptyDigest = {
        generatedAt: new Date().toISOString(),
        period,
        sections: [{ title: "No Data", body: "No sessions found in this period. Start capturing to build your digest." }],
      };
      const updatedSettings = await loadSettings();
      (updatedSettings as Record<string, unknown>).lastDigestAt = new Date().toISOString();
      await saveSettings(updatedSettings);
      json(res, emptyDigest);
      return;
    }

    // 2. Build data brief
    const dTotalSessions = digestSessions.length;
    const dTotalPatterns = digestSessions.reduce((sum, s) => sum + (Array.isArray(s.detections) ? (s.detections as unknown[]).length : 0), 0);
    const dTotalWords = digestSessions.reduce((sum, s) => {
      const segs = s.segments as Array<{ text?: string }> | undefined;
      if (!Array.isArray(segs)) return sum;
      return sum + segs.reduce((wc, seg) => wc + ((seg.text as string) ?? "").trim().split(/\s+/).filter(Boolean).length, 0);
    }, 0);

    const patFreq = new Map<string, number>();
    for (const s of digestSessions) {
      const dets = Array.isArray(s.detections) ? s.detections as Array<{ patternId?: string }> : [];
      for (const d of dets) {
        if (d.patternId) patFreq.set(d.patternId, (patFreq.get(d.patternId) ?? 0) + 1);
      }
    }
    const dTopPatterns = [...patFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => ({ id, count }));

    const sourceBreak = new Map<string, number>();
    for (const s of digestSessions) {
      const st = String(s.sourceType ?? "other");
      sourceBreak.set(st, (sourceBreak.get(st) ?? 0) + 1);
    }

    let stateImprovedCount = 0;
    let stateDeclinedCount = 0;
    for (const s of digestSessions) {
      const cis = s.checkIns as Array<{ context?: string; energy?: number; clarity?: number; groundedness?: number; openness?: number }> | undefined;
      if (!Array.isArray(cis)) continue;
      const before = cis.find((c) => c.context === "before");
      const after = cis.find((c) => c.context === "after");
      if (!before || !after) continue;
      const dims = ["energy", "clarity", "groundedness", "openness"] as const;
      const delta = dims.reduce((sum, d) => sum + ((after[d] ?? 0) - (before[d] ?? 0)), 0);
      if (delta > 0) stateImprovedCount++;
      else if (delta < 0) stateDeclinedCount++;
    }

    const dataBrief = JSON.stringify({
      totalSessions: dTotalSessions, totalPatterns: dTotalPatterns, totalWords: dTotalWords,
      topPatterns: dTopPatterns,
      sourceTypeBreakdown: Object.fromEntries(sourceBreak),
      stateImprovedCount, stateDeclinedCount, period,
    }, null, 0);

    // 3. Call Claude to generate 4 digest sections
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: settings.apiKey });

    const digestPrompts = [
      { title: "Environment Overview", prompt: `Based on this data brief, write a 2-3 sentence overview of this person's rhetorical environment for the period. How many sessions, how many patterns detected, what source types dominated? Keep it factual and reflective.\n\nData: ${dataBrief}` },
      { title: "Pattern Landscape", prompt: `Based on this data brief, write a 2-3 sentence description of the most prominent rhetorical patterns detected. What patterns appeared most? Are there any worth paying attention to? Keep it observational, not prescriptive.\n\nData: ${dataBrief}` },
      { title: "State Trajectory", prompt: `Based on this data brief, write a 2-3 sentence observation about how sessions affected this person's state. Out of sessions with before/after check-ins, how many showed improvement vs decline? What does this suggest about their media diet? Be reflective, not judgmental.\n\nData: ${dataBrief}` },
      { title: "Looking Ahead", prompt: `Based on this data brief, write 2-3 sentences suggesting what this person might want to notice going forward. What patterns or sources deserve attention? What might be a healthy next step? Keep it gentle and empowering, not prescriptive.\n\nData: ${dataBrief}` },
    ];

    const systemPrompt = `You are a rhetorical literacy advisor for Forti Fide, a desktop app that detects rhetorical patterns in media. You are writing a periodic digest — a brief, reflective summary of the user's recent rhetorical environment. Write in a warm, observational tone. Never be alarming or condescending. Focus on awareness, not prescription. Keep each section to 2-3 sentences.`;

    const resultSections: Array<{ title: string; body: string }> = [];
    for (const section of digestPrompts) {
      try {
        const message = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: section.prompt }],
        });
        let text = "";
        for (const block of message.content) {
          if (block.type === "text") text += block.text;
        }
        resultSections.push({ title: section.title, body: text });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AI request failed";
        console.error(`[DIGEST] Error on section "${section.title}":`, msg);
        resultSections.push({ title: section.title, body: `Error generating this section: ${msg}` });
      }
    }

    const digestData = { generatedAt: new Date().toISOString(), period, sections: resultSections };

    // 4. Save to disk + update lastDigestAt
    await mkdir(settingsDir, { recursive: true });
    await writeFile(digestPath, JSON.stringify(digestData, null, 2));

    const finalSettings = await loadSettings();
    (finalSettings as Record<string, unknown>).lastDigestAt = new Date().toISOString();
    await saveSettings(finalSettings);

    json(res, digestData);
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API — /api/* routes for external consumers (DreamOS)
  // ═══════════════════════════════════════════════════════════

  // ─── Helpers shared by API routes ───

  async function loadAllSessions(): Promise<Array<{ data: Record<string, unknown>; file: string }>> {
    await mkdir(sessionsDir, { recursive: true });
    const files = await readdir(sessionsDir);
    const sessions: Array<{ data: Record<string, unknown>; file: string }> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        sessions.push({ data: JSON.parse(raw) as Record<string, unknown>, file });
      } catch { continue; }
    }
    return sessions;
  }

  function sessionDurationSeconds(s: Record<string, unknown>): number {
    const segs = s.segments as Array<{ capturedAt: number }> | undefined;
    if (!segs || segs.length < 2) return 0;
    return Math.max(0, (segs[segs.length - 1]!.capturedAt - segs[0]!.capturedAt) / 1000);
  }

  function extractSpeakers(s: Record<string, unknown>): ApiSpeaker[] {
    const segs = (s.segments ?? []) as Array<{ speaker?: string; text: string; capturedAt: number }>;
    const speakerMap = (s.speakerMap ?? {}) as Record<string, string>;
    const detections = (s.detections ?? []) as Array<{ speaker?: string }>;

    const map = new Map<string, { turns: number; chars: number; firstAt: number; lastAt: number; patterns: number }>();
    for (const seg of segs) {
      const label = seg.speaker ?? "Unknown";
      const entry = map.get(label) ?? { turns: 0, chars: 0, firstAt: seg.capturedAt, lastAt: seg.capturedAt, patterns: 0 };
      entry.turns++;
      entry.chars += seg.text.length;
      if (seg.capturedAt < entry.firstAt) entry.firstAt = seg.capturedAt;
      if (seg.capturedAt > entry.lastAt) entry.lastAt = seg.capturedAt;
      map.set(label, entry);
    }
    for (const det of detections) {
      const label = det.speaker ?? "Unknown";
      const entry = map.get(label);
      if (entry) entry.patterns++;
    }

    return [...map.entries()].map(([label, info]) => ({
      label,
      displayName: speakerMap[label] ?? undefined,
      turnCount: info.turns,
      totalSpeechSeconds: Math.max(0, (info.lastAt - info.firstAt) / 1000),
      patternCount: info.patterns,
    }));
  }

  function buildDetections(s: Record<string, unknown>): ApiPatternDetection[] {
    const dets = (s.detections ?? []) as Array<{
      id: string; patternId: string; phrase: string;
      phrasePosition: { start: number; end: number };
      confidence: number; confidenceTier: string;
      timestamp: string; speaker?: string;
    }>;
    return dets.map((d) => {
      const pat = getPattern(d.patternId);
      return {
        id: d.id,
        patternId: d.patternId,
        patternName: pat?.name ?? d.patternId.replace(/-/g, " "),
        category: (pat?.category ?? "framing") as ApiPatternDetection["category"],
        confidence: d.confidence,
        confidenceTier: d.confidenceTier as ApiPatternDetection["confidenceTier"],
        phrase: d.phrase,
        phrasePosition: d.phrasePosition,
        speaker: d.speaker,
        timestamp: d.timestamp,
      };
    });
  }

  async function buildAudioInfo(s: Record<string, unknown>): Promise<ApiAudioInfo> {
    const audioDir = s.audioSessionId
      ? sanitizeFilename(String(s.audioSessionId))
      : sanitizeFilename(String(s.id));
    const sessionId = String(s.id);

    let micSize: number | null = null;
    let sysSize: number | null = null;

    try {
      const st = await stat(join(sessionsDir, audioDir, "mic.wav"));
      micSize = st.size;
    } catch {}
    try {
      const st = await stat(join(sessionsDir, audioDir, "system.wav"));
      sysSize = st.size;
    } catch {}
    // Legacy fallback
    if (micSize === null && sysSize === null) {
      try {
        const st = await stat(join(sessionsDir, audioDir, "audio.wav"));
        sysSize = st.size;
      } catch {}
    }

    return {
      hasAudio: micSize !== null || sysSize !== null,
      mic: micSize !== null ? { sizeBytes: micSize, url: `/sessions/${encodeURIComponent(sessionId)}/audio/mic` } : null,
      system: sysSize !== null ? { sizeBytes: sysSize, url: `/sessions/${encodeURIComponent(sessionId)}/audio/system` } : null,
      audioSessionId: s.audioSessionId ? String(s.audioSessionId) : undefined,
    };
  }

  function buildSummary(s: Record<string, unknown>, audio: ApiAudioInfo): ApiSessionSummary {
    const text = (s.text as string) ?? "";
    const segs = (s.segments ?? []) as Array<{ speaker?: string }>;
    const speakers = new Set(segs.map((seg) => seg.speaker ?? "Unknown"));
    const dets = Array.isArray(s.detections) ? s.detections : [];

    return {
      id: String(s.id),
      createdAt: String(s.createdAt),
      name: (s.name as string) ?? undefined,
      textPreview: text.slice(0, 200),
      durationSeconds: sessionDurationSeconds(s),
      wordCount: (s.wordCount as number) ?? text.trim().split(/\s+/).filter(Boolean).length,
      speakerCount: speakers.size,
      patternCount: dets.length,
      hasAudio: audio.hasAudio,
      hasMicAudio: audio.mic !== null,
      hasSystemAudio: audio.system !== null,
      sourceType: (s.sourceType as ApiSessionSummary["sourceType"]) ?? undefined,
      colorTag: (s.colorTag as string) ?? null,
      hashtags: Array.isArray(s.hashtags) ? (s.hashtags as string[]) : [],
      edited: (s.edited as boolean) ?? false,
    };
  }

  // ─── GET /api/sessions — list all sessions ───

  if (path === "/api/sessions" && method === "GET") {
    try {
      const all = await loadAllSessions();
      const summaries: ApiSessionSummary[] = [];

      for (const { data } of all) {
        const audio = await buildAudioInfo(data);
        summaries.push(buildSummary(data, audio));
      }

      summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      json(res, { sessions: summaries, total: summaries.length });
    } catch (e) {
      error(res, e instanceof Error ? e.message : "Failed to list sessions", 500);
    }
    return;
  }

  // ─── GET /api/sessions/:id — full session detail ───

  if (path.startsWith("/api/sessions/") && method === "GET") {
    const sessionId = decodeURIComponent(path.slice("/api/sessions/".length));
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    try {
      const raw = await readFile(filePath, "utf-8");
      const s = JSON.parse(raw) as Record<string, unknown>;
      const audio = await buildAudioInfo(s);
      const summary = buildSummary(s, audio);
      const segs = ((s.segments ?? []) as Array<{ text: string; source: string; speaker?: string; capturedAt: number; timestamp: number }>)
        .map((seg) => ({ text: seg.text, source: seg.source, speaker: seg.speaker, capturedAt: seg.capturedAt, timestamp: seg.timestamp }));

      const checkIns = (Array.isArray(s.checkIns) ? s.checkIns : []) as Array<{
        type: string; energy: number; clarity: number; groundedness: number; openness: number; timestamp?: string; createdAt?: string;
      }>;

      const detail: ApiSessionDetail = {
        ...summary,
        text: (s.text as string) ?? "",
        segments: segs,
        patterns: buildDetections(s),
        speakers: extractSpeakers(s),
        audio,
        checkIns: checkIns.map((c) => ({
          type: c.type as "before" | "after",
          energy: c.energy,
          clarity: c.clarity,
          groundedness: c.groundedness,
          openness: c.openness,
          timestamp: (c.timestamp ?? c.createdAt ?? "") as string,
        })),
      };

      json(res, detail);
    } catch {
      error(res, "Session not found", 404);
    }
    return;
  }

  // ─── GET /api/patterns — all patterns across sessions ───

  if (path === "/api/patterns" && method === "GET") {
    const nameFilter = url.searchParams.get("name")?.toLowerCase();
    const minConfidence = parseFloat(url.searchParams.get("minConfidence") ?? "0");
    const categoryFilter = url.searchParams.get("category")?.toLowerCase();

    try {
      const all = await loadAllSessions();
      const aggregateMap = new Map<string, ApiPatternAggregate & { _sessionSet: Set<string> }>();

      for (const { data } of all) {
        const sessionId = String(data.id);
        const dets = (data.detections ?? []) as Array<{
          patternId: string; confidence: number; confidenceTier: string; timestamp: string;
        }>;

        for (const det of dets) {
          if (det.confidence < minConfidence) continue;

          const pat = getPattern(det.patternId);
          const name = pat?.name ?? det.patternId.replace(/-/g, " ");
          const category = pat?.category ?? "framing";

          if (nameFilter && !name.toLowerCase().includes(nameFilter) && !det.patternId.toLowerCase().includes(nameFilter)) continue;
          if (categoryFilter && category.toLowerCase() !== categoryFilter) continue;

          let agg = aggregateMap.get(det.patternId);
          if (!agg) {
            agg = {
              patternId: det.patternId,
              name,
              category: category as ApiPatternAggregate["category"],
              definition: pat?.definition ?? "",
              totalDetections: 0,
              confidenceTiers: { strong: 0, likely: 0, possible: 0 },
              sessionCount: 0,
              sessionIds: [],
              lastSeenAt: det.timestamp,
              _sessionSet: new Set(),
            };
            aggregateMap.set(det.patternId, agg);
          }

          agg.totalDetections++;
          const tier = det.confidenceTier as "strong" | "likely" | "possible";
          if (tier in agg.confidenceTiers) agg.confidenceTiers[tier]++;
          if (!agg._sessionSet.has(sessionId)) {
            agg._sessionSet.add(sessionId);
            agg.sessionIds.push(sessionId);
          }
          if (det.timestamp > agg.lastSeenAt) agg.lastSeenAt = det.timestamp;
        }
      }

      const patterns: ApiPatternAggregate[] = [...aggregateMap.values()]
        .map(({ _sessionSet, ...rest }) => ({ ...rest, sessionCount: _sessionSet.size }))
        .sort((a, b) => b.totalDetections - a.totalDetections);

      json(res, { patterns, total: patterns.length });
    } catch (e) {
      error(res, e instanceof Error ? e.message : "Failed to aggregate patterns", 500);
    }
    return;
  }

  // ─── GET /api/audio/:sessionId — audio file metadata ───

  if (path.startsWith("/api/audio/") && method === "GET") {
    const sessionId = decodeURIComponent(path.slice("/api/audio/".length));
    const filePath = join(sessionsDir, `${sanitizeFilename(sessionId)}.json`);

    try {
      const raw = await readFile(filePath, "utf-8");
      const s = JSON.parse(raw) as Record<string, unknown>;
      const audio = await buildAudioInfo(s);
      json(res, { sessionId, ...audio });
    } catch {
      error(res, "Session not found", 404);
    }
    return;
  }

  // ─── GET /export — full data export package ───

  if (path === "/export" && method === "GET") {
    const { exportAll } = await import("./storage-queries.js");
    const period = (url.searchParams.get("period") ?? "all") as "7d" | "30d" | "90d" | "all";
    try {
      const pkg = await exportAll(period);
      json(res, pkg);
    } catch (e) {
      error(res, e instanceof Error ? e.message : "Export failed", 500);
    }
    return;
  }

  // ─── 404 fallback ───

  error(res, "Not found", 404);
}

// ─── Server ───

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[SERVER] Unhandled error:", err);
    error(res, "Internal server error", 500);
  }
});

// ─── Boot: load API key from settings before listening ───
(async () => {
  try {
    const saved = await loadSettings();
    if (saved.apiKey) {
      process.env["ANTHROPIC_API_KEY"] = saved.apiKey;
      analyzer.reinitialize();
      console.log(`[FORTIFIDE] Loaded API key from settings.json`);
    }
  } catch (e) {
    console.error("[FORTIFIDE] Failed to load saved API key:", e);
  }

  server.listen(PORT, () => {
    console.log(`[FORTIFIDE] Rhetorical analysis server listening on port ${PORT}`);
  });
})();

process.on("SIGINT", () => {
  console.log("[FORTIFIDE] Shutting down...");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[FORTIFIDE] Shutting down...");
  server.close();
  process.exit(0);
});