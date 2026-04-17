/**
 * Check 6 — Hugging Face model licences action card (Amendment 3 fidelity).
 *
 * Prompt 2a discriminated on `CheckStatus`, which conflated the "accept a
 * licence" failure mode with the "network is down" failure mode and broke
 * the Amendment 3 invariant that network errors must never surface the
 * licence-accept UI. This version reads the engine's explicit
 * `details.failure_type` discriminator — the single source of truth — and
 * renders one of four branches:
 *
 *   licence_not_accepted  → per-model "Accept X licence" buttons driven
 *                            by `details.diarization` / `details.segmentation`.
 *   token_invalid         → "Go to token step" routing back to step 5.
 *   network_error         → single "Retry" affordance, no licence UI.
 *   unexpected_response   → generic "unable to verify" with the raw message.
 *
 * Defensive fallback: if a non-Ok result arrives without a `failure_type`
 * (engine bug), we treat it as `unexpected_response`. This should never
 * happen — the Rust side always emits one — but it keeps the UI from
 * throwing if the wire format drifts.
 */
import type {
  CheckResult,
  HfModelsDetails,
  HfModelsFailureType,
} from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { openExternal } from "../shellOpen";
import { bodyStyle, smallStyle, COLORS } from "../setupStyles";

interface Props {
  check: CheckResult<HfModelsDetails>;
  onRecheck: () => void;
  /** Called with step number when the card wants to jump to another step. */
  onGoToStep: (stepNumber: number) => void;
}

const DIARIZATION_URL =
  "https://huggingface.co/pyannote/speaker-diarization-3.1";
const SEGMENTATION_URL = "https://huggingface.co/pyannote/segmentation-3.0";

export function HfModelsActionCard({ check, onRecheck, onGoToStep }: Props) {
  if (check.status === "ok") return null;

  // Single discriminator: failure_type. Never re-derive from status.
  // The ?? fallback only fires if the engine omits failure_type on a non-Ok
  // result — a wire-format bug that shouldn't occur, but we degrade to the
  // most defensive branch (unexpected_response) if it does.
  const failureType: HfModelsFailureType =
    check.details?.failure_type ?? "unexpected_response";

  switch (failureType) {
    case "licence_not_accepted":
      return <LicenceCard check={check} onRecheck={onRecheck} />;
    case "token_invalid":
      return <TokenInvalidCard message={check.message} onGoToStep={onGoToStep} />;
    case "network_error":
      return <NetworkErrorCard message={check.message} onRecheck={onRecheck} />;
    case "unexpected_response":
      return <UnexpectedCard message={check.message} onRecheck={onRecheck} />;
  }
}

// ── Variant: licence_not_accepted ─────────────────────────────────────────
function LicenceCard({
  check,
  onRecheck,
}: {
  check: CheckResult<HfModelsDetails>;
  onRecheck: () => void;
}) {
  // Booleans are true for the models that PASSED; invert to find the ones
  // that still need the user's click-through on Hugging Face.
  const needsDiarization = !check.details?.diarization;
  const needsSegmentation = !check.details?.segmentation;

  return (
    <ActionCardShell ariaLabel="Model licences — accept on Hugging Face">
      <p style={bodyStyle}>
        These models are free but require licence acceptance. Click each
        button, accept the terms on Hugging Face, then re-check.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {needsDiarization && (
          <WizardButton
            variant="primary"
            external
            onClick={() => openExternal(DIARIZATION_URL)}
          >
            Accept speaker-diarization licence
          </WizardButton>
        )}
        {needsSegmentation && (
          <WizardButton
            variant="primary"
            external
            onClick={() => openExternal(SEGMENTATION_URL)}
          >
            Accept segmentation licence
          </WizardButton>
        )}
      </div>
      <div>
        <WizardButton variant="secondary" onClick={onRecheck}>
          I've accepted the licences, verify
        </WizardButton>
      </div>
      <p style={{ ...smallStyle, color: COLORS.muted }}>
        Licence acceptance is tied to your Hugging Face account, not this
        device. Once accepted, every install on every machine signed in with
        the same account will work.
      </p>
    </ActionCardShell>
  );
}

// ── Variant: token_invalid ────────────────────────────────────────────────
function TokenInvalidCard({
  message,
  onGoToStep,
}: {
  message: string | null | undefined;
  onGoToStep: (stepNumber: number) => void;
}) {
  return (
    <ActionCardShell ariaLabel="Model licences — token invalid">
      <p style={bodyStyle}>
        Your token is no longer valid. Re-check the token step to fix this
        before verifying the model licences.
      </p>
      {message ? (
        <p style={{ ...smallStyle, color: COLORS.muted }}>{message}</p>
      ) : null}
      <div>
        <WizardButton variant="primary" onClick={() => onGoToStep(5)}>
          Go to token step
        </WizardButton>
      </div>
    </ActionCardShell>
  );
}

// ── Variant: network_error ────────────────────────────────────────────────
function NetworkErrorCard({
  message,
  onRecheck,
}: {
  message: string | null | undefined;
  onRecheck: () => void;
}) {
  return (
    <ActionCardShell ariaLabel="Model licences — connectivity issue">
      <p style={bodyStyle}>
        Could not reach Hugging Face to verify model access. This is a
        network issue, not a licence problem. Check your connection and
        retry.
      </p>
      {message ? (
        <p style={{ ...smallStyle, color: COLORS.muted }}>{message}</p>
      ) : null}
      <div>
        <WizardButton variant="primary" onClick={onRecheck}>
          Retry
        </WizardButton>
      </div>
    </ActionCardShell>
  );
}

// ── Variant: unexpected_response ──────────────────────────────────────────
function UnexpectedCard({
  message,
  onRecheck,
}: {
  message: string | null | undefined;
  onRecheck: () => void;
}) {
  return (
    <ActionCardShell ariaLabel="Model licences — unable to verify">
      <p style={bodyStyle}>
        Unable to verify licence status. Hugging Face returned an unexpected
        response. This is usually transient.
      </p>
      {message ? (
        <p
          style={{
            ...smallStyle,
            color: COLORS.muted,
            fontFamily: "'Courier New', Consolas, monospace",
            padding: "8px 10px",
            background: "rgba(0,0,0,0.25)",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
          }}
        >
          {message}
        </p>
      ) : null}
      <div>
        <WizardButton variant="primary" onClick={onRecheck}>
          Retry
        </WizardButton>
      </div>
    </ActionCardShell>
  );
}
