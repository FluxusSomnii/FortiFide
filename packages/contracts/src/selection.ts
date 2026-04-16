import type { Metadata, SelectionFactorDirection } from "./shared";

export interface SelectorInput {
  requestId: string;
  inputText: string;
  requestedMode?: string;
  tags?: string[];
  constraints?: string[];
  metadata?: Metadata;
  annotations?: string[];
}

export interface SelectionFactor {
  key: string;
  label: string;
  direction: SelectionFactorDirection;
  score?: number;
  explanation: string;
}

export interface SelectionRationale {
  // Human-readable summary for logs and operator views.
  summary: string;
  // Machine-checked factor list for later scoring and provider integration.
  factors: SelectionFactor[];
}

export interface SelectionDecision {
  decisionId: string;
  selectedWorkflowId: string;
  confidence: number;
  rationale: SelectionRationale;
  alternativeWorkflowIds?: string[];
  requiresReview?: boolean;
  metadata?: Metadata;
  annotations?: string[];
}

