import type {
  EvalCheck,
  EvalExpectedReleaseDecision,
  EvalExpectedSelection,
  EvalFixture,
  EvalResult
} from "./evals";
import type {
  ExecutionRun,
  ExecutionStepRecord,
  ReleaseDecision
} from "./execution";
import type {
  ExecutionRunStatus,
  ExecutionStepStatus,
  Metadata,
  MetadataValue,
  ReleaseDecisionStatus,
  SelectionFactorDirection,
  WorkflowStepKind
} from "./shared";
import type {
  SelectionDecision,
  SelectionFactor,
  SelectionRationale,
  SelectorInput
} from "./selection";
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepConfig
} from "./workflow";

export interface ContractSchema<T> {
  parse(value: unknown): T;
  is(value: unknown): value is T;
}

function createSchema<T>(parser: (value: unknown, path: string) => T): ContractSchema<T> {
  return {
    parse(value: unknown) {
      return parser(value, "value");
    },
    is(value: unknown): value is T {
      try {
        parser(value, "value");
        return true;
      } catch {
        return false;
      }
    }
  };
}

function fail(path: string, message: string): never {
  throw new TypeError(`${path} ${message}`);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object.");
  }

  return value as Record<string, unknown>;
}

function expectOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      fail(`${path}.${key}`, "is not an allowed field.");
    }
  }
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string.");
  }

  return value;
}

function expectOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, path);
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean.");
  }

  return value;
}

function expectOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectBoolean(value, path);
}

function expectNumber(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number }
): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    fail(path, "must be a finite number.");
  }

  if (options?.min !== undefined && value < options.min) {
    fail(path, `must be greater than or equal to ${options.min}.`);
  }

  if (options?.max !== undefined && value > options.max) {
    fail(path, `must be less than or equal to ${options.max}.`);
  }

  return value;
}

function expectOptionalNumber(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number }
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNumber(value, path, options);
}

function expectStringArray(
  value: unknown,
  path: string,
  options?: { minLength?: number }
): string[] {
  if (!Array.isArray(value)) {
    fail(path, "must be an array.");
  }

  const parsed = value.map((entry, index) =>
    expectString(entry, `${path}[${index}]`)
  );

  if (options?.minLength !== undefined && parsed.length < options.minLength) {
    fail(path, `must contain at least ${options.minLength} item(s).`);
  }

  return parsed;
}

function expectOptionalStringArray(
  value: unknown,
  path: string,
  options?: { minLength?: number }
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectStringArray(value, path, options);
}

function expectLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `must be one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function expectOptionalLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectLiteral(value, allowed, path);
}

function isMetadataValue(value: unknown): value is MetadataValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function expectOptionalMetadata(value: unknown, path: string): Metadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = expectRecord(value, path);
  const metadata: Metadata = {};

  for (const [key, entry] of Object.entries(record)) {
    if (!isMetadataValue(entry)) {
      fail(`${path}.${key}`, "must be a string, number, boolean, or null.");
    }

    metadata[key] = entry;
  }

  return metadata;
}

function includeIfDefined<K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> {
  if (value === undefined) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, V>>;
}

function parseWorkflowStepConfig(
  value: unknown,
  path: string
): WorkflowStepConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = expectRecord(value, path);
  expectOnlyKeys(record, ["mode", "timeoutMs", "maxAttempts"], path);

  const mode = expectOptionalString(record.mode, `${path}.mode`);
  const timeoutMs = expectOptionalNumber(record.timeoutMs, `${path}.timeoutMs`, {
    min: 0
  });
  const maxAttempts = expectOptionalNumber(
    record.maxAttempts,
    `${path}.maxAttempts`,
    { min: 1 }
  );

  return {
    ...includeIfDefined("mode", mode),
    ...includeIfDefined("timeoutMs", timeoutMs),
    ...includeIfDefined("maxAttempts", maxAttempts)
  };
}

function parseSelectionFactor(value: unknown, path: string): SelectionFactor {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    ["key", "label", "direction", "score", "explanation"],
    path
  );

  const score = expectOptionalNumber(record.score, `${path}.score`, {
    min: 0,
    max: 1
  });

  return {
    key: expectString(record.key, `${path}.key`),
    label: expectString(record.label, `${path}.label`),
    direction: expectLiteral<SelectionFactorDirection>(
      record.direction,
      ["supports", "opposes", "neutral"],
      `${path}.direction`
    ),
    explanation: expectString(record.explanation, `${path}.explanation`),
    ...includeIfDefined("score", score)
  };
}

function parseEvalExpectedSelection(
  value: unknown,
  path: string
): EvalExpectedSelection | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    ["selectedWorkflowId", "minimumConfidence", "requiresReview"],
    path
  );

  const minimumConfidence = expectOptionalNumber(
    record.minimumConfidence,
    `${path}.minimumConfidence`,
    { min: 0, max: 1 }
  );
  const requiresReview = expectOptionalBoolean(
    record.requiresReview,
    `${path}.requiresReview`
  );

  return {
    selectedWorkflowId: expectString(
      record.selectedWorkflowId,
      `${path}.selectedWorkflowId`
    ),
    ...includeIfDefined("minimumConfidence", minimumConfidence),
    ...includeIfDefined("requiresReview", requiresReview)
  };
}

function parseEvalExpectedReleaseDecision(
  value: unknown,
  path: string
): EvalExpectedReleaseDecision | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = expectRecord(value, path);
  expectOnlyKeys(record, ["status", "tags"], path);
  const tags = expectOptionalStringArray(record.tags, `${path}.tags`);

  return {
    status: expectLiteral<ReleaseDecisionStatus>(
      record.status,
      ["approved", "blocked", "needs_review"],
      `${path}.status`
    ),
    ...includeIfDefined("tags", tags)
  };
}

function parseEvalCheck(value: unknown, path: string): EvalCheck {
  const record = expectRecord(value, path);
  expectOnlyKeys(record, ["key", "label", "passed", "summary", "expected", "actual"], path);
  const expected = expectOptionalString(record.expected, `${path}.expected`);
  const actual = expectOptionalString(record.actual, `${path}.actual`);

  return {
    key: expectString(record.key, `${path}.key`),
    label: expectString(record.label, `${path}.label`),
    passed: expectBoolean(record.passed, `${path}.passed`),
    summary: expectString(record.summary, `${path}.summary`),
    ...includeIfDefined("expected", expected),
    ...includeIfDefined("actual", actual)
  };
}

export const WorkflowStepSchema = createSchema<WorkflowStep>((value, path) => {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    [
      "id",
      "kind",
      "title",
      "description",
      "required",
      "config",
      "metadata",
      "annotations"
    ],
    path
  );

  const description = expectOptionalString(record.description, `${path}.description`);
  const config = parseWorkflowStepConfig(record.config, `${path}.config`);
  const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
  const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

  return {
    id: expectString(record.id, `${path}.id`),
    kind: expectLiteral<WorkflowStepKind>(
      record.kind,
      ["collect", "analyze", "decide", "finalize"],
      `${path}.kind`
    ),
    title: expectString(record.title, `${path}.title`),
    required: expectBoolean(record.required, `${path}.required`),
    ...includeIfDefined("description", description),
    ...includeIfDefined("config", config),
    ...includeIfDefined("metadata", metadata),
    ...includeIfDefined("annotations", annotations)
  };
});

export const WorkflowDefinitionSchema = createSchema<WorkflowDefinition>(
  (value, path) => {
    const record = expectRecord(value, path);
    expectOnlyKeys(
      record,
      [
        "id",
        "version",
        "title",
        "description",
        "tags",
        "steps",
        "defaultReleasePolicyHint",
        "metadata",
        "annotations"
      ],
      path
    );

    if (!Array.isArray(record.steps) || record.steps.length === 0) {
      fail(`${path}.steps`, "must be a non-empty array.");
    }

    const description = expectOptionalString(record.description, `${path}.description`);
    const tags = expectOptionalStringArray(record.tags, `${path}.tags`);
    const defaultReleasePolicyHint = expectOptionalLiteral<ReleaseDecisionStatus>(
      record.defaultReleasePolicyHint,
      ["approved", "blocked", "needs_review"],
      `${path}.defaultReleasePolicyHint`
    );
    const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
    const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

    return {
      id: expectString(record.id, `${path}.id`),
      version: expectString(record.version, `${path}.version`),
      title: expectString(record.title, `${path}.title`),
      steps: record.steps.map((entry, index) =>
        WorkflowStepSchema.parse(entry as unknown)
      ),
      ...includeIfDefined("description", description),
      ...includeIfDefined("tags", tags),
      ...includeIfDefined("defaultReleasePolicyHint", defaultReleasePolicyHint),
      ...includeIfDefined("metadata", metadata),
      ...includeIfDefined("annotations", annotations)
    };
  }
);

export const SelectorInputSchema = createSchema<SelectorInput>((value, path) => {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    [
      "requestId",
      "inputText",
      "requestedMode",
      "tags",
      "constraints",
      "metadata",
      "annotations"
    ],
    path
  );

  const requestedMode = expectOptionalString(record.requestedMode, `${path}.requestedMode`);
  const tags = expectOptionalStringArray(record.tags, `${path}.tags`);
  const constraints = expectOptionalStringArray(record.constraints, `${path}.constraints`);
  const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
  const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

  return {
    requestId: expectString(record.requestId, `${path}.requestId`),
    inputText: expectString(record.inputText, `${path}.inputText`),
    ...includeIfDefined("requestedMode", requestedMode),
    ...includeIfDefined("tags", tags),
    ...includeIfDefined("constraints", constraints),
    ...includeIfDefined("metadata", metadata),
    ...includeIfDefined("annotations", annotations)
  };
});

export const SelectionRationaleSchema = createSchema<SelectionRationale>(
  (value, path) => {
    const record = expectRecord(value, path);
    expectOnlyKeys(record, ["summary", "factors"], path);

    if (!Array.isArray(record.factors) || record.factors.length === 0) {
      fail(`${path}.factors`, "must be a non-empty array.");
    }

    return {
      summary: expectString(record.summary, `${path}.summary`),
      factors: record.factors.map((entry, index) =>
        parseSelectionFactor(entry, `${path}.factors[${index}]`)
      )
    };
  }
);

export const SelectionDecisionSchema = createSchema<SelectionDecision>(
  (value, path) => {
    const record = expectRecord(value, path);
    expectOnlyKeys(
      record,
      [
        "decisionId",
        "selectedWorkflowId",
        "confidence",
        "rationale",
        "alternativeWorkflowIds",
        "requiresReview",
        "metadata",
        "annotations"
      ],
      path
    );

    const alternativeWorkflowIds = expectOptionalStringArray(
      record.alternativeWorkflowIds,
      `${path}.alternativeWorkflowIds`
    );
    const requiresReview = expectOptionalBoolean(
      record.requiresReview,
      `${path}.requiresReview`
    );
    const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
    const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

    return {
      decisionId: expectString(record.decisionId, `${path}.decisionId`),
      selectedWorkflowId: expectString(
        record.selectedWorkflowId,
        `${path}.selectedWorkflowId`
      ),
      confidence: expectNumber(record.confidence, `${path}.confidence`, {
        min: 0,
        max: 1
      }),
      rationale: SelectionRationaleSchema.parse(record.rationale),
      ...includeIfDefined("alternativeWorkflowIds", alternativeWorkflowIds),
      ...includeIfDefined("requiresReview", requiresReview),
      ...includeIfDefined("metadata", metadata),
      ...includeIfDefined("annotations", annotations)
    };
  }
);

export const ExecutionStepRecordSchema = createSchema<ExecutionStepRecord>(
  (value, path) => {
    const record = expectRecord(value, path);
    expectOnlyKeys(
      record,
      [
        "stepId",
        "kind",
        "status",
        "startedAt",
        "completedAt",
        "summary",
        "outputRef",
        "outputSummary",
        "issues",
        "metadata",
        "annotations"
      ],
      path
    );

    const startedAt = expectOptionalString(record.startedAt, `${path}.startedAt`);
    const completedAt = expectOptionalString(record.completedAt, `${path}.completedAt`);
    const summary = expectOptionalString(record.summary, `${path}.summary`);
    const outputRef = expectOptionalString(record.outputRef, `${path}.outputRef`);
    const outputSummary = expectOptionalString(
      record.outputSummary,
      `${path}.outputSummary`
    );
    const issues = expectOptionalStringArray(record.issues, `${path}.issues`);
    const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
    const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

    return {
      stepId: expectString(record.stepId, `${path}.stepId`),
      kind: expectLiteral<WorkflowStepKind>(
        record.kind,
        ["collect", "analyze", "decide", "finalize"],
        `${path}.kind`
      ),
      status: expectLiteral<ExecutionStepStatus>(
        record.status,
        ["pending", "running", "completed", "failed", "skipped"],
        `${path}.status`
      ),
      ...includeIfDefined("startedAt", startedAt),
      ...includeIfDefined("completedAt", completedAt),
      ...includeIfDefined("summary", summary),
      ...includeIfDefined("outputRef", outputRef),
      ...includeIfDefined("outputSummary", outputSummary),
      ...includeIfDefined("issues", issues),
      ...includeIfDefined("metadata", metadata),
      ...includeIfDefined("annotations", annotations)
    };
  }
);

export const ReleaseDecisionSchema = createSchema<ReleaseDecision>(
  (value, path) => {
    const record = expectRecord(value, path);
    expectOnlyKeys(
      record,
      ["status", "summary", "reasons", "tags", "decidedAt", "metadata", "annotations"],
      path
    );

    const reasons = expectOptionalStringArray(record.reasons, `${path}.reasons`);
    const tags = expectOptionalStringArray(record.tags, `${path}.tags`);
    const decidedAt = expectOptionalString(record.decidedAt, `${path}.decidedAt`);
    const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
    const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

    return {
      status: expectLiteral<ReleaseDecisionStatus>(
        record.status,
        ["approved", "blocked", "needs_review"],
        `${path}.status`
      ),
      summary: expectString(record.summary, `${path}.summary`),
      ...includeIfDefined("reasons", reasons),
      ...includeIfDefined("tags", tags),
      ...includeIfDefined("decidedAt", decidedAt),
      ...includeIfDefined("metadata", metadata),
      ...includeIfDefined("annotations", annotations)
    };
  }
);

export const ExecutionRunSchema = createSchema<ExecutionRun>((value, path) => {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    [
      "runId",
      "workflowId",
      "requestId",
      "status",
      "createdAt",
      "startedAt",
      "completedAt",
      "steps",
      "releaseDecision",
      "summary",
      "metadata",
      "annotations"
    ],
    path
  );

  if (!Array.isArray(record.steps)) {
    fail(`${path}.steps`, "must be an array.");
  }

  const startedAt = expectOptionalString(record.startedAt, `${path}.startedAt`);
  const completedAt = expectOptionalString(record.completedAt, `${path}.completedAt`);
  const releaseDecision =
    record.releaseDecision === undefined
      ? undefined
      : ReleaseDecisionSchema.parse(record.releaseDecision);
  const summary = expectOptionalString(record.summary, `${path}.summary`);
  const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
  const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

  return {
    runId: expectString(record.runId, `${path}.runId`),
    workflowId: expectString(record.workflowId, `${path}.workflowId`),
    requestId: expectString(record.requestId, `${path}.requestId`),
    status: expectLiteral<ExecutionRunStatus>(
      record.status,
      ["pending", "running", "completed", "failed"],
      `${path}.status`
    ),
    createdAt: expectString(record.createdAt, `${path}.createdAt`),
    steps: record.steps.map((entry, index) =>
      ExecutionStepRecordSchema.parse(entry as unknown)
    ),
    ...includeIfDefined("startedAt", startedAt),
    ...includeIfDefined("completedAt", completedAt),
    ...includeIfDefined("releaseDecision", releaseDecision),
    ...includeIfDefined("summary", summary),
    ...includeIfDefined("metadata", metadata),
    ...includeIfDefined("annotations", annotations)
  };
});

export const EvalFixtureSchema = createSchema<EvalFixture>((value, path) => {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    [
      "fixtureId",
      "title",
      "selectorInput",
      "expectedSelection",
      "expectedReleaseDecision",
      "notes",
      "metadata",
      "annotations"
    ],
    path
  );

  const expectedSelection = parseEvalExpectedSelection(
    record.expectedSelection,
    `${path}.expectedSelection`
  );
  const expectedReleaseDecision = parseEvalExpectedReleaseDecision(
    record.expectedReleaseDecision,
    `${path}.expectedReleaseDecision`
  );
  const notes = expectOptionalStringArray(record.notes, `${path}.notes`);
  const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
  const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

  return {
    fixtureId: expectString(record.fixtureId, `${path}.fixtureId`),
    title: expectString(record.title, `${path}.title`),
    selectorInput: SelectorInputSchema.parse(record.selectorInput),
    ...includeIfDefined("expectedSelection", expectedSelection),
    ...includeIfDefined("expectedReleaseDecision", expectedReleaseDecision),
    ...includeIfDefined("notes", notes),
    ...includeIfDefined("metadata", metadata),
    ...includeIfDefined("annotations", annotations)
  };
});

export const EvalResultSchema = createSchema<EvalResult>((value, path) => {
  const record = expectRecord(value, path);
  expectOnlyKeys(
    record,
    [
      "fixtureId",
      "passed",
      "summary",
      "checks",
      "actualSelection",
      "actualRun",
      "startedAt",
      "completedAt",
      "metadata",
      "annotations"
    ],
    path
  );

  if (!Array.isArray(record.checks) || record.checks.length === 0) {
    fail(`${path}.checks`, "must be a non-empty array.");
  }

  const actualSelection =
    record.actualSelection === undefined
      ? undefined
      : SelectionDecisionSchema.parse(record.actualSelection);
  const actualRun =
    record.actualRun === undefined
      ? undefined
      : ExecutionRunSchema.parse(record.actualRun);
  const startedAt = expectOptionalString(record.startedAt, `${path}.startedAt`);
  const completedAt = expectOptionalString(record.completedAt, `${path}.completedAt`);
  const metadata = expectOptionalMetadata(record.metadata, `${path}.metadata`);
  const annotations = expectOptionalStringArray(record.annotations, `${path}.annotations`);

  return {
    fixtureId: expectString(record.fixtureId, `${path}.fixtureId`),
    passed: expectBoolean(record.passed, `${path}.passed`),
    summary: expectString(record.summary, `${path}.summary`),
    checks: record.checks.map((entry, index) =>
      parseEvalCheck(entry, `${path}.checks[${index}]`)
    ),
    ...includeIfDefined("actualSelection", actualSelection),
    ...includeIfDefined("actualRun", actualRun),
    ...includeIfDefined("startedAt", startedAt),
    ...includeIfDefined("completedAt", completedAt),
    ...includeIfDefined("metadata", metadata),
    ...includeIfDefined("annotations", annotations)
  };
});
