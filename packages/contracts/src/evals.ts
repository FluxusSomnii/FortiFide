import type { ExecutionRun } from "./execution";
import type { Metadata, ReleaseDecisionStatus } from "./shared";
import type { SelectionDecision, SelectorInput } from "./selection";

export interface EvalExpectedSelection {
  selectedWorkflowId: string;
  minimumConfidence?: number;
  requiresReview?: boolean;
}

export interface EvalExpectedReleaseDecision {
  status: ReleaseDecisionStatus;
  tags?: string[];
}

export interface EvalFixture {
  fixtureId: string;
  title: string;
  selectorInput: SelectorInput;
  expectedSelection?: EvalExpectedSelection;
  expectedReleaseDecision?: EvalExpectedReleaseDecision;
  notes?: string[];
  metadata?: Metadata;
  annotations?: string[];
}

export interface EvalCheck {
  key: string;
  label: string;
  passed: boolean;
  summary: string;
  expected?: string;
  actual?: string;
}

export interface EvalResult {
  fixtureId: string;
  passed: boolean;
  summary: string;
  checks: EvalCheck[];
  actualSelection?: SelectionDecision;
  actualRun?: ExecutionRun;
  startedAt?: string;
  completedAt?: string;
  metadata?: Metadata;
  annotations?: string[];
}
