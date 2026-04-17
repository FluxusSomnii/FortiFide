/**
 * Check 4 — pyannote install action card (spec §22.5 Prompt 2b.2).
 *
 * Two tabs:
 *   "Run it for me"        — default; live subprocess install with streamed
 *                            log, cancel, failure fallback.
 *   "Show me the command"  — the exact one-liner to paste into a terminal,
 *                            pulled from the Rust install constants so it
 *                            can never drift from the auto-install command.
 *
 * The install is invoked via the `install_pyannote` Tauri command, which
 * spawns pip against the detected Python 3.11 interpreter from within
 * Rust. Output streams back as `setup://pyannote-install-log` events, and
 * a terminal `setup://pyannote-install-done` event fires on exit or cancel.
 *
 * Why default to the "Run it for me" tab: users overwhelmingly prefer the
 * one-click path when it exists. The manual tab is kept as a fallback —
 * the failure state links directly to it, and expert users switch
 * manually if they want to see what's running first.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CheckResult, PyannoteDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import {
  bodyStyle,
  smallStyle,
  codeBlockStyle,
  COLORS,
  FONT_BODY,
  FONT_MONO,
} from "../setupStyles";

interface Props {
  check: CheckResult<PyannoteDetails>;
  buildVariant: "gpu" | "cpu";
  onRecheck: () => void;
}

type Tab = "auto" | "manual";

interface LogLine {
  kind: "stdout" | "stderr";
  line: string;
}

interface InstallLogEventPayload {
  kind: "stdout" | "stderr";
  line: string;
}

interface InstallDoneEventPayload {
  exit_code: number;
  duration_seconds: number;
  cancelled: boolean;
}

type InstallState =
  | { status: "idle"; lastOutcome?: "cancelled" | undefined }
  | { status: "running"; startedAt: number }
  | { status: "success"; durationSeconds: number }
  | { status: "failed"; exitCode: number; durationSeconds: number };

/** Hard cap on log buffer — pathological pip runs can emit 100k lines. */
const LOG_LINE_CAP = 2000;

export function PyannoteActionCard({ check, buildVariant, onRecheck }: Props) {
  const [tab, setTab] = useState<Tab>("auto");
  const [installState, setInstallState] = useState<InstallState>({ status: "idle" });
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logTruncated, setLogTruncated] = useState(false);
  const [manualCommand, setManualCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showFullFailureLog, setShowFullFailureLog] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Auto-scroll management: pause auto-scroll when the user manually
  // scrolls away from the bottom. `userScrolledUp` is the latch.
  const logPanelRef = useRef<HTMLDivElement | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Load the exact manual command string from Rust once on mount. Values
  // come from PyannoteInstallConfig (see src-tauri/src/setup/install.rs)
  // so this UI cannot drift from the subprocess it invokes.
  useEffect(() => {
    let cancelled = false;
    invoke<string>("get_pyannote_install_command")
      .then((cmd) => {
        if (!cancelled) setManualCommand(cmd);
      })
      .catch((err) => {
        console.error("[SETUP] get_pyannote_install_command failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // We keep refs mirroring the install status and onRecheck callback so
  // event handlers can read fresh values without being in the effect's
  // dependency list. This is what lets us subscribe to events once on
  // mount (avoiding a race where pip's first output arrives before a
  // status-dependent effect remounts) while still discarding events when
  // we're not expecting them.
  const installStatusRef = useRef<InstallState["status"]>("idle");
  useEffect(() => {
    installStatusRef.current = installState.status;
  }, [installState.status]);
  const onRecheckRef = useRef(onRecheck);
  useEffect(() => {
    onRecheckRef.current = onRecheck;
  }, [onRecheck]);

  // Event subscription is mounted-once, dropped on unmount. Event handlers
  // read the status ref to decide whether to update state — events fired
  // while idle (e.g. a stray `done` from a previous install that wasn't
  // fully unmounted) are dropped.
  useEffect(() => {
    let unlistenLog: UnlistenFn | null = null;
    let unlistenDone: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        unlistenLog = await listen<InstallLogEventPayload>(
          "setup://pyannote-install-log",
          (event) => {
            if (cancelled) return;
            if (installStatusRef.current !== "running") return;
            const payload = event.payload;
            setLogLines((prev) => {
              if (prev.length >= LOG_LINE_CAP) {
                // Drop oldest; flip truncated so the UI renders the
                // "…earlier output truncated" marker above the panel.
                setLogTruncated(true);
                return [...prev.slice(prev.length - LOG_LINE_CAP + 1), payload];
              }
              return [...prev, payload];
            });
          },
        );
        unlistenDone = await listen<InstallDoneEventPayload>(
          "setup://pyannote-install-done",
          (event) => {
            if (cancelled) return;
            if (installStatusRef.current !== "running") return;
            const { exit_code, duration_seconds, cancelled: wasCancelled } =
              event.payload;
            if (wasCancelled) {
              setInstallState({ status: "idle", lastOutcome: "cancelled" });
              return;
            }
            if (exit_code === 0) {
              setInstallState({ status: "success", durationSeconds: duration_seconds });
              // Let the user see the success frame briefly, then hand off
              // to the wizard's per-step re-check via the ref so the
              // latest callback is used even if props have changed.
              setTimeout(() => onRecheckRef.current(), 500);
            } else {
              setInstallState({
                status: "failed",
                exitCode: exit_code,
                durationSeconds: duration_seconds,
              });
            }
          },
        );
      } catch (err) {
        console.error("[SETUP] failed to subscribe to install events:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlistenLog?.();
      unlistenDone?.();
    };
    // onRecheck is stable from parent for this card instance; listeners are
    // registered exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the log panel as lines arrive, unless the user has
  // scrolled up to read earlier output. Checks viewport vs content on
  // every line update.
  useEffect(() => {
    const el = logPanelRef.current;
    if (!el) return;
    if (userScrolledUp) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines, userScrolledUp]);

  const handleLogScroll = useCallback(() => {
    const el = logPanelRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 20px tolerance — users occasionally trigger small scroll deltas
    // from friction on trackpads.
    setUserScrolledUp(distanceFromBottom > 20);
  }, []);

  const handleInstallClick = useCallback(async () => {
    setLogLines([]);
    setLogTruncated(false);
    setSpawnError(null);
    setShowFullFailureLog(false);
    setUserScrolledUp(false);
    // Transition to running BEFORE invoking so the event listener effect
    // mounts in time to catch the earliest stdout lines from pip.
    setInstallState({ status: "running", startedAt: Date.now() });
    try {
      await invoke("install_pyannote");
    } catch (err) {
      console.error("[SETUP] install_pyannote spawn failed:", err);
      setInstallState({ status: "idle" });
      setSpawnError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleCancelClick = useCallback(async () => {
    try {
      await invoke("cancel_pyannote_install");
    } catch (err) {
      console.error("[SETUP] cancel_pyannote_install failed:", err);
    }
  }, []);

  const handleTryAgain = useCallback(() => {
    setInstallState({ status: "idle" });
    setShowFullFailureLog(false);
  }, []);

  const copyManual = useCallback(async () => {
    if (!manualCommand) return;
    try {
      await navigator.clipboard.writeText(manualCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error("[SETUP] copy failed:", err);
    }
  }, [manualCommand]);

  if (check.status === "ok") return null;

  return (
    <ActionCardShell ariaLabel="Install pyannote">
      <TabStrip tab={tab} onChange={setTab} running={installState.status === "running"} />
      {tab === "auto" && (
        <AutoTab
          state={installState}
          logLines={logLines}
          logTruncated={logTruncated}
          logPanelRef={logPanelRef}
          onLogScroll={handleLogScroll}
          showFullFailureLog={showFullFailureLog}
          setShowFullFailureLog={setShowFullFailureLog}
          spawnError={spawnError}
          onInstall={handleInstallClick}
          onCancel={handleCancelClick}
          onTryAgain={handleTryAgain}
          onSwitchToManual={() => setTab("manual")}
          buildVariant={buildVariant}
        />
      )}
      {tab === "manual" && (
        <ManualTab
          command={manualCommand}
          copied={copied}
          onCopy={copyManual}
          buildVariant={buildVariant}
          onRecheck={onRecheck}
        />
      )}
    </ActionCardShell>
  );
}

// ── Tab strip ──────────────────────────────────────────────────────────

function TabStrip({
  tab,
  onChange,
  running,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  running: boolean;
}) {
  const wrapStyle: CSSProperties = {
    display: "flex",
    gap: 4,
    padding: 4,
    background: "rgba(0,0,0,0.25)",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    alignSelf: "flex-start",
  };
  const base: CSSProperties = {
    fontFamily: FONT_BODY,
    fontSize: 12,
    padding: "6px 12px",
    border: "1px solid transparent",
    borderRadius: 6,
    background: "transparent",
    color: COLORS.muted,
    cursor: running ? "not-allowed" : "pointer",
    transition: "background 0.15s, color 0.15s",
  };
  const active: CSSProperties = {
    background: COLORS.surfaceElevated,
    color: COLORS.text,
  };
  return (
    <div role="tablist" aria-label="pyannote install method" style={wrapStyle}>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "auto"}
        disabled={running}
        onClick={() => onChange("auto")}
        style={{ ...base, ...(tab === "auto" ? active : {}) }}
      >
        Run it for me
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "manual"}
        // Manual tab stays clickable even during a run — the user might
        // want to copy the command and kick off a parallel attempt in a
        // different shell. The engine's concurrent-install guard still
        // prevents two `invoke('install_pyannote')` calls from overlapping.
        onClick={() => onChange("manual")}
        style={{ ...base, ...(tab === "manual" ? active : {}) }}
      >
        Show me the command
      </button>
    </div>
  );
}

// ── "Run it for me" tab ────────────────────────────────────────────────

function AutoTab({
  state,
  logLines,
  logTruncated,
  logPanelRef,
  onLogScroll,
  showFullFailureLog,
  setShowFullFailureLog,
  spawnError,
  onInstall,
  onCancel,
  onTryAgain,
  onSwitchToManual,
  buildVariant,
}: {
  state: InstallState;
  logLines: LogLine[];
  logTruncated: boolean;
  logPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  onLogScroll: () => void;
  showFullFailureLog: boolean;
  setShowFullFailureLog: (v: boolean) => void;
  spawnError: string | null;
  onInstall: () => void;
  onCancel: () => void;
  onTryAgain: () => void;
  onSwitchToManual: () => void;
  buildVariant: "gpu" | "cpu";
}) {
  if (state.status === "idle") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={bodyStyle}>
          Forti Fide will install pyannote and its PyTorch dependency into
          Python 3.11. Takes 3–5 minutes and downloads about 3 GB.
        </p>
        <p style={{ ...smallStyle, color: COLORS.muted }}>
          You'll see live install output below. If anything fails, you can
          copy the command and try it manually.
        </p>
        {buildVariant === "cpu" && (
          <p style={{ ...smallStyle, color: COLORS.muted }}>
            CPU build detected — the install will use PyPI's default torch
            wheel (no CUDA index).
          </p>
        )}
        {state.lastOutcome === "cancelled" && (
          <p style={{ ...smallStyle, color: COLORS.warn }}>
            Previous install cancelled.
          </p>
        )}
        {spawnError && (
          <div
            style={{
              ...smallStyle,
              color: COLORS.err,
              padding: "8px 10px",
              background: "rgba(224,122,122,0.08)",
              border: "1px solid rgba(224,122,122,0.2)",
              borderRadius: 6,
            }}
          >
            Could not start install: {spawnError}
          </div>
        )}
        <div>
          <WizardButton variant="primary" onClick={onInstall}>
            Install pyannote
          </WizardButton>
        </div>
      </div>
    );
  }

  if (state.status === "running") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <RunningHeader startedAt={state.startedAt} />
        <LogPanel
          lines={logLines}
          truncated={logTruncated}
          panelRef={logPanelRef}
          onScroll={onLogScroll}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <WizardButton variant="secondary" onClick={onCancel}>
            Cancel
          </WizardButton>
        </div>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              color: COLORS.ok,
              fontFamily: FONT_BODY,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            ✓ Install complete
          </span>
          <span style={{ ...smallStyle, color: COLORS.muted }}>
            {formatElapsed(state.durationSeconds)}
          </span>
        </div>
        <p style={bodyStyle}>pyannote installed successfully.</p>
        <div
          style={{
            ...smallStyle,
            color: COLORS.muted,
            fontStyle: "italic",
          }}
        >
          Verifying setup…
        </div>
      </div>
    );
  }

  // Failure state
  const lastLines = logLines.slice(-5);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            color: COLORS.err,
            fontFamily: FONT_BODY,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          ✗ Install failed
        </span>
        <span style={{ ...smallStyle, color: COLORS.muted }}>
          {formatElapsed(state.durationSeconds)}
        </span>
      </div>
      <p style={bodyStyle}>
        pip exited with code {state.exitCode}. Here are the last lines of output:
      </p>
      <LogPanel
        lines={showFullFailureLog ? logLines : lastLines}
        truncated={showFullFailureLog && logTruncated}
        panelRef={logPanelRef}
        onScroll={() => {}}
        small
      />
      {!showFullFailureLog && logLines.length > lastLines.length && (
        <button
          type="button"
          onClick={() => setShowFullFailureLog(true)}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            color: COLORS.muted,
            fontFamily: FONT_BODY,
            fontSize: 12,
            cursor: "pointer",
            padding: "4px 0",
          }}
        >
          › Show full log
        </button>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton variant="primary" onClick={onTryAgain}>
          Try again
        </WizardButton>
        <WizardButton variant="secondary" onClick={onSwitchToManual}>
          Use manual command →
        </WizardButton>
      </div>
    </div>
  );
}

// ── Running-state elapsed timer ────────────────────────────────────────

function RunningHeader({ startedAt }: { startedAt: number }) {
  // Tick once per second. Using `now` state so the component re-renders
  // and the timer stays synced even if the log stream is quiet for a while.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.floor((now - startedAt) / 1000);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span
        style={{
          color: COLORS.text,
          fontFamily: FONT_BODY,
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        Installing pyannote
      </span>
      <span
        style={{
          ...smallStyle,
          color: COLORS.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ── Log panel ──────────────────────────────────────────────────────────

function LogPanel({
  lines,
  truncated,
  panelRef,
  onScroll,
  small,
}: {
  lines: LogLine[];
  truncated: boolean;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  onScroll: () => void;
  small?: boolean;
}) {
  const panelStyle: CSSProperties = {
    background: "rgba(0,0,0,0.25)",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: 12,
    maxHeight: small ? 120 : 250,
    minHeight: small ? 60 : 140,
    overflowY: "auto",
    fontFamily: FONT_MONO,
    fontSize: 12,
    lineHeight: 1.5,
    color: COLORS.text,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  };
  return (
    <div ref={panelRef} onScroll={onScroll} style={panelStyle}>
      {truncated && (
        <div style={{ color: COLORS.muted, fontStyle: "italic", marginBottom: 4 }}>
          …earlier output truncated
        </div>
      )}
      {lines.length === 0 ? (
        <div style={{ color: COLORS.muted, fontStyle: "italic" }}>Waiting for output…</div>
      ) : (
        lines.map((l, i) => (
          <div
            key={i}
            style={{
              color: l.kind === "stderr" ? COLORS.warn : COLORS.text,
            }}
          >
            {l.line}
          </div>
        ))
      )}
    </div>
  );
}

// ── "Show me the command" tab ──────────────────────────────────────────

function ManualTab({
  command,
  copied,
  onCopy,
  buildVariant,
  onRecheck,
}: {
  command: string | null;
  copied: boolean;
  onCopy: () => void;
  buildVariant: "gpu" | "cpu";
  onRecheck: () => void;
}) {
  const explanation = useMemo(
    () =>
      buildVariant === "gpu"
        ? "The --force-reinstall flag and the cu126 index URL are both required. Without --force-reinstall, pip may skip re-installing torch and you'll end up with the CPU-only build. Without the specific CUDA index, torch 2.8.0 won't be found."
        : "CPU build — no CUDA index URL is needed. --force-reinstall is still used so pip re-downloads torch cleanly even if a partial install is present.",
    [buildVariant],
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={bodyStyle}>
        Open a terminal and run this command. Takes 3–5 minutes and downloads
        about 3 GB.
      </p>
      <div style={{ position: "relative" }}>
        <pre style={codeBlockStyle}>{command ?? "…"}</pre>
        <button
          type="button"
          onClick={onCopy}
          disabled={!command}
          aria-label={copied ? "Copied" : "Copy command"}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: copied ? COLORS.ok : COLORS.muted,
            background: "rgba(0,0,0,0.4)",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            padding: "4px 8px",
            cursor: command ? "pointer" : "default",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p style={{ ...smallStyle, color: COLORS.muted, lineHeight: 1.55 }}>
        {explanation}
      </p>
      <div>
        <WizardButton variant="primary" onClick={onRecheck}>
          I've run the command, re-check
        </WizardButton>
      </div>
    </div>
  );
}
