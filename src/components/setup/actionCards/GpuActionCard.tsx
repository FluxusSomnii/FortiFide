/**
 * Check 1 — GPU / driver action card.
 *
 * On Ok: nothing (the status badge at the top of the detail panel is enough).
 * On Missing: explain NVIDIA requirement, link to supported-hardware docs and
 *             the CPU build download page.
 * On WrongVersion: the driver is too old — link to NVIDIA's driver downloads.
 */
import type { CheckResult, GpuDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { openExternal } from "../shellOpen";
import { bodyStyle, smallStyle, COLORS } from "../setupStyles";

interface Props {
  check: CheckResult<GpuDetails>;
  /** Called after the user claims to have fixed the issue. */
  onRecheck: () => void;
}

const HARDWARE_DOCS = "https://fortifide.org/docs/hardware";
const CPU_RELEASES = "https://github.com/FluxusSomnii/FortiFide/releases";
const NVIDIA_DRIVERS = "https://www.nvidia.com/Download/index.aspx";

export function GpuActionCard({ check, onRecheck }: Props) {
  if (check.status === "ok") return null;

  if (check.status === "wrong_version") {
    return (
      <ActionCardShell ariaLabel="GPU driver update">
        <p style={bodyStyle}>
          An NVIDIA GPU is present, but its driver is too old to host the
          CUDA 12 runtime Forti Fide needs. Update the driver from NVIDIA's
          site, reboot, then re-check.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <WizardButton
            variant="primary"
            external
            onClick={() => openExternal(NVIDIA_DRIVERS)}
          >
            Update NVIDIA driver
          </WizardButton>
          <WizardButton variant="secondary" onClick={onRecheck}>
            I've updated, re-check
          </WizardButton>
        </div>
      </ActionCardShell>
    );
  }

  // Missing (or unknown — treat same as missing in this UI).
  return (
    <ActionCardShell ariaLabel="GPU missing">
      <p style={bodyStyle}>
        Forti Fide's GPU build needs an NVIDIA graphics card with recent
        drivers to run Whisper and PyTorch at real-time speeds. If you don't
        have an NVIDIA GPU, the CPU build supports offline analysis of
        recorded audio at a slower pace.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton
          variant="primary"
          external
          onClick={() => openExternal(HARDWARE_DOCS)}
        >
          View supported hardware
        </WizardButton>
        <WizardButton
          variant="ghost"
          external
          onClick={() => openExternal(CPU_RELEASES)}
        >
          Download CPU build instead →
        </WizardButton>
      </div>
      <p style={{ ...smallStyle, color: COLORS.muted }}>
        CPU mode is available for offline analysis but is 2–5× slower than
        the audio and not suitable for live sessions.
      </p>
    </ActionCardShell>
  );
}
