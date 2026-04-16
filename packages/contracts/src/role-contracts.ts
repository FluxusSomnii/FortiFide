// ---------------------------------------------------------------------------
// Role contract types
// ---------------------------------------------------------------------------

export interface RoleContract {
  roleName: string;
  mission: string;
  inputFields: string[];
  outputDescription: string;
  authorityLimits: string[];
  escalationTriggers: string[];
}

// ---------------------------------------------------------------------------
// Role output types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type WorkflowClass = "light" | "standard" | "rigorous" | "high-risk";
export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type ReleaseVerdict = "release" | "release-with-caveat" | "hold" | "block";

export interface RoutingDecision {
  domain: string;
  riskLevel: RiskLevel;
  selectedWorkflow: WorkflowClass;
  reasoning: string;
}

export interface CriticFinding {
  id: string;
  role: string;
  category: string;
  severity: FindingSeverity;
  description: string;
  suggestion?: string;
  resolved?: boolean;
}

export interface UncertaintyEntry {
  id: string;
  description: string;
  impact: string;
  source: string;
}

export interface PipelineReleaseDecision {
  decision: ReleaseVerdict;
  justification: string;
  unresolvedIssues: string[];
  caveats?: string[];
}

export interface ExecutionTraceEntry {
  role: string;
  timestamp: string;
  inputSummary: string;
  outputSummary: string;
  issuesRaised: number;
  mutations: string[];
}

export interface SharedReasoningState {
  missionId: string;
  missionInput: string;
  routingDecision?: RoutingDecision;
  draftOutput?: string;
  criticFindings: CriticFinding[];
  editorOutput?: string;
  uncertainties: UncertaintyEntry[];
  releaseDecision?: PipelineReleaseDecision;
  executionTrace: ExecutionTraceEntry[];
}

// ---------------------------------------------------------------------------
// Concrete role contracts
// ---------------------------------------------------------------------------

export const ROUTER_CONTRACT: RoleContract = {
  roleName: "router",
  mission:
    "Classify the input by domain, risk level, and required rigor. Select which workflow class to use. Do NOT draft any answer.",
  inputFields: ["missionInput"],
  outputDescription:
    'JSON object with fields: domain (string), riskLevel ("low"|"medium"|"high"|"critical"), selectedWorkflow ("light"|"standard"|"rigorous"|"high-risk"), reasoning (string).',
  authorityLimits: [
    "Must NOT produce any answer or draft content.",
    "Must NOT modify the mission input.",
    "Must NOT skip classification."
  ],
  escalationTriggers: [
    "Input appears to involve safety-critical decisions.",
    "Input is ambiguous and could be interpreted in multiple risk categories.",
    "Input involves legal, medical, or financial advice."
  ]
};

export const DRAFTER_CONTRACT: RoleContract = {
  roleName: "drafter",
  mission:
    "Produce an initial structured response to the mission. The response must be substantive and address the core request, but it is expected to have gaps that critics will identify.",
  inputFields: ["missionInput", "routingDecision"],
  outputDescription:
    "A structured text response that addresses the mission. Use headings and sections where appropriate. Be thorough but acknowledge areas of uncertainty.",
  authorityLimits: [
    "Must NOT claim certainty where evidence is lacking.",
    "Must NOT ignore the routing decision's domain classification.",
    "Must NOT produce empty or trivially short responses."
  ],
  escalationTriggers: [
    "The mission requires domain expertise the model may lack.",
    "The request involves claims that cannot be verified."
  ]
};

export const LOGIC_CRITIC_CONTRACT: RoleContract = {
  roleName: "logic-critic",
  mission:
    "Review the draft for logical validity: contradictions, unsupported claims, ambiguous definitions, circular reasoning. Produce typed issues with severity labels.",
  inputFields: ["missionInput", "draftOutput"],
  outputDescription:
    'JSON array of findings. Each finding: { id (string), role ("logic-critic"), category (string), severity ("low"|"medium"|"high"|"critical"), description (string), suggestion (string) }.',
  authorityLimits: [
    "Must NOT rewrite the draft.",
    "Must NOT introduce new content or claims.",
    "Must NOT evaluate completeness — that is the completeness critic's role.",
    "Must NOT approve the draft — only identify logical issues."
  ],
  escalationTriggers: [
    "Draft contains a critical logical contradiction.",
    "Draft makes claims that are verifiably false."
  ]
};

export const COMPLETENESS_CRITIC_CONTRACT: RoleContract = {
  roleName: "completeness-critic",
  mission:
    "Review the draft for missing elements: unstated assumptions, gaps in coverage, missing edge cases, absent definitions. Produce typed issues with severity labels.",
  inputFields: ["missionInput", "draftOutput"],
  outputDescription:
    'JSON array of findings. Each finding: { id (string), role ("completeness-critic"), category (string), severity ("low"|"medium"|"high"|"critical"), description (string), suggestion (string) }.',
  authorityLimits: [
    "Must NOT rewrite the draft.",
    "Must NOT introduce new content or claims.",
    "Must NOT evaluate logical validity — that is the logic critic's role.",
    "Must NOT approve the draft — only identify gaps."
  ],
  escalationTriggers: [
    "Draft is missing a critical component that changes the answer's meaning.",
    "Draft makes unstated assumptions that could lead to harm."
  ]
};

export const EDITOR_CONTRACT: RoleContract = {
  roleName: "editor",
  mission:
    "Integrate accepted critic findings into a revised output. The output must demonstrably address the issues raised by critics. You may NOT invent new content beyond what critics and drafter established. Any new material must be explicitly noted.",
  inputFields: ["missionInput", "draftOutput", "criticFindings"],
  outputDescription:
    "A revised text response that addresses the critic findings. Structure improvements clearly. Note which findings were addressed and how.",
  authorityLimits: [
    "Must NOT invent new claims not grounded in the draft or critic findings.",
    "Must NOT ignore high-severity critic findings.",
    "Must NOT remove content without justification from a critic finding.",
    "Must explicitly note any new material added beyond what was in the draft."
  ],
  escalationTriggers: [
    "Critic findings conflict with each other.",
    "Addressing a finding would require domain expertise the model may lack."
  ]
};

export const RELEASE_GATE_CONTRACT: RoleContract = {
  roleName: "release-gate",
  mission:
    "Evaluate the final output against the issue ledger and uncertainty record. Produce a typed release decision: release, release-with-caveat, hold, or block. Must justify the decision by referencing specific findings.",
  inputFields: [
    "missionInput",
    "draftOutput",
    "criticFindings",
    "editorOutput",
    "uncertainties"
  ],
  outputDescription:
    'JSON object with fields: decision ("release"|"release-with-caveat"|"hold"|"block"), justification (string), unresolvedIssues (string[]), caveats (string[] or omit if none).',
  authorityLimits: [
    "Must NOT modify the editor output.",
    "Must NOT always approve — must actually evaluate the issue ledger.",
    "Must NOT ignore unresolved high-severity issues.",
    "Must reference specific findings in the justification."
  ],
  escalationTriggers: [
    "Multiple high-severity issues remain unresolved.",
    "The editor introduced new claims not grounded in the draft.",
    "Uncertainty entries suggest the output could cause harm."
  ]
};
