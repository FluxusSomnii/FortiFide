import type { DetectionInstance } from "@fides/pattern-library";

export class HeuristicClassifier {
  preFilter(text: string): { obvious: DetectionInstance[]; ambiguous: string[] } {
    // TODO: Implement regex + keyword matching against pattern library's linguisticMarkers
    // Returns obvious matches (high confidence heuristic hits) and ambiguous text spans
    // that need LLM analysis
    void text;
    return { obvious: [], ambiguous: [] };
  }
}
