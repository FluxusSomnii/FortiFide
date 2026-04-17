/**
 * Terminal screen shown when every applicable check is Ok. Single action:
 * close the wizard and let the app render.
 */
import type { CSSProperties } from "react";
import { WizardButton } from "./WizardButton";
import { StatusIcon } from "./StatusIcon";
import {
  COLORS,
  titleStyle,
  bodyMutedStyle,
} from "./setupStyles";

interface Props {
  onLaunch: () => void;
  buildVariant: "gpu" | "cpu";
}

export function SetupSuccessScreen({ onLaunch, buildVariant }: Props) {
  const wrapStyle: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 32px",
    textAlign: "center",
    gap: 20,
  };
  return (
    <div style={wrapStyle} role="status" aria-live="polite">
      <StatusIcon status="ok" ariaLabel="All checks passed" size={52} />
      <h2 style={{ ...titleStyle, fontSize: 32 }}>You're ready.</h2>
      <p style={{ ...bodyMutedStyle, maxWidth: 440 }}>
        Every dependency Forti Fide needs is in place. Transcribe, Speakers,
        and Deep modes are all available.
      </p>
      <p style={{ ...bodyMutedStyle, maxWidth: 440, color: COLORS.tertiary, fontSize: 13 }}>
        {buildVariant === "gpu"
          ? "Running the GPU build. Transcription and speaker detection will use your graphics card."
          : "Running the CPU build. Transcription runs on CPU — expect slower-than-realtime processing."}
      </p>
      <div style={{ marginTop: 8 }}>
        <WizardButton variant="primary" onClick={onLaunch}>
          Launch Forti Fide
        </WizardButton>
      </div>
    </div>
  );
}
