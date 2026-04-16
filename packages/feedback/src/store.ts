import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccuracyFeedback } from "./schema.js";

export interface FeedbackStore {
  record(feedback: AccuracyFeedback): Promise<void>;
  getByDetectionId(detectionId: string): Promise<AccuracyFeedback | undefined>;
  getAll(): Promise<AccuracyFeedback[]>;
  count(): Promise<number>;
}

async function loadFeedbacks(filePath: string): Promise<AccuracyFeedback[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as AccuracyFeedback[];
  } catch {
    return [];
  }
}

async function saveFeedbacks(
  filePath: string,
  feedbacks: AccuracyFeedback[],
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(feedbacks, null, 2));
}

export function createJsonFeedbackStore(filePath: string): FeedbackStore {
  return {
    async record(feedback: AccuracyFeedback): Promise<void> {
      const all = await loadFeedbacks(filePath);
      all.push(feedback);
      await saveFeedbacks(filePath, all);
    },

    async getByDetectionId(
      detectionId: string,
    ): Promise<AccuracyFeedback | undefined> {
      const all = await loadFeedbacks(filePath);
      return all.find((f) => f.detectionId === detectionId);
    },

    async getAll(): Promise<AccuracyFeedback[]> {
      return loadFeedbacks(filePath);
    },

    async count(): Promise<number> {
      const all = await loadFeedbacks(filePath);
      return all.length;
    },
  };
}
