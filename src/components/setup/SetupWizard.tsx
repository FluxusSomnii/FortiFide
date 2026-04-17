/**
 * Top-level Guided Setup wizard modal (spec §22.5, prompt 2a).
 *
 * Responsibilities:
 *   - Own the live SetupState (refetching on every user-initiated re-check).
 *   - Decide which step is selected and when the modal shows the success
 *     screen instead of the step layout.
 *   - Gate the skip-and-launch affordance on `derived.can_use_transcribe`.
 *   - Trap focus and intercept Escape, but only release when the user can
 *     actually launch — otherwise, Escape is deliberately ineffective (spec
 *     §22.2: the wizard doesn't want to be dismissible past a blocking step).
 *
 * State shape:
 *   state            – last SetupState we fetched; null until first load
 *                      completes (rare; App preloads it and hands it in).
 *   selectedStep     – 1..=7 number of the highlighted step in the rail.
 *   isRechecking     – identifies which re-check button is currently in
 *                      flight. `"all"` for the footer button, a step number
 *                      for a per-step re-check, or null when idle.
 *   fetchError       – last refetch error (rare; engine wraps most failures
 *                      into Unknown statuses rather than throwing).
 *
 * Auto-advance rule (spec §22.5):
 *   When the user re-checks the currently-selected step and that step flips
 *   from non-Ok to Ok, we move to the next blocking step (or show the
 *   success screen if there is no blocking step left). We do NOT
 *   auto-advance past a failing step, and we don't retreat backward if a
 *   later step fails — the engine's blocking_step gives us the single
 *   forward move.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CheckKey, CheckResult, SetupState, StepDefinition } from "./setupTypes";
import { getCheck } from "./setupTypes";
import { stepsForBuild } from "./setupSteps";
import { getSetupState } from "../../lib/bridge";
import { SetupStepList } from "./SetupStepList";
import { SetupStepDetail } from "./SetupStepDetail";
import { SetupSuccessScreen } from "./SetupSuccessScreen";
import { WizardButton } from "./WizardButton";
import { COLORS, smallStyle } from "./setupStyles";

interface StepRow {
  definition: StepDefinition;
  check: CheckResult;
}

interface Props {
  /** Whether the wizard is mounted on-screen. Mirrors App.tsx state. */
  isOpen: boolean;
  /** Latest SetupState from App.tsx's initial fetch, if any. */
  initialState: SetupState | null;
  /**
   * Optional step number (1..=7) to open the wizard at. Used for deep-links
   * from the Settings "Setup status" row and from clicking a disabled mode
   * selector (§22.5 Prompt 2b.1). When `undefined`, the wizard falls back
   * to its default behaviour: auto-select `derived.blocking_step`, or step 1
   * if all checks are ok.
   *
   * Auto-advance still fires from the chosen starting point — so a
   * deep-link to a currently-green step behaves sensibly if the user
   * re-checks and the next blocker is ahead.
   */
  initialStep?: number | undefined;
  /** Fired when the user launches the app from the success screen. */
  onClose: () => void;
  /** Fired when the user skips. Parent sets a session-scoped flag so the
   *  wizard doesn't re-open on the same launch. */
  onSkip: () => void;
}

export function SetupWizard({ isOpen, initialState, initialStep, onClose, onSkip }: Props) {
  const [state, setState] = useState<SetupState | null>(initialState);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [isRechecking, setIsRechecking] = useState<number | "all" | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [escapeHint, setEscapeHint] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep internal state in sync with prop updates (App may refetch on launch
  // before passing in a state).
  useEffect(() => {
    if (initialState) setState(initialState);
  }, [initialState]);

  // Reset the selected step whenever the wizard closes, so the next open
  // re-evaluates initialStep / blocking_step from scratch instead of
  // persisting whatever step was showing when the user closed.
  useEffect(() => {
    if (!isOpen) setSelectedStep(null);
  }, [isOpen]);

  // Initial selection: prefer the deep-linked `initialStep` prop when the
  // parent passes one, otherwise fall back to the engine's blocking step,
  // otherwise step 1. This runs exactly once per open cycle because
  // `selectedStep === null` is reset in the effect above.
  useEffect(() => {
    if (!state) return;
    if (selectedStep !== null) return;
    if (initialStep !== undefined) {
      setSelectedStep(initialStep);
      return;
    }
    const blocking = state.derived.blocking_step;
    setSelectedStep(blocking ?? 1);
  }, [state, selectedStep, initialStep]);

  // Inject keyframes for the re-check pulse dot (used inside
  // SetupStepDetail's button). Scoped via a stable <style> element.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "fides-wizard-keyframes";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes fidesWizardPulse {
        0%, 100% { opacity: 0.25; }
        50%      { opacity: 1; }
      }
      @keyframes fidesWizardFlash {
        0%, 100% { background: ${COLORS.bg}; }
        50%      { background: rgba(175,169,236,0.08); }
      }
      @keyframes fidesWizardFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Always render every step `stepsForBuild` returns — the left rail's
  // contract (spec §22.5) is to surface the full sequence so the user can
  // see which earlier steps are already green, not just whichever step
  // blocks them today. No status-based or position-based filtering here:
  // the StatusIcon per row is the sole signal for "this one needs
  // attention". If the engine ever omits a check we expected on the
  // current build variant (bug elsewhere), we synthesise an `unknown`
  // placeholder so the row still renders rather than silently vanishing.
  const steps: StepRow[] = useMemo(() => {
    if (!state) return [];
    return stepsForBuild(state.derived.build_variant).map((def): StepRow => {
      const check: CheckResult = getCheck(state, def.key) ?? { status: "unknown" };
      return { definition: def, check };
    });
  }, [state]);

  const allGreen = state !== null && state.derived.blocking_step == null;
  const canSkip = state?.derived.can_use_transcribe ?? false;

  // Re-fetch helper. `target` is either a step number (single re-check),
  // "all" (footer), or null (silent update — not used in 2a).
  const refetch = useCallback(
    async (target: number | "all" | null) => {
      setIsRechecking(target);
      setFetchError(null);
      try {
        const previousStatus = state && selectedStep !== null
          ? statusOfStep(state, selectedStep)
          : null;
        const fresh = await getSetupState();
        setState(fresh);

        // Auto-advance logic: only when the user re-checked a specific step
        // (not the whole-wizard "Re-check all"), and that step flipped from
        // non-Ok to Ok, and a later step is still blocking — or nothing is.
        if (
          typeof target === "number" &&
          selectedStep === target &&
          previousStatus !== null &&
          previousStatus !== "ok" &&
          statusOfStep(fresh, target) === "ok"
        ) {
          const next = fresh.derived.blocking_step ?? null;
          if (next !== null) {
            setSelectedStep(next);
          }
          // If next is null → success screen will take over via `allGreen`.
        }
      } catch (e) {
        console.error("[SETUP] refetch failed:", e);
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRechecking(null);
      }
    },
    [state, selectedStep],
  );

  const onRecheckSelected = useCallback(() => {
    if (selectedStep === null) return;
    void refetch(selectedStep);
  }, [refetch, selectedStep]);

  const onRecheckAll = useCallback(() => {
    void refetch("all");
  }, [refetch]);

  // Escape handling + focus containment.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (canSkip) {
        e.preventDefault();
        onSkip();
      } else {
        e.preventDefault();
        setEscapeHint(true);
        setTimeout(() => setEscapeHint(false), 700);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, canSkip, onSkip]);

  // Move focus into the modal when it opens, so keyboard users don't start
  // typing into whatever element had focus before.
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    background: "rgba(4,4,10,0.85)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    animation: "fidesWizardFadeIn 200ms ease",
  };
  const cardStyle: CSSProperties = {
    width: "100%",
    maxWidth: 1080,
    maxHeight: "85vh",
    background: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 16,
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    animation: escapeHint ? "fidesWizardFlash 700ms ease" : undefined,
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Forti Fide setup" style={overlayStyle}>
      <div ref={containerRef} style={cardStyle}>
        {!state ? (
          <LoadingShell />
        ) : allGreen ? (
          <SetupSuccessScreen
            buildVariant={state.derived.build_variant}
            onLaunch={onClose}
          />
        ) : (
          <BodyLayout
            state={state}
            steps={steps}
            selectedStep={selectedStep}
            isRechecking={isRechecking}
            onSelectStep={setSelectedStep}
            onRecheckSelected={onRecheckSelected}
            fetchError={fetchError}
          />
        )}
        <Footer
          visible={state !== null && !allGreen}
          isRechecking={isRechecking}
          onRecheckAll={onRecheckAll}
          canSkip={canSkip}
          onSkip={onSkip}
        />
      </div>
    </div>
  );
}

function statusOfStep(state: SetupState, n: number): string | null {
  const bySlot: Record<number, CheckKey> = {
    1: "gpu",
    2: "cuda",
    3: "python",
    4: "pyannote",
    5: "hf_token",
    6: "hf_models",
    7: "whisper",
  };
  const key = bySlot[n];
  if (!key) return null;
  const check = getCheck(state, key);
  return check ? check.status : null;
}

function LoadingShell() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        color: COLORS.muted,
        fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      Checking your setup…
    </div>
  );
}

function BodyLayout({
  state,
  steps,
  selectedStep,
  isRechecking,
  onSelectStep,
  onRecheckSelected,
  fetchError,
}: {
  state: SetupState;
  steps: StepRow[];
  selectedStep: number | null;
  isRechecking: number | "all" | null;
  onSelectStep: (n: number) => void;
  onRecheckSelected: () => void;
  fetchError: string | null;
}) {
  const layoutStyle: CSSProperties = {
    flex: 1,
    display: "flex",
    minHeight: 0,
  };

  const selected = steps.find((s) => s.definition.number === selectedStep) ?? steps[0];

  return (
    <div style={layoutStyle}>
      <SetupStepList
        steps={steps}
        selectedNumber={selected?.definition.number ?? null}
        onSelect={onSelectStep}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {fetchError && (
          <div
            role="alert"
            style={{
              ...smallStyle,
              color: COLORS.err,
              padding: "10px 32px",
              borderBottom: `1px solid ${COLORS.border}`,
              background: "rgba(224,122,122,0.06)",
            }}
          >
            Could not re-check setup: {fetchError}
          </div>
        )}
        {selected ? (
          <SetupStepDetail
            definition={selected.definition}
            check={selected.check}
            state={state}
            isRechecking={isRechecking === selected.definition.number}
            onRecheck={onRecheckSelected}
            onGoToStep={onSelectStep}
          />
        ) : (
          <div style={{ padding: 32, color: COLORS.muted }}>No steps to show.</div>
        )}
      </div>
    </div>
  );
}

function Footer({
  visible,
  isRechecking,
  onRecheckAll,
  canSkip,
  onSkip,
}: {
  visible: boolean;
  isRechecking: number | "all" | null;
  onRecheckAll: () => void;
  canSkip: boolean;
  onSkip: () => void;
}) {
  if (!visible) return null;
  const footerStyle: CSSProperties = {
    height: 64,
    flexShrink: 0,
    padding: "0 24px",
    borderTop: `1px solid ${COLORS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };
  return (
    <div style={footerStyle}>
      <WizardButton
        variant="secondary"
        disabled={isRechecking !== null}
        onClick={onRecheckAll}
      >
        {isRechecking === "all" ? "Re-checking all…" : "Re-check all"}
      </WizardButton>
      {canSkip ? (
        <WizardButton
          variant="ghost"
          onClick={onSkip}
          ariaLabel="Skip setup and launch Forti Fide"
        >
          Skip setup and launch anyway →
        </WizardButton>
      ) : (
        <span style={{ ...smallStyle, color: COLORS.tertiary }}>
          Complete the blocking step above to launch.
        </span>
      )}
    </div>
  );
}
