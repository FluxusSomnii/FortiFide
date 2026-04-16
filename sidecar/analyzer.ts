import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import {
  loadLibrary,
  confidenceTier,
  LIBRARY_VERSION,
  type DetectionInstance,
  type PatternEntry,
} from "@fides/pattern-library";

// Normalize curly quotes and fancy dashes that LLMs tend to straighten
function normalizeQuotes(str: string): string {
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-");
}

// ─── Speaker alignment types ───

interface DiarizationSegment {
  speaker: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  text: string;
  start: number;
  end: number;
}

interface SpeakerLabeledSegment {
  text: string;
  speaker: string;
  start: number;
  end: number;
}

/**
 * Align speaker labels from diarization with Whisper transcript segments.
 * For each Whisper segment, finds the dominant speaker during that time range.
 */
export function alignSpeakersWithTranscript(
  whisperSegments: WhisperSegment[],
  diarizationSegments: DiarizationSegment[],
): SpeakerLabeledSegment[] {
  return whisperSegments.map((ws) => {
    // Find overlapping diarization segments
    const overlaps: Array<{ speaker: string; duration: number }> = [];

    for (const ds of diarizationSegments) {
      const overlapStart = Math.max(ws.start, ds.start);
      const overlapEnd = Math.min(ws.end, ds.end);
      const duration = overlapEnd - overlapStart;

      if (duration > 0) {
        overlaps.push({ speaker: ds.speaker, duration });
      }
    }

    // Pick the speaker with the most overlap
    let bestSpeaker = "Unknown";
    let bestDuration = 0;
    const speakerDurations = new Map<string, number>();

    for (const o of overlaps) {
      const total = (speakerDurations.get(o.speaker) || 0) + o.duration;
      speakerDurations.set(o.speaker, total);
      if (total > bestDuration) {
        bestDuration = total;
        bestSpeaker = o.speaker;
      }
    }

    return {
      text: ws.text,
      speaker: overlaps.length > 0 ? bestSpeaker : "Unknown",
      start: ws.start,
      end: ws.end,
    };
  });
}

/**
 * Format speaker-labeled segments as dialogue for the LLM.
 * Groups consecutive segments by the same speaker.
 */
export function formatAsDialogue(segments: SpeakerLabeledSegment[]): string {
  if (segments.length === 0) return "";

  const lines: string[] = [];
  let currentSpeaker = "";
  let currentText = "";

  for (const seg of segments) {
    if (seg.speaker !== currentSpeaker) {
      if (currentText.trim()) {
        lines.push(`${currentSpeaker}: "${currentText.trim()}"`);
      }
      currentSpeaker = seg.speaker;
      currentText = seg.text;
    } else {
      currentText += " " + seg.text;
    }
  }

  if (currentText.trim()) {
    lines.push(`${currentSpeaker}: "${currentText.trim()}"`);
  }

  return lines.join("\n");
}

// In-memory detection store for patternId lookups
// (feedback accuracy needs to resolve detectionId → patternId)
const detectionStore = new Map<string, DetectionInstance>();

export function lookupPatternId(detectionId: string): string | undefined {
  return detectionStore.get(detectionId)?.patternId;
}

export class RhetoricalAnalyzer {
  private client: Anthropic;
  private library: PatternEntry[];
  private systemPrompt: string;

  constructor() {
    this.client = new Anthropic();
    this.library = loadLibrary();
    this.systemPrompt = this.buildSystemPrompt();
  }

  // Call this after API key is set in env to reinitialize the client
  reinitialize(): void {
    this.client = new Anthropic();
  }

  async analyze(
    text: string,
    sessionId: string,
  ): Promise<DetectionInstance[]> {
    if (!text.trim()) return [];

    console.log(
      `[ANALYZER] Analyzing ${text.length} characters for session ${sessionId}`,
    );

    let rawResponse: string;
    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: this.systemPrompt,
        messages: [{ role: "user", content: text }],
        temperature: 0.1,
      });

      const textBlock = response.content.find(
        (block) => block.type === "text",
      );
      rawResponse = textBlock?.text ?? "[]";

      console.log(
        `[ANALYZER] Tokens: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`,
      );
    } catch (err) {
      console.error("[ANALYZER] LLM call failed:", err);
      throw err;
    }

    // Parse LLM response
    let rawDetections: Array<{
      patternId: string;
      phrase: string;
      start: number;
      end: number;
      confidence: number;
    }>;

    try {
      // Strip markdown code block fencing if the LLM added it despite instructions
      let cleaned = rawResponse.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
      }
      rawDetections = JSON.parse(cleaned) as typeof rawDetections;
    } catch {
      console.error(
        "[ANALYZER] Failed to parse LLM response as JSON:",
        rawResponse.slice(0, 200),
      );
      return [];
    }

    if (!Array.isArray(rawDetections)) {
      console.error("[ANALYZER] LLM response was not an array");
      return [];
    }

    // Validate and convert to DetectionInstance
    const detections: DetectionInstance[] = [];

    for (const raw of rawDetections) {
      // Validate required fields exist
      if (
        !raw.patternId ||
        !raw.phrase ||
        typeof raw.start !== "number" ||
        typeof raw.end !== "number" ||
        typeof raw.confidence !== "number"
      ) {
        console.warn(
          "[ANALYZER] Skipping malformed detection:",
          JSON.stringify(raw).slice(0, 100),
        );
        continue;
      }

      // Validate pattern exists in library
      const patternExists = this.library.some((p) => p.id === raw.patternId);
      if (!patternExists) {
        console.warn(
          `[ANALYZER] Unknown pattern ID: ${raw.patternId}, skipping`,
        );
        continue;
      }

      // Validate confidence range
      const clampedConfidence = Math.max(0, Math.min(1, raw.confidence));

      // Derive confidence tier — skip if below display threshold
      const tier = confidenceTier(clampedConfidence);
      if (tier === null) {
        continue; // Below 0.4, not a reportable detection
      }

      // Validate phrase position against actual text
      // The LLM sometimes gets positions slightly wrong — attempt to correct
      let start = raw.start;
      let end = raw.end;
      const actualSubstring = text.slice(start, end);

      if (actualSubstring !== raw.phrase) {
        // Try to find the exact phrase in the text
        const foundIndex = text.indexOf(raw.phrase);
        if (foundIndex !== -1) {
          start = foundIndex;
          end = foundIndex + raw.phrase.length;
        } else {
          // LLM may normalize curly quotes/dashes — try matching with normalized text
          const normalizedText = normalizeQuotes(text);
          const normalizedPhrase = normalizeQuotes(raw.phrase);
          const normalizedIndex = normalizedText.indexOf(normalizedPhrase);
          if (normalizedIndex !== -1) {
            start = normalizedIndex;
            end = normalizedIndex + raw.phrase.length;
          } else {
            // Phrase not found even after normalization — likely hallucinated, skip
            console.warn(
              `[ANALYZER] Phrase not found in text: "${raw.phrase.slice(0, 50)}"`,
            );
            continue;
          }
        }
      }

      const rawSpeaker = (raw as Record<string, unknown>).speaker;
      const detection: DetectionInstance = {
        id: randomUUID(),
        sessionId,
        patternId: raw.patternId,
        phrase: raw.phrase,
        phrasePosition: { start, end },
        confidence: clampedConfidence,
        confidenceTier: tier,
        timestamp: new Date().toISOString(),
        ...(typeof rawSpeaker === "string" && rawSpeaker ? { speaker: rawSpeaker } : {}),
      };

      detections.push(detection);
      detectionStore.set(detection.id, detection);
    }

    console.log(
      `[ANALYZER] Found ${detections.length} detections (from ${rawDetections.length} raw)`,
    );
    return detections;
  }

  private buildSystemPrompt(): string {
    const libraryRef = this.library.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      definition: p.definition,
      markers: p.linguisticMarkers,
    }));

    return `You are a rhetorical pattern detection engine. You analyze text and identify instances of known rhetorical and psychological patterns.

You are an instrument, not an advisor. You detect patterns. You do not evaluate, judge, or recommend.

## Pattern Library (version ${LIBRARY_VERSION})

${JSON.stringify(libraryRef, null, 2)}

## Your Task

Given a block of text, identify every instance where a pattern from the library above is present. For each detection, return:
- patternId: the exact "id" from the library
- phrase: the exact substring from the input text that triggered the detection (copy it verbatim, character-for-character)
- start: the character offset where the phrase begins in the input text (0-indexed)
- end: the character offset where the phrase ends in the input text
- confidence: a float from 0.0 to 1.0

## Confidence Calibration

- 0.8 to 1.0 (strong): The pattern is clearly and unambiguously present. The language is a textbook instance of this rhetorical technique.
- 0.6 to 0.8 (likely): The pattern is probably present but there is some ambiguity. The language strongly resembles the pattern but could have a legitimate non-manipulative reading.
- 0.4 to 0.6 (possible): The pattern might be present. The language has some markers but the context could go either way.
- Below 0.4: Do not report. If you are less than 40% confident, it is not a detection.

## Critical: Avoiding False Positives

Many phrases that contain linguistic markers are NOT instances of the pattern. The difference is context and intent:
- A real deadline ("Tax filing is due April 15th") is NOT false urgency.
- Citing a qualified expert's published findings is NOT appeal to authority.
- Describing actual scarcity ("Only 3 tickets remain for this sold-out event") is NOT scarcity framing.
- Expressing genuine emotion ("I was heartbroken when I heard the news") is NOT emotional hijacking.

Be conservative. When in doubt, either lower your confidence or do not report the detection. A false negative (missing a real pattern) is better than a false positive (flagging legitimate language).

## Output Format

Respond with a JSON array ONLY. No markdown, no code blocks, no explanation, no prose. Just the raw JSON array.

If no patterns are detected, respond with: []

Each element in the array:
{
  "patternId": "string",
  "phrase": "string",
  "start": number,
  "end": number,
  "confidence": number,
  "speaker": "string or omit if not applicable"
}

## Dialogue Format

When the input text is formatted as dialogue (e.g. 'Person 1: "text"'), each detection should include a "speaker" field identifying which person used the pattern. Attribute the pattern to the specific speaker who said the phrase. If the text is not in dialogue format, omit the speaker field.`;
  }

  async attributeSpeakers(
    text: string,
    _sessionId: string,
  ): Promise<{ segments: Array<{ text: string; speaker: string }> }> {
    console.log(`[ANALYZER] Deep mode: attributing speakers for ${text.length} chars`);

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: `You are a speaker attribution engine. Given a block of transcribed audio, identify speaker boundaries.

Look for: question/answer patterns, topic shifts, pronoun changes, register shifts, conversational turn-taking signals.

Respond with a JSON object ONLY:
{"segments":[{"text":"what speaker said","speaker":"Person 1"},{"text":"next speaker","speaker":"Person 2"}]}

Rules:
- Every word from the input must appear in exactly one segment
- Use "Person 1", "Person 2" etc. consistently
- If you cannot determine boundaries, return the entire text as one segment with speaker "Person 1"`,
      messages: [{ role: "user", content: text }],
    });

    const block = response.content.find((b) => b.type === "text");
    const raw = block?.text ?? "{}";

    console.log(`[ANALYZER] Speaker attribution: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);

    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(cleaned) as { segments: Array<{ text: string; speaker: string }> };
      if (Array.isArray(parsed.segments)) return parsed;
    } catch {
      console.error("[ANALYZER] Failed to parse speaker attribution response");
    }

    return { segments: [{ text, speaker: "Person 1" }] };
  }

  async cleanupTranscript(
    segments: Array<{ text: string; speaker?: string; start: number; end: number }>,
    sessionId: string,
  ): Promise<{ segments: Array<{ text: string; speaker: string; start: number; end: number }> }> {
    console.log(`[ANALYZER] Retranscribe cleanup for ${segments.length} segments`);

    if (!this.client) {
      throw new Error("Anthropic API client not initialized. Set API key in settings.");
    }

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      temperature: 0.1,
      system: `You are a transcript editor. You will receive a raw speech-to-text transcript with speaker labels as a JSON array of segments. Each segment has: text (string), speaker (string), start (number, seconds), end (number, seconds).

Your job is to improve accuracy without changing meaning. Fix:
- Obvious transcription errors and misheared words
- Punctuation and sentence boundaries
- Speaker label assignments where context makes the correct speaker clear

Do NOT:
- Add words that were not spoken
- Remove content
- Change meaning or rewrite sentences
- Alter start/end timestamps

Return the corrected transcript as a JSON array of segments with the same fields: speaker (string), text (string), start (number), end (number). Preserve the original start and end values exactly. Return ONLY the JSON array, no other text.`,
      messages: [{ role: "user", content: JSON.stringify(segments) }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.text ?? "[]";

    console.log(`[ANALYZER] Cleanup tokens: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);

    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(cleaned) as Array<{ text: string; speaker: string; start: number; end: number }>;
      if (Array.isArray(parsed)) {
        return { segments: parsed };
      }
    } catch {
      console.error("[ANALYZER] Failed to parse cleanup response");
    }

    // Fallback: return originals with speaker filled in
    return {
      segments: segments.map((s) => ({
        text: s.text,
        speaker: s.speaker ?? "Unknown",
        start: s.start,
        end: s.end,
      })),
    };
  }
}
