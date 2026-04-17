/**
 * Settings tab row that summarises the current Guided Setup state and
 * offers deep-links into the wizard (spec §22.5 Prompt 2b.1).
 *
 * Collapsed:
 *   "Setup status                         ✓ All ready  ▸"
 *   The right-side indicator derives from SetupState.derived:
 *     all ok                                       → teal "✓ All ready"
 *     can_use_transcribe & !can_use_speakers       → amber "⚠ Speakers unavailable"
 *     !can_use_transcribe                          → muted red "✗ Setup incomplete"
 *
 * Expanded:
 *   Vertical list of each applicable check (5 on CPU, 7 on GPU) —
 *   status icon + step name + message (one line). Rows are clickable
 *   and deep-link the wizard to that step. Below the list: a "Re-run
 *   setup" button that opens the wizard at step 1 regardless of state,
 *   for users who want to re-verify everything from scratch.
 *
 * Live updates: App.tsx's handleSetupClose refetches SetupState on wizard
 * close, so this row reflects the new state automatically the next time
 * the Settings tab renders. No subscription or local refetch needed.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import type { SetupState } from "./setupTypes";
import { getCheck } from "./setupTypes";
import { stepsForBuild } from "./setupSteps";
import { StatusIcon } from "./StatusIcon";
import { COLORS, statusColor, statusLabel, FONT_BODY } from "./setupStyles";
import { getSetupState } from "../../lib/bridge";

interface Props {
  state: SetupState | null;
  /** Deep-link into the wizard at an optional step number (1..=7). */
  onOpenSetupWizard: (step?: number) => void;
}

interface Summary {
  icon: string;
  text: string;
  color: string;
}

function summaryFor(state: SetupState | null): Summary {
  if (!state) {
    // Engine hasn't responded yet — don't claim anything. Muted neutral.
    return { icon: "…", text: "Checking…", color: COLORS.muted };
  }
  const { derived } = state;
  if (derived.blocking_step == null) {
    return { icon: "✓", text: "All ready", color: COLORS.ok };
  }
  if (derived.can_use_transcribe && !derived.can_use_speakers) {
    return { icon: "⚠", text: "Speakers unavailable", color: COLORS.warn };
  }
  return { icon: "✗", text: "Setup incomplete", color: COLORS.err };
}

export function SetupStatusRow({ state, onOpenSetupWizard }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [rerunPending, setRerunPending] = useState(false);
  const summary = useMemo(() => summaryFor(state), [state]);

  /**
   * Re-run setup (spec §22.5 Prompt 2b.2 follow-up). Refetch SetupState
   * first, then open the wizard at the fresh blocking step — or with no
   * explicit step when everything is green, letting the wizard's success
   * screen take over. Doing the refetch here (rather than in the wizard
   * itself) means the user always sees the up-to-the-second state, even
   * if the cached one is stale from a prior session.
   */
  const handleRerunSetup = useCallback(async () => {
    if (rerunPending) return;
    setRerunPending(true);
    try {
      const fresh = await getSetupState();
      onOpenSetupWizard(fresh.derived.blocking_step ?? undefined);
    } catch (err) {
      // Detection engine errors shouldn't happen in practice (every
      // check wraps its own failures into the returned state). If one
      // slips through, fall back to opening the wizard without a
      // deep-link — the wizard will retry internally.
      console.error("[SETUP-STATUS-ROW] re-run refetch failed:", err);
      onOpenSetupWizard(undefined);
    } finally {
      setRerunPending(false);
    }
  }, [onOpenSetupWizard, rerunPending]);

  // Build the list of rows from the current build variant. When state is
  // null we show a short placeholder — the user is in Settings, not in a
  // hurry, so a beat of "checking…" is fine.
  const rows = useMemo(() => {
    if (!state) return [];
    return stepsForBuild(state.derived.build_variant).map((def) => {
      const check = getCheck(state, def.key);
      return { def, check };
    });
  }, [state]);

  const wrapStyle: CSSProperties = {
    marginBottom: 20,
    border: "1px solid #2a2a2a",
    borderRadius: 6,
    background: "#0f0f12",
    overflow: "hidden",
  };

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    color: "#d0d0d0",
    fontFamily: FONT_BODY,
    fontSize: 12,
  };

  const indicatorStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: summary.color,
    fontSize: 12,
  };

  const listStyle: CSSProperties = {
    borderTop: "1px solid #1a1a1e",
    padding: "8px 0",
    display: "flex",
    flexDirection: "column",
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    background: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    color: "#d0d0d0",
    fontFamily: FONT_BODY,
    fontSize: 11,
    cursor: "pointer",
  };

  const footerStyle: CSSProperties = {
    padding: "10px 14px 14px",
    borderTop: "1px solid #1a1a1e",
    display: "flex",
    justifyContent: "flex-end",
  };

  const rerunButtonStyle: CSSProperties = {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 5,
    color: "#d0d0d0",
    fontFamily: FONT_BODY,
    fontSize: 11,
    padding: "6px 14px",
    cursor: "pointer",
  };

  return (
    <div style={wrapStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="fides-setup-status-list"
        style={headerStyle}
      >
        <span>Setup status</span>
        <span style={indicatorStyle}>
          <span style={{ fontSize: 13 }} aria-hidden>
            {summary.icon}
          </span>
          <span>{summary.text}</span>
          <span
            aria-hidden
            style={{
              marginLeft: 6,
              color: COLORS.muted,
              fontSize: 12,
              transform: expanded ? "rotate(90deg)" : "rotate(0)",
              transition: "transform 0.15s",
              display: "inline-block",
            }}
          >
            ›
          </span>
        </span>
      </button>
      {expanded && (
        <>
          <div id="fides-setup-status-list" style={listStyle}>
            {rows.length === 0 && (
              <div style={{ ...rowStyle, color: COLORS.muted, cursor: "default" }}>
                Loading setup state…
              </div>
            )}
            {rows.map(({ def, check }) => {
              const status = check ? check.status : "unknown";
              return (
                <button
                  type="button"
                  key={def.number}
                  onClick={() => onOpenSetupWizard(def.number)}
                  style={rowStyle}
                  title={`Open step ${def.number} in Guided Setup`}
                >
                  <StatusIcon
                    status={status}
                    ariaLabel={`${def.name} — ${statusLabel(status)}`}
                    size={16}
                  />
                  <span
                    style={{
                      color: COLORS.muted,
                      fontVariantNumeric: "tabular-nums",
                      width: 18,
                      display: "inline-block",
                    }}
                  >
                    {def.number}.
                  </span>
                  <span style={{ flex: 1, color: "#d0d0d0" }}>{def.name}</span>
                  <span style={{ color: statusColor(status), fontSize: 10 }}>
                    {statusLabel(status)}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={footerStyle}>
            <button
              type="button"
              onClick={handleRerunSetup}
              disabled={rerunPending}
              style={{ ...rerunButtonStyle, opacity: rerunPending ? 0.5 : 1 }}
            >
              {rerunPending ? "Checking…" : "Re-run setup"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
