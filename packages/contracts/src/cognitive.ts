// ─── Artifacts ───

export type ArtifactType =
  | "note"
  | "link"
  | "file"
  | "reflection"
  | "chat-fragment"
  | "bookmark"
  | "decision"
  | "sketch"
  | "question";

export interface Artifact {
  id: string;
  type: ArtifactType;
  source: string;
  content: string;
  timestamp: string;
  tags: string[];
  projectId?: string;
  privacyScope: "private" | "shared";
}

// ─── Observations ───

export type ObservationKind =
  | "question"
  | "hypothesis"
  | "idea"
  | "decision"
  | "contradiction"
  | "insight"
  | "reference"
  | "task"
  | "reflection";

export interface Observation {
  id: string;
  artifactId: string;
  kind: ObservationKind;
  summary: string;
  conceptRefs: string[];
  threadRefs: string[];
  confidence: number;
  timestamp: string;
}

// ─── Threads ───

export type ThreadStatus = "active" | "dormant" | "resolved" | "archived";

export interface Thread {
  id: string;
  name: string;
  description: string;
  artifactIds: string[];
  observationIds: string[];
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Patterns ───

export type PatternStatus =
  | "detected"
  | "recurring"
  | "reviewable"
  | "confirmed"
  | "hardened";

export interface Pattern {
  id: string;
  threadIds: string[];
  description: string;
  recurrenceCount: number;
  confidence: number;
  status: PatternStatus;
  evidenceArtifactIds: string[];
  detectedAt: string;
  lastSeenAt: string;
}

// ─── Heuristics ───

export interface Heuristic {
  id: string;
  patternSourceId: string;
  rule: string;
  usageCount: number;
  confirmed: boolean;
  createdAt: string;
}

// ─── Reviews ───

export type ReviewType =
  | "recurring-theme"
  | "contradiction"
  | "concept-stabilization"
  | "synthesis"
  | "heuristic-proposal"
  | "dormant-reactivation";

export type ReviewAction = "confirm" | "reject" | "edit" | "defer";

export interface PipelineTraceStep {
  role: string;
  outputSummary: string;
  issuesRaised: number;
  mutations: string[];
}

export interface Review {
  id: string;
  type: ReviewType;
  title: string;
  summary: string;
  evidenceArtifactIds: string[];
  confidence: number;
  suggestedActions: ReviewAction[];
  userAction?: ReviewAction;
  userNotes?: string;
  pipelineTrace?: PipelineTraceStep[];
  createdAt: string;
  resolvedAt?: string;
}

export interface ReviewActionResult {
  review: Review;
  updatedPatterns: Pattern[];
  createdHeuristics: Heuristic[];
  updatedThreads: Thread[];
}

// ─── Triggers ───

export type TriggerReason =
  | "new-thread"
  | "contradiction-detected"
  | "pattern-recurrence"
  | "scheduled-reflection"
  | "user-requested"
  | "dormant-reactivation"
  | "concept-convergence"
  | "thread-maturity";

export interface TriggerDecision {
  shouldRun: boolean;
  priority: "low" | "medium" | "high";
  reason: TriggerReason;
  workflowType?: string;
  contextArtifactIds?: string[];
}

// ─── Long-Term Memory ───

export type MemoryTier = "working" | "long-term";

export type LongTermSourceType =
  | "concept"
  | "heuristic"
  | "project-summary"
  | "workflow-template"
  | "stable-thread";

export interface ProvenanceChain {
  artifactIds: string[];
  observationIds: string[];
  threadIds: string[];
  patternIds: string[];
  reviewIds: string[];
  heuristicIds: string[];
}

export interface LongTermEntry {
  id: string;
  tier: "long-term";
  sourceType: LongTermSourceType;
  title: string;
  content: string;
  sourcePatternIds: string[];
  sourceReviewIds: string[];
  confidence: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  provenance: ProvenanceChain;
}

export interface LongTermFilter {
  sourceType?: LongTermSourceType;
  minConfidence?: number;
}

export interface WorkingMemoryState {
  activeThreads: Thread[];
  recentArtifacts: Artifact[];
  pendingObservations: Observation[];
  unresolvedContradictions: Observation[];
  pendingReviews: Review[];
  currentProjectContext?: string;
}

// ─── Assembled Context ───

export interface AssembledContext {
  triggerReason: TriggerReason;
  relevantArtifacts: Artifact[];
  relevantObservations: Observation[];
  relatedThreads: Thread[];
  existingPatterns: Pattern[];
  existingHeuristics: Heuristic[];
  longTermEntries: LongTermEntry[];
  missionPrompt: string;
}

// ─── Memory Graph Edges ───

export type EdgeType =
  | "DERIVED_FROM"
  | "BELONGS_TO"
  | "RELATES_TO"
  | "CONTRADICTS"
  | "SUPPORTS"
  | "RECURS_IN"
  | "GENERATED"
  | "CONFIRMED_BY"
  | "HARDENED_INTO";

export type GraphNodeType =
  | "artifact"
  | "observation"
  | "thread"
  | "pattern"
  | "heuristic"
  | "review"
  | "long-term-entry";

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  fromNodeType: GraphNodeType;
  toNodeId: string;
  toNodeType: GraphNodeType;
  edgeType: EdgeType;
  metadata?: Record<string, string>;
  createdAt: string;
}

// ─── Cognitive Modes ───

export type CognitiveMode =
  | "passive"
  | "reflective"
  | "critical"
  | "incubation"
  | "compression"
  | "co-reasoning";

export interface TriggerConfig {
  enableContradictionTrigger: boolean;
  enableRecurrenceTrigger: boolean;
  enableConvergenceTrigger: boolean;
  enableMaturityTrigger: boolean;
  recurrenceThreshold: number;
  maturityArtifactThreshold: number;
  maturityConsistencyThreshold: number;
}

export interface ModeConfig {
  mode: CognitiveMode;
  triggerOverrides?: Partial<TriggerConfig>;
  workflowClass?: string;
  description: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  mode: CognitiveMode;
  cronExpression?: string;
  intervalMs?: number;
  lastRunAt?: string;
  nextRunAt?: string;
  enabled: boolean;
}

export interface SchedulerState {
  tasks: ScheduledTask[];
  currentMode: CognitiveMode;
  isRunning: boolean;
  startedAt?: string;
}

// ─── Filters and Stats ───

export interface ArtifactFilter {
  type?: ArtifactType;
  source?: string;
  projectId?: string;
  tags?: string[];
}

export interface ThreadFilter {
  status?: ThreadStatus;
}

export interface PatternFilter {
  status?: PatternStatus;
}

export interface MemoryStats {
  artifactCount: number;
  observationCount: number;
  threadCount: number;
  patternCount: number;
  heuristicCount: number;
  reviewCount: number;
  edgeCount: number;
  pendingReviewCount: number;
  confirmedReviewCount: number;
  rejectedReviewCount: number;
  deferredReviewCount: number;
  longTermEntryCount: number;
  activeThreadCount: number;
  dormantThreadCount: number;
}
