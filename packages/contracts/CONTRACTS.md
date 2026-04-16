# Contracts

This package defines the typed language for the first runnable slice.

## Contract Intent

- `WorkflowDefinition`: one workflow available to the registry.
- `WorkflowStep`: one typed step inside a workflow.
- `SelectorInput`: typed selector request.
- `SelectionDecision`: selector output for one chosen workflow.
- `SelectionRationale`: mixed human-readable and structured explanation for a selection.
- `ExecutionRun`: one execution instance for a workflow request.
- `ExecutionStepRecord`: one auditable record for a step inside a run.
- `ReleaseDecision`: final release state for a run.
- `EvalFixture`: one fixture-driven expectation for the engine.
- `EvalResult`: structured outcome of running one fixture.

## Required vs Optional

- Required fields are identifiers, statuses, kinds, timestamps required by the prompt, and the minimum structured arrays that make each contract auditable.
- Optional fields are limited to `description`, `tags`, `constraints`, `summary`, `reasons`, `metadata`, and `annotations`, plus a few narrow future-facing expectation fields in eval contracts.

## Human-Readable vs Machine-Checked

- Human-readable fields: `title`, `description`, `summary`, `explanation`, `reason`-style text, `notes`.
- Machine-checked fields: `id` fields, `status`, `kind`, `tags`, `confidence`, `score`, `required`, `requiresReview`, `expectedSelection`, `expectedReleaseDecision`, `checks`, `metadata`.

## Future-Facing Optional Fields

- `metadata?: Record<string, string | number | boolean | null>`
- `annotations?: string[]`
- `defaultReleasePolicyHint?`
- `requestedMode?`
- `alternativeWorkflowIds?`
- `reasons?`
- `tags?`

These exist to leave a narrow seam for future integrations without introducing `any`, `unknown`, or generic blobs.

## Example JSON

### WorkflowDefinition

```json
{
  "id": "wf.standard-analysis.v1",
  "version": "1.0.0",
  "title": "Standard Analysis",
  "description": "Collect, analyze, decide, and finalize a bounded internal answer.",
  "tags": ["internal", "analysis"],
  "steps": [
    {
      "id": "step.collect-input",
      "kind": "collect",
      "title": "Collect input",
      "required": true,
      "config": {
        "mode": "text"
      }
    },
    {
      "id": "step.analyze",
      "kind": "analyze",
      "title": "Analyze input",
      "required": true
    },
    {
      "id": "step.decide",
      "kind": "decide",
      "title": "Decide release posture",
      "required": true
    },
    {
      "id": "step.finalize",
      "kind": "finalize",
      "title": "Finalize output",
      "required": true
    }
  ],
  "defaultReleasePolicyHint": "needs_review",
  "metadata": {
    "family": "standard"
  }
}
```

### SelectorInput

```json
{
  "requestId": "req-001",
  "inputText": "Review this internal planning draft and determine the best workflow.",
  "requestedMode": "analysis",
  "tags": ["planning", "internal"],
  "constraints": ["no external calls", "text only"],
  "metadata": {
    "priority": "normal"
  }
}
```

### SelectionDecision

```json
{
  "decisionId": "sel-001",
  "selectedWorkflowId": "wf.standard-analysis.v1",
  "confidence": 0.82,
  "rationale": {
    "summary": "The standard analysis workflow matches the request shape and constraints.",
    "factors": [
      {
        "key": "mode_match",
        "label": "Requested mode match",
        "direction": "supports",
        "score": 0.9,
        "explanation": "The request explicitly asks for analysis."
      },
      {
        "key": "scope_fit",
        "label": "Scope fit",
        "direction": "supports",
        "score": 0.74,
        "explanation": "The request fits the bounded internal slice."
      }
    ]
  },
  "alternativeWorkflowIds": ["wf.review-only.v1"],
  "requiresReview": false
}
```

### ExecutionRun

```json
{
  "runId": "run-001",
  "workflowId": "wf.standard-analysis.v1",
  "requestId": "req-001",
  "status": "running",
  "createdAt": "2026-03-13T11:00:00Z",
  "startedAt": "2026-03-13T11:00:05Z",
  "steps": [
    {
      "stepId": "step.collect-input",
      "kind": "collect",
      "status": "completed",
      "startedAt": "2026-03-13T11:00:05Z",
      "completedAt": "2026-03-13T11:00:09Z",
      "summary": "Collected selector input.",
      "outputSummary": "Structured request envelope created."
    },
    {
      "stepId": "step.analyze",
      "kind": "analyze",
      "status": "running",
      "startedAt": "2026-03-13T11:00:10Z"
    }
  ],
  "summary": "Execution has started and is partway through analysis."
}
```

### ReleaseDecision

```json
{
  "status": "needs_review",
  "summary": "The run produced a draft but still needs human review before release.",
  "reasons": ["manual_review_required", "analysis_not_finalized"],
  "tags": ["review", "internal"],
  "decidedAt": "2026-03-13T11:03:00Z"
}
```

### EvalFixture

```json
{
  "fixtureId": "fx-001",
  "title": "Standard analysis request selects the standard workflow",
  "selectorInput": {
    "requestId": "req-001",
    "inputText": "Review this internal planning draft and determine the best workflow.",
    "requestedMode": "analysis"
  },
  "expectedSelection": {
    "selectedWorkflowId": "wf.standard-analysis.v1",
    "minimumConfidence": 0.6,
    "requiresReview": false
  },
  "expectedReleaseDecision": {
    "status": "needs_review",
    "tags": ["review"]
  },
  "notes": ["Keep the fixture JSON small and readable."]
}
```

### EvalResult

```json
{
  "fixtureId": "fx-001",
  "passed": true,
  "summary": "The fixture matched the expected workflow and release state.",
  "checks": [
    {
      "key": "selectedWorkflowId",
      "label": "Selected workflow",
      "passed": true,
      "summary": "The selected workflow matched the fixture expectation.",
      "expected": "wf.standard-analysis.v1",
      "actual": "wf.standard-analysis.v1"
    },
    {
      "key": "releaseStatus",
      "label": "Release status",
      "passed": true,
      "summary": "The release status matched the fixture expectation.",
      "expected": "needs_review",
      "actual": "needs_review"
    }
  ],
  "startedAt": "2026-03-13T11:05:00Z",
  "completedAt": "2026-03-13T11:05:01Z"
}
```
