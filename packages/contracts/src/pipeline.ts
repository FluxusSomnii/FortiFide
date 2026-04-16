import type { WorkflowDefinition } from "./workflow";
import type {
  ExecutionTraceEntry,
  PipelineReleaseDecision,
  SharedReasoningState
} from "./role-contracts";

export interface WorkflowSelection {
  workflow: WorkflowDefinition;
  rationale: WorkflowSelectionRationale;
}

export interface WorkflowSelectionRationale {
  summary: string;
  reasons: string[];
}

export interface PipelineResult {
  missionId: string;
  state: SharedReasoningState;
  releaseDecision: PipelineReleaseDecision | undefined;
  executionTrace: ExecutionTraceEntry[];
}

export interface ExecutionResult {
  run_id: string;
  workflow_id: string;
  trace: ExecutionTrace;
  release_decision: LegacyReleaseDecision;
}

export interface ExecutionTrace {
  run_id: string;
  workflow_id: string;
  events: ExecutionTraceEvent[];
}

export interface ExecutionTraceEvent {
  event_id: string;
  kind: string;
  step_id: string;
  detail: string;
  recorded_at: string;
}

export interface LegacyReleaseDecision {
  status: string;
  summary: string;
  requires_human_review?: boolean;
}

export type ReleaseStatus = "held" | "approved" | "blocked" | "needs_review";
