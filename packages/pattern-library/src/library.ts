import type { PatternCategory, PatternEntry } from "./types.js";
import { manipulationPatterns } from "./categories/manipulation.js";
import { authorityPatterns } from "./categories/authority.js";
import { fallacyPatterns } from "./categories/fallacies.js";
import { emotionalPatterns } from "./categories/emotional.js";
import { framingPatterns } from "./categories/framing.js";
import { narrativePatterns } from "./categories/narrative.js";
import { cognitiveBiasPatterns } from "./categories/cognitive-bias.js";

export const LIBRARY_VERSION = "0.1.0";

const allPatterns: PatternEntry[] = [
  ...manipulationPatterns,
  ...authorityPatterns,
  ...fallacyPatterns,
  ...emotionalPatterns,
  ...framingPatterns,
  ...narrativePatterns,
  ...cognitiveBiasPatterns,
];

export function loadLibrary(): PatternEntry[] {
  return allPatterns;
}

export function getPattern(id: string): PatternEntry | undefined {
  return allPatterns.find((p) => p.id === id);
}

export function getCategory(category: PatternCategory): PatternEntry[] {
  return allPatterns.filter((p) => p.category === category);
}

export function getAllCategories(): PatternCategory[] {
  return [
    "manipulation",
    "authority",
    "fallacy",
    "emotional",
    "framing",
    "narrative",
    "cognitive-bias",
  ];
}
