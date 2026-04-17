/**
 * Check 2 — CUDA 12 runtime action card.
 *
 * The key user anxiety here is "I have CUDA 13 installed, do I need to
 * uninstall it?" — no, they coexist. The callout makes that explicit
 * because getting it wrong costs people half an hour.
 */
import type { CheckResult, CudaDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { openExternal } from "../shellOpen";
import { bodyStyle, smallStyle, COLORS } from "../setupStyles";

interface Props {
  check: CheckResult<CudaDetails>;
  onRecheck: () => void;
}

const CUDA_DOWNLOAD =
  "https://developer.nvidia.com/cuda-12-6-0-download-archive";
const CPU_RELEASES = "https://github.com/FluxusSomnii/FortiFide/releases";

export function CudaActionCard({ check, onRecheck }: Props) {
  if (check.status === "ok") return null;

  const calloutStyle = {
    background: COLORS.accentSoft,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: "10px 12px",
  };

  return (
    <ActionCardShell ariaLabel="CUDA 12 install">
      <p style={bodyStyle}>
        Forti Fide needs the CUDA 12 runtime. If you have a newer CUDA
        version installed (like CUDA 13), that's fine — they coexist. CUDA 12
        just needs to be present alongside it.
      </p>
      <div style={calloutStyle}>
        <span style={{ ...smallStyle, color: COLORS.text }}>
          Install with the default options. The installer takes ~5 minutes.
          A reboot may be required before CUDA 12 is detected.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton
          variant="primary"
          external
          onClick={() => openExternal(CUDA_DOWNLOAD)}
        >
          Download CUDA 12.6
        </WizardButton>
        <WizardButton variant="secondary" onClick={onRecheck}>
          I've installed CUDA 12, re-check
        </WizardButton>
      </div>
      <div style={{ marginTop: 2 }}>
        <WizardButton
          variant="ghost"
          external
          onClick={() => openExternal(CPU_RELEASES)}
        >
          Or download the CPU build from releases →
        </WizardButton>
        <div style={{ ...smallStyle, marginTop: 4, paddingLeft: 8 }}>
          CPU mode is available for offline analysis but is 2–5× slower than
          the audio and not suitable for live sessions.
        </div>
      </div>
    </ActionCardShell>
  );
}
