export type ConfidenceTier = "possible" | "likely" | "strong";

export interface PatternEntry {
  id: string;
  name: string;
  category: PatternCategory;
  definition: string;
  linguisticMarkers: string[];
  examples: string[];
  counterExamples: string[];
}

export type PatternCategory =
  | "manipulation"
  | "authority"
  | "fallacy"
  | "emotional"
  | "framing"
  | "narrative"
  | "cognitive-bias";

export interface DetectionInstance {
  id: string;
  sessionId: string;
  patternId: string;
  phrase: string;
  phrasePosition: { start: number; end: number };
  confidence: number;
  confidenceTier: ConfidenceTier;
  timestamp: string;
  speaker?: string;
}

export function confidenceTier(confidence: number): ConfidenceTier | null {
  if (confidence < 0.4) return null;
  if (confidence < 0.6) return "possible";
  if (confidence < 0.8) return "likely";
  return "strong";
}
