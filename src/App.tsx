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
          {/* Top bar — always visible */}
          <TopBar sidebarOpen={sidebarOpen} onExpandSidebar={() => setSidebarOpen(true)} />

          {/* Content area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {activeView === "capture" && <CaptureView onCheckInOpen={() => setCheckInOpen(true)} />}
            {activeView === "sessions" && !activeSessionId && (
              <SessionsView onSelectSession={handleSelectSession} />
            )}
            {activeView === "session-detail" && activeSessionId && (
              <SessionDetail sessionId={activeSessionId} onBack={handleBackFromSession} onNavigateToPattern={handleNavigateToPattern} />
            )}
            {activeView === "settings" && <SettingsTab />}
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
