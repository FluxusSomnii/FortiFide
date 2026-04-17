/**
 * Left rail of the wizard — vertical list of steps with status icons.
 *
 * Only renders steps appropriate for the current build variant. Selected
 * step gets a purple left-edge bar and elevated surface. Hover states are
 * slight and do not animate dramatically — the goal is a quiet instrument
 * panel, not a dashboard.
 */
import { useState, type CSSProperties } from "react";
import type { CheckResult, CheckStatus, StepDefinition } from "./setupTypes";
import { StatusIcon } from "./StatusIcon";
import {
  COLORS,
  FONT_BODY,
  smallStyle,
  statusColor,
  statusLabel,
} from "./setupStyles";

interface StepRow {
  definition: StepDefinition;
  check: CheckResult;
}

interface Props {
  steps: StepRow[];
  selectedNumber: number | null;
  onSelect: (stepNumber: number) => void;
}

export function SetupStepList({ steps, selectedNumber, onSelect }: Props) {
  const railStyle: CSSProperties = {
    width: 280,
    flexShrink: 0,
    borderRight: `1px solid ${COLORS.border}`,
    padding: "20px 0",
    overflowY: "auto",
  };
  return (
    <nav aria-label="Setup steps" style={railStyle}>
      {steps.map((row) => (
        <StepRow
          key={row.definition.number}
          row={row}
          selected={row.definition.number === selectedNumber}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function StepRow({
  row,
  selected,
  onSelect,
}: {
  row: StepRow;
  selected: boolean;
  onSelect: (stepNumber: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const status: CheckStatus = row.check.status;

  const rowStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "12px 20px 12px 24px",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    background: selected
      ? COLORS.surfaceElevated
      : hover
        ? COLORS.surface
        : "transparent",
    color: COLORS.text,
    fontFamily: FONT_BODY,
    transition: "background 0.15s",
  };
  const barStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    background: selected ? COLORS.accent : "transparent",
    borderRadius: "0 2px 2px 0",
  };
  const nameStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: COLORS.text,
    marginBottom: 2,
  };
  const subStyle: CSSProperties = {
    ...smallStyle,
    color: statusColor(status),
  };

  const label = `${row.definition.name} — ${statusLabel(status)}`;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.definition.number)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={selected ? "step" : undefined}
      style={rowStyle}
    >
      <span aria-hidden style={barStyle} />
      <StatusIcon status={status} ariaLabel={label} size={22} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={nameStyle}>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 18,
              color: COLORS.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {row.definition.number}.
          </span>
          {row.definition.name}
        </span>
        <span style={subStyle}>{statusLabel(status)}</span>
      </span>
    </button>
  );
}
