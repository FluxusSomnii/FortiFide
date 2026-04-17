import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, type View } from "./components/Sidebar";
import { TopBar, startCapture } from "./components/TopBar";
import { CaptureView } from "./components/CaptureView";
import { SessionsView } from "./components/SessionsView";
import { SessionDetail } from "./components/SessionDetail";
import { SettingsTab } from "./components/SettingsTab";
import { CheckInPanel } from "./components/CheckInPanel";
import { DataTab } from "./components/DataTab";
import { InsightsTab } from "./components/InsightsTab";
import { SessionRitualCard } from "./components/SessionRitualCard";
import { OnboardingModal } from "./components/OnboardingModal";
import { CpuModeBanner } from "./components/CpuModeBanner";
import { CrashRecoveryDialog } from "./components/CrashRecoveryDialog";
import { SetupWizard } from "./components/setup/SetupWizard";
import type { SetupState } from "./components/setup/setupTypes";
import { getSetupState } from "./lib/bridge";
import { useSessionStore, initSessionListeners, type RitualData } from "./stores/session-store";
import "./App.css";

const ONBOARDING_FLAG_KEY = "fortifide.onboarding.complete";

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<View>("capture");
  const [activeTab, setActiveTab] = useState<"capture" | "sessions" | "data" | "insights">("capture");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [highlightedPattern, setHighlightedPattern] = useState<string | null>(null);
  // First-run onboarding — shown once, then dismissed forever via localStorage.
  // Initialised lazily so SSR/tests don't trip on window.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ONBOARDING_FLAG_KEY) !== "true";
    } catch {
      return false;
    }
  });
  const handleOnboardingComplete = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_FLAG_KEY, "true");
    } catch (e) {
      console.error("[APP] Failed to persist onboarding flag:", e);
    }
    setShowOnboarding(false);
  }, []);

  // Guided Setup wizard state (Section 22.5, prompt 2a).
  // Flow:
  //   - On mount, run the detection engine once. If transcribe is blocked,
  //     open the wizard.
  //   - Skip is session-scoped (sessionStorage), not persisted — deliberate
  //     per §22.2: the wizard re-evaluates on every launch rather than
  //     honouring a stale "setup completed" flag.
  //   - Dev builds get a Ctrl+Shift+S shortcut so the wizard can be opened
  //     manually on machines that have already completed setup.
  const [setupState, setSetupState] = useState<SetupState | null>(null);
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  // Initial step for deep-linking into the wizard from the Settings row or
  // from clicking a gated mode pill. `undefined` = fall back to the engine's
  // blocking_step, which is what the launch-time auto-open wants.
  const [wizardInitialStep, setWizardInitialStep] = useState<number | undefined>(undefined);
  const SKIP_KEY = "fortifide.setup.skippedThisSession";
  const [setupSkippedThisSession, setSetupSkippedThisSession] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(SKIP_KEY) === "true";
    } catch {
      return false;
    }
  });

  /**
   * Re-run the Guided Setup detection engine and update local state. Called
   * whenever we need a fresh snapshot — most commonly after the wizard
   * closes (user may have resolved blockers inside it) so the Settings
   * "Setup status" row and mode selectors update without a page reload.
   */
  const refetchSetupState = useCallback(async () => {
    try {
      const fresh = await getSetupState();
      setSetupState(fresh);
    } catch (err) {
      console.error("[APP] refetchSetupState failed:", err);
    }
  }, []);

  /**
   * Single entry point for opening the wizard. `step` is an optional 1..=7
   * deep-link target; when omitted the wizard auto-selects `blocking_step`.
   * Callers: Settings status row, gated mode pills, dev Ctrl+Shift+S.
   */
  const openSetupWizard = useCallback((step?: number) => {
    setWizardInitialStep(step);
    setSetupWizardOpen(true);
  }, []);

  const handleSetupSkip = useCallback(() => {
    try {
      window.sessionStorage.setItem(SKIP_KEY, "true");
    } catch (e) {
      console.error("[APP] Failed to persist setup skip flag:", e);
    }
    setSetupSkippedThisSession(true);
    setSetupWizardOpen(false);
    setWizardInitialStep(undefined);
  }, []);

  const handleSetupClose = useCallback(() => {
    setSetupWizardOpen(false);
    setWizardInitialStep(undefined);
    // Refresh SetupState so the Settings row + mode gates reflect whatever
    // the user just did inside the wizard (installed CUDA, saved a token,
    // accepted a licence, etc.). Fire-and-forget — a stale state for a few
    // hundred ms is fine, and errors are logged inside refetchSetupState.
    void refetchSetupState();
  }, [refetchSetupState]);
  const showEntryCard = useSessionStore((s) => s.showEntryCard);
  const showExitCard = useSessionStore((s) => s.showExitCard);
  const ritualEntry = useSessionStore((s) => s.ritualEntry);
  const settings = useSessionStore((s) => s.settings);

  const handleEntryComplete = useCallback(async (data: RitualData) => {
    const store = useSessionStore.getState();
    store.setRitualEntry(data);
    store.setShowEntryCard(false);
    if (data.sourceType) store.setSelectedSourceType(data.sourceType);
    await startCapture();
  }, []);

  const handleEntrySkip = useCallback(async () => {
    useSessionStore.getState().setShowEntryCard(false);
    await startCapture();
  }, []);

  const handleEntryCancel = useCallback(() => {
    useSessionStore.getState().setShowEntryCard(false);
  }, []);

  const handleExitComplete = useCallback((data: RitualData) => {
    const store = useSessionStore.getState();
    store.setRitualExit(data);
    store.setShowExitCard(false);
  }, []);

  const handleExitSkip = useCallback(() => {
    useSessionStore.getState().setShowExitCard(false);
  }, []);

  const handleNavigateToPattern = (patternId: string) => {
    setHighlightedPattern(patternId);
    setActiveTab("data");
    setActiveView("data");
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    initSessionListeners()
      .then((cleanupFn) => {
        if (cancelled) { cleanupFn(); } else { cleanup = cleanupFn; }
      })
      .catch((err) => {
        console.error("[APP] Failed to initialize event listeners:", err);
      });

    useSessionStore.getState().loadSettings().catch((err) => {
      console.error("[APP] Failed to load settings:", err);
    });

    // Restore draft session if one exists
    useSessionStore.getState().loadDraft().then((restored) => {
      if (restored) console.log("[APP] Draft session restored");
    }).catch(() => {});

    invoke<string>("get_capture_status")
      .then((status) => {
        if (!cancelled && (status === "idle" || status === "capturing" || status === "paused")) {
          useSessionStore.getState().setCaptureStatus(status);
        }
      })
      .catch((err) => {
        console.error("[APP] Failed to get initial capture status:", err);
      });

    return () => { cancelled = true; cleanup?.(); };
  }, []);

  // Run the Guided Setup detection engine once on launch. Auto-open the
  // wizard if transcribe is blocked and the user hasn't already skipped
  // this session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getSetupState();
        if (cancelled) return;
        setSetupState(state);
        if (!state.derived.can_use_transcribe && !setupSkippedThisSession) {
          setSetupWizardOpen(true);
        }
      } catch (err) {
        console.error("[APP] getSetupState failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // setupSkippedThisSession is only consulted once at launch. Changing it
    // later (e.g. via skip) should not re-trigger the auto-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dev-only manual trigger: Ctrl+Shift+S opens the wizard even when
  // transcribe is available. Disabled in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        openSetupWizard();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSetupWizard]);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    setActiveView("session-detail");
  };

  const handleBackFromSession = () => {
    setActiveSessionId(null);
    setActiveView("sessions");
  };

  return (
    <>
      <div style={{ display: "flex", height: "100vh", background: "#0d0d0f" }}>
        {/* Sidebar */}
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          activeView={activeView}
          setActiveView={setActiveView}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
        />

        {/* Main panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* CPU-mode notice — dismissible, auto-hidden once acknowledged */}
          <CpuModeBanner />
          {/* Top bar — always visible */}
          <TopBar
            sidebarOpen={sidebarOpen}
            onExpandSidebar={() => setSidebarOpen(true)}
            setupState={setupState}
            onOpenSetupWizard={openSetupWizard}
          />

          {/* Content area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {activeView === "capture" && <CaptureView onCheckInOpen={() => setCheckInOpen(true)} />}
            {activeView === "sessions" && !activeSessionId && (
              <SessionsView onSelectSession={handleSelectSession} />
            )}
            {activeView === "session-detail" && activeSessionId && (
              <SessionDetail
                sessionId={activeSessionId}
                onBack={handleBackFromSession}
                onNavigateToPattern={handleNavigateToPattern}
                setupState={setupState}
                onOpenSetupWizard={openSetupWizard}
              />
            )}
            {activeView === "settings" && (
              <SettingsTab
                setupState={setupState}
                onOpenSetupWizard={openSetupWizard}
              />
            )}
            {activeView === "data" && <DataTab onSelectSession={handleSelectSession} highlightedPattern={highlightedPattern} onPatternHighlightClear={() => setHighlightedPattern(null)} />}
            {activeView === "insights" && <InsightsTab onSelectSession={handleSelectSession} />}
          </div>
        </div>
      </div>

      {checkInOpen && (
        <CheckInPanel onClose={() => setCheckInOpen(false)} />
      )}

      {showOnboarding && (
        <OnboardingModal onComplete={handleOnboardingComplete} />
      )}

      {/* Guided Setup wizard — section 22. Mounted above the rest of the
          app tree so its backdrop covers everything, including the first-
          run onboarding modal (onboarding runs after setup resolves). */}
      <SetupWizard
        isOpen={setupWizardOpen}
        initialState={setupState}
        initialStep={wizardInitialStep}
        onClose={handleSetupClose}
        onSkip={handleSetupSkip}
      />

      {/* Crash recovery — highest z-index, overlays everything. Self-dismissing. */}
      <CrashRecoveryDialog />

      {/* Ritual cards — fixed overlays, visible from any tab */}
      {showEntryCard && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,8,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <SessionRitualCard
            mode="entry"
            onComplete={handleEntryComplete}
            onSkip={handleEntrySkip}
            onCancel={handleEntryCancel}
            lastSavedState={settings.lastSliderValues}
          />
        </div>
      )}
      {showExitCard && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,8,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <SessionRitualCard
            mode="exit"
            onComplete={handleExitComplete}
            onSkip={handleExitSkip}
            previousState={ritualEntry?.state}
            lastSavedState={ritualEntry?.state}
          />
        </div>
      )}
    </>
  );
}
