import type {
  ExecutionRunStatus,
  ExecutionStepStatus,
  Metadata,
  ReleaseDecisionStatus,
  WorkflowStepKind
} from "./shared";

export interface ExecutionStepRecord {
  stepId: string;
  kind: WorkflowStepKind;
  status: ExecutionStepStatus;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  outputRef?: string;
  outputSummary?: string;
  issues?: string[];
  metadata?: Metadata;
  annotations?: string[];
}

export interface ReleaseDecision {
  status: ReleaseDecisionStatus;
  summary: string;
  reasons?: string[];
  tags?: string[];
  decidedAt?: string;
  metadata?: Metadata;
  annotations?: string[];
}

export interface ExecutionRun {
  runId: string;
  workflowId: string;
  requestId: string;
  status: ExecutionRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  steps: ExecutionStepRecord[];
  releaseDecision?: ReleaseDecision;
  summary?: string;
  metadata?: Metadata;
  annotations?: string[];
}

