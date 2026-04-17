/**
 * Check 3 — Python 3.11 action card.
 *
 * The single failure mode we see in the wild is users installing 3.12 or
 * 3.13 and assuming "newer is better" — pyannote pins to 3.11. The callout
 * about "Add Python to PATH" maps to the single box people forget to tick
 * during install.
 */
import type { CheckResult, PythonDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { openExternal } from "../shellOpen";
import { bodyStyle, smallStyle, COLORS } from "../setupStyles";

interface Props {
  check: CheckResult<PythonDetails>;
  onRecheck: () => void;
}

const PYTHON_DOWNLOAD = "https://www.python.org/downloads/release/python-3119/";

export function PythonActionCard({ check, onRecheck }: Props) {
  if (check.status === "ok") return null;

  const warnStyle = {
    background: "rgba(224,165,122,0.08)",
    border: "1px solid rgba(224,165,122,0.3)",
    borderRadius: 8,
    padding: "10px 12px",
  };

  return (
    <ActionCardShell ariaLabel="Python 3.11 install">
      <p style={bodyStyle}>
        Forti Fide uses Python 3.11 for speaker detection. If you have a
        newer Python installed, it can stay — 3.11 will coexist with it.
      </p>
      <div style={warnStyle}>
        <span style={{ ...smallStyle, color: COLORS.text }}>
          During installation, check the box for{" "}
          <strong style={{ color: COLORS.warn }}>Add Python to PATH</strong>.
          Without it, Forti Fide won't find the interpreter.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton
          variant="primary"
          external
          onClick={() => openExternal(PYTHON_DOWNLOAD)}
        >
          Download Python 3.11
        </WizardButton>
        <WizardButton variant="secondary" onClick={onRecheck}>
          I've installed Python 3.11, re-check
        </WizardButton>
      </div>
    </ActionCardShell>
  );
}
