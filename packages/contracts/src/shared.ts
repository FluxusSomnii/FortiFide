export type MetadataValue = string | number | boolean | null;
export type Metadata = Record<string, MetadataValue>;

export type WorkflowStepKind = "collect" | "analyze" | "decide" | "finalize";
export type SelectionFactorDirection = "supports" | "opposes" | "neutral";
export type ExecutionRunStatus = "pending" | "running" | "completed" | "failed";
export type ExecutionStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";
export type ReleaseDecisionStatus = "approved" | "blocked" | "needs_review";

