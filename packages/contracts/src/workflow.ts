import type { Metadata, ReleaseDecisionStatus, WorkflowStepKind } from "./shared";

export interface WorkflowStepConfig {
  mode?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  title: string;
  description?: string;
  required: boolean;
  config?: WorkflowStepConfig;
  metadata?: Metadata;
  annotations?: string[];
}

export interface WorkflowDefinition {
  id: string;
  version: string;
  title: string;
  description?: string;
  tags?: string[];
  steps: WorkflowStep[];
  defaultReleasePolicyHint?: ReleaseDecisionStatus;
  metadata?: Metadata;
  annotations?: string[];
}

