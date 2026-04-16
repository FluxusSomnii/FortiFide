import type { AccuracyFeedback } from "./schema.js";

// Aggregates feedback to compute per-pattern false positive rates.
// This is used by the rhetorical engine to improve detection precision.
// It reads from FeedbackStore and cross-references with DetectionInstance data.
//
// NOTE: This aggregation operates on detectionId -> patternId lookups,
// NOT on a category field in the feedback schema. The feedback schema
// intentionally has no category field. Pattern association happens at
// query time through the detection store, never stored in feedback.

export interface PatternAccuracy {
  patternId: string;
  totalDetections: number;
  markedIncorrect: number;
  falsePositiveRate: number;
}

export function computeAccuracy(
  feedbacks: AccuracyFeedback[],
  detectionLookup: (detectionId: string) => string | undefined,
): PatternAccuracy[] {
  const totals = new Map<string, { total: number; incorrect: number }>();

  for (const fb of feedbacks) {
    const patternId = detectionLookup(fb.detectionId);
    if (patternId === undefined) continue;

    let entry = totals.get(patternId);
    if (!entry) {
      entry = { total: 0, incorrect: 0 };
      totals.set(patternId, entry);
    }

    entry.total += 1;
    if (fb.wasIncorrect) {
      entry.incorrect += 1;
    }
  }

  const results: PatternAccuracy[] = [];
  for (const [patternId, counts] of totals) {
    results.push({
      patternId,
      totalDetections: counts.total,
      markedIncorrect: counts.incorrect,
      falsePositiveRate:
        counts.total > 0 ? counts.incorrect / counts.total : 0,
    });
  }

  return results;
}
