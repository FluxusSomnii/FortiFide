/**
 * Right panel of the wizard — renders the selected step's name, purpose,
 * current status badge, error message (if any), action card, the
 * "Why is this needed?" expander, and the per-step "Re-check" button.
 *
 * The action card itself is owned by the per-step components in
 * ./actionCards/; this panel is responsible for the container chrome and
 * routing the onRecheck / onGoToStep callbacks to whichever card is active.
 */
import { useState, type CSSProperties } from "react";
import type {
  CheckResult,
  CudaDetails,
  GpuDetails,
  HfModelsDetails,
  HfTokenDetails,
  PyannoteDetails,
  PythonDetails,
  SetupState,
  StepDefinition,
  WhisperDetails,
} from "./setupTypes";
import {
  COLORS,
  FONT_BODY,
  bodyMutedStyle,
  smallStyle,
  statusColor,
  statusLabel,
  titleStyle,
} from "./setupStyles";
import { WizardButton } from "./WizardButton";
import { GpuActionCard } from "./actionCards/GpuActionCard";
import { CudaActionCard } from "./actionCards/CudaActionCard";
import { PythonActionCard } from "./actionCards/PythonActionCard";
import { PyannoteActionCard } from "./actionCards/PyannoteActionCard";
import { HfTokenActionCard } from "./actionCards/HfTokenActionCard";
import { HfModelsActionCard } from "./actionCards/HfModelsActionCard";
import { WhisperActionCard } from "./actionCards/WhisperActionCard";

interface Props {
  definition: StepDefinition;
  check: CheckResult;
  state: SetupState;
  isRechecking: boolean;
  onRecheck: () => void;
  onGoToStep: (stepNumber: number) => void;
}

export function SetupStepDetail({
  definition,
  check,
  state,
  isRechecking,
  onRecheck,
  onGoToStep,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const panelStyle: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: 32,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  };

  const headerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const stepNumberStyle: CSSProperties = {
    ...smallStyle,
    color: COLORS.accent,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: 11,
  };

  const statusRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  };

  const badgeStyle: CSSProperties = {
    fontFamily: FONT_BODY,
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: `${statusColor(check.status)}22`,
    color: statusColor(check.status),
    border: `1px solid ${statusColor(check.status)}55`,
  };

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <span style={stepNumberStyle}>Step {definition.number}</span>
        <h2 style={titleStyle}>{definition.name}</h2>
        <p style={bodyMutedStyle}>{definition.purpose}</p>
      </header>

      <div style={statusRowStyle}>
        <span style={badgeStyle}>{statusLabel(check.status)}</span>
        {check.message ? (
          <span style={{ ...smallStyle, color: COLORS.muted, flex: 1 }}>
            {check.message}
          </span>
        ) : null}
      </div>

      <ActionFor
        definition={definition}
        check={check}
        state={state}
        onRecheck={onRecheck}
        onGoToStep={onGoToStep}
      />

      <WhyExpander
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        text={definition.explanation}
      />

      <div style={{ marginTop: 4 }}>
        <WizardButton
          variant="secondary"
          disabled={isRechecking}
          onClick={onRecheck}
          ariaLabel={`Re-check step ${definition.number}: ${definition.name}`}
        >
          {isRechecking ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Re-checking
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: COLORS.accent,
                  animation: "fidesWizardPulse 1.1s infinite",
                }}
              />
            </span>
          ) : (
            "Re-check this step"
          )}
        </WizardButton>
      </div>
    </div>
  );
}

function ActionFor({
  definition,
  check,
  state,
  onRecheck,
  onGoToStep,
}: {
  definition: StepDefinition;
  check: CheckResult;
  state: SetupState;
  onRecheck: () => void;
  onGoToStep: (stepNumber: number) => void;
}) {
  // Ok status: no action card; wizard auto-advances elsewhere. Keep the
  // panel informative by showing a short confirmation line instead.
  if (check.status === "ok") {
    return (
      <p
        style={{
          ...smallStyle,
          color: COLORS.ok,
          fontSize: 13,
        }}
      >
        Ready. No action needed on this step.
      </p>
    );
  }

  switch (definition.key) {
    case "gpu":
      return (
        <GpuActionCard
          check={check as CheckResult<GpuDetails>}
          onRecheck={onRecheck}
        />
      );
    case "cuda":
      return (
        <CudaActionCard
          check={check as CheckResult<CudaDetails>}
          onRecheck={onRecheck}
        />
      );
    case "python":
      return (
        <PythonActionCard
          check={check as CheckResult<PythonDetails>}
          onRecheck={onRecheck}
        />
      );
    case "pyannote":
      return (
        <PyannoteActionCard
          check={check as CheckResult<PyannoteDetails>}
          buildVariant={state.derived.build_variant}
          onRecheck={onRecheck}
        />
      );
    case "hf_token":
      return (
        <HfTokenActionCard
          check={check as CheckResult<HfTokenDetails>}
          onRecheck={onRecheck}
        />
      );
    case "hf_models":
      return (
        <HfModelsActionCard
          check={check as CheckResult<HfModelsDetails>}
          onRecheck={onRecheck}
          onGoToStep={onGoToStep}
        />
      );
    case "whisper":
      return (
        <WhisperActionCard
          check={check as CheckResult<WhisperDetails>}
          onRecheck={onRecheck}
        />
      );
  }
}

function WhyExpander({
  expanded,
  onToggle,
  text,
}: {
  expanded: boolean;
  onToggle: () => void;
  text: string;
}) {
  const buttonStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
    background: "transparent",
    border: "none",
    color: COLORS.muted,
    fontFamily: FONT_BODY,
    fontSize: 13,
    cursor: "pointer",
  };
  const bodyContainer: CSSProperties = {
    marginTop: 8,
    padding: "12px 14px",
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    color: COLORS.text,
    fontFamily: FONT_BODY,
    fontSize: 13,
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
  };
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={buttonStyle}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        >
          ›
        </span>
        Why is this needed?
      </button>
      {expanded && <div style={bodyContainer}>{text}</div>}
    </div>
  );
}
