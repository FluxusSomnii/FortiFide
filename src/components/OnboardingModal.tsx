import { useCallback, useState, type CSSProperties } from "react";
import { api } from "../bridge";
import { useSessionStore } from "../stores/session-store";

/**
 * First-run onboarding. Four optional steps + a closing "done" screen.
 * Nothing blocks the user — every step is skippable. Input from any step
 * that the user actually confirms (via Next / Done) is saved best-effort;
 * Skip buttons advance without saving that step's input.
 *
 * The parent is responsible for:
 *   - deciding whether to render this (first run)
 *   - persisting the "seen it" flag after onComplete()
 */

type AudioSource = "microphone" | "loopback" | "both";
type Step = 1 | 2 | 3 | 4 | "done";

interface Props {
  onComplete: () => void;
}

// ── Visual tokens ────────────────────────────────────────────────
const BG = "#0c0c12";
const SURFACE = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#e4e2dc";
const MUTED = "rgba(228,226,220,0.55)";
const ACCENT = "#AFA9EC";
const ACCENT_SOFT = "rgba(175,169,236,0.12)";
const ERR = "#e2786e";

const TITLE_FONT =
  "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ── Shared style helpers ─────────────────────────────────────────
const titleStyle: CSSProperties = {
  fontFamily: TITLE_FONT,
  fontSize: 26,
  fontWeight: 400,
  letterSpacing: "0.01em",
  color: TEXT,
  marginBottom: 6,
};
const subtitleStyle: CSSProperties = {
  fontFamily: TITLE_FONT,
  fontSize: 14,
  fontStyle: "italic",
  color: MUTED,
  marginBottom: 18,
};
const bodyStyle: CSSProperties = {
  fontFamily: BODY_FONT,
  fontSize: 14,
  lineHeight: 1.55,
  color: TEXT,
};
const smallStyle: CSSProperties = {
  fontFamily: BODY_FONT,
  fontSize: 12,
  lineHeight: 1.5,
  color: MUTED,
};
const linkStyle: CSSProperties = {
  color: ACCENT,
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,0.35)",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: "10px 12px",
  color: TEXT,
  fontFamily: BODY_FONT,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

function Button({
  variant = "secondary",
  disabled,
  onClick,
  children,
}: {
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base: CSSProperties = {
    fontFamily: BODY_FONT,
    fontSize: 13,
    padding: "9px 16px",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "background 0.15s, border-color 0.15s",
  };
  const styles: Record<string, CSSProperties> = {
    primary: {
      ...base,
      background: "transparent",
      border: `1px solid ${ACCENT}`,
      color: ACCENT,
    },
    secondary: {
      ...base,
      background: "transparent",
      border: `1px solid ${BORDER}`,
      color: TEXT,
    },
    ghost: {
      ...base,
      background: "transparent",
      border: "1px solid transparent",
      color: MUTED,
    },
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={styles[variant]}>
      {children}
    </button>
  );
}

// ── Step indicator dots ──────────────────────────────────────────
function StepDots({ current }: { current: Step }) {
  const active = current === "done" ? 4 : current;
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 24 }}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: n <= active ? ACCENT : "rgba(255,255,255,0.15)",
            transition: "background 0.2s",
          }}
        />
      ))}
    </div>
  );
}

// ── Audio-source card ────────────────────────────────────────────
function SourceCard({
  value,
  label,
  emoji,
  desc,
  selected,
  onSelect,
}: {
  value: AudioSource;
  label: string;
  emoji: string;
  desc: string;
  selected: boolean;
  onSelect: (v: AudioSource) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "14px 16px",
        borderRadius: 8,
        border: `1px solid ${selected ? ACCENT : BORDER}`,
        background: selected ? ACCENT_SOFT : SURFACE,
        color: TEXT,
        cursor: "pointer",
        fontFamily: BODY_FONT,
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
        <span style={{ fontSize: 18 }} aria-hidden>{emoji}</span>
        <span style={{ fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ marginTop: 4, marginLeft: 28, fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
        {desc}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
export function OnboardingModal({ onComplete }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [audioSource, setAudioSource] = useState<AudioSource>("both");
  const [audioSourceApplied, setAudioSourceApplied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [hfToken, setHfToken] = useState("");

  // Validate on each keystroke, but only show error once the user has typed
  // something that's clearly not an Anthropic key (avoid shouting while they
  // are still typing the first few characters).
  const onApiKeyChange = (v: string) => {
    setApiKey(v);
    const trimmed = v.trim();
    if (!trimmed) setApiKeyError(null);
    else if (trimmed.length >= 7 && !trimmed.startsWith("sk-ant-"))
      setApiKeyError("Key looks wrong — should start with sk-ant-");
    else setApiKeyError(null);
  };

  // Step 2: save the chosen audio source to the settings store.
  const applyAudioSource = useCallback(() => {
    if (audioSourceApplied) return;
    try {
      useSessionStore.getState().updateSetting("audioSource", audioSource);
    } catch (e) {
      console.error("[ONBOARD] Failed to save audioSource:", e);
    }
    setAudioSourceApplied(true);
  }, [audioSource, audioSourceApplied]);

  // Step 3: save the Anthropic API key (best-effort).
  const applyApiKey = useCallback(async () => {
    const k = apiKey.trim();
    if (!k) return;
    if (!k.startsWith("sk-ant-")) {
      setApiKeyError("Key looks wrong — should start with sk-ant-");
      return;
    }
    try {
      await api.saveApiSettings(k);
    } catch (e) {
      console.error("[ONBOARD] Failed to save API key:", e);
    }
  }, [apiKey]);

  // Step 4: save the Hugging Face token (best-effort).
  const applyHfToken = useCallback(() => {
    const t = hfToken.trim();
    if (!t) return;
    try {
      useSessionStore.getState().updateSetting("huggingFaceToken", t);
    } catch (e) {
      console.error("[ONBOARD] Failed to save HF token:", e);
    }
  }, [hfToken]);

  // Navigation helpers — isolate save-on-advance logic.
  const goBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  };
  const skipToDone = () => setStep("done");
  const nextFrom1 = () => setStep(2);
  const nextFrom2 = () => { applyAudioSource(); setStep(3); };
  const skipFrom2 = () => setStep(3);
  const nextFrom3 = async () => {
    const k = apiKey.trim();
    if (k && !k.startsWith("sk-ant-")) {
      setApiKeyError("Key looks wrong — should start with sk-ant-");
      return;
    }
    await applyApiKey();
    setStep(4);
  };
  const skipFrom3 = () => setStep(4);
  const doneFrom4 = () => { applyHfToken(); setStep("done"); };
  const skipFrom4 = () => setStep("done");

  // ── Render ───────────────────────────────────────────────────────
  const surfaceStyle: CSSProperties = {
    width: "100%",
    maxWidth: 520,
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: "32px 34px 28px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Forti Fide"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={surfaceStyle}>
        {step !== "done" && <StepDots current={step} />}

        {step === 1 && (
          <>
            <h2 style={titleStyle}>Welcome to Forti Fide</h2>
            <div style={subtitleStyle}>With strong trust.</div>
            <p style={{ ...bodyStyle, marginBottom: 18 }}>
              Forti Fide captures audio from your environment, transcribes it locally,
              and annotates rhetorical patterns in real time. Everything happens on
              this device. Nothing leaves without your explicit choice.
            </p>
            <p style={{ ...smallStyle, color: TEXT, marginBottom: 4 }}>
              Capture mode works right now — no setup needed.
            </p>
            <p style={{ ...smallStyle, marginBottom: 28 }}>
              Live and Deep modes require a free Hugging Face account (Step 3).
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="ghost" onClick={skipToDone}>Skip setup →</Button>
              <Button variant="primary" onClick={nextFrom1}>Next →</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={titleStyle}>Choose your audio source</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, marginBottom: 14 }}>
              <SourceCard
                value="microphone"
                emoji="🎤"
                label="Microphone — your voice only"
                desc="For your own speech, presentations, or language practice"
                selected={audioSource === "microphone"}
                onSelect={setAudioSource}
              />
              <SourceCard
                value="loopback"
                emoji="🔊"
                label="Incoming — what plays through your speakers"
                desc="For podcasts, videos, calls you're listening to"
                selected={audioSource === "loopback"}
                onSelect={setAudioSource}
              />
              <SourceCard
                value="both"
                emoji="🎧"
                label="Both — microphone and system audio"
                desc="For meetings and conversations you're part of"
                selected={audioSource === "both"}
                onSelect={setAudioSource}
              />
            </div>
            <p style={{ ...smallStyle, marginBottom: 22 }}>
              You can change this any time in the toolbar.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="secondary" onClick={goBack}>← Back</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" onClick={skipFrom2}>Skip for now</Button>
                <Button variant="primary" onClick={nextFrom2}>Next →</Button>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={titleStyle}>AI Analysis (optional)</h2>
            <p style={{ ...bodyStyle, marginBottom: 16 }}>
              The AI Analysis feature lets you ask reflective questions about your
              sessions. It uses the Claude API — opt-in, and you trigger it manually.
              It never runs automatically.
            </p>
            <input
              type="password"
              placeholder="Paste your Claude API key"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              style={inputStyle}
              aria-invalid={apiKeyError ? "true" : "false"}
              aria-describedby="onboard-apikey-help"
            />
            <div id="onboard-apikey-help" style={{ marginTop: 8 }}>
              {apiKeyError ? (
                <span style={{ ...smallStyle, color: ERR }}>{apiKeyError}</span>
              ) : (
                <a
                  href="https://www.anthropic.com/api"
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...smallStyle, ...linkStyle }}
                >
                  Get a free API key at anthropic.com/api
                </a>
              )}
            </div>
            <p style={{ ...smallStyle, marginTop: 10, marginBottom: 22 }}>
              Your key is stored locally and never transmitted except to the Claude
              API when you manually trigger analysis.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="secondary" onClick={goBack}>← Back</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" onClick={skipFrom3}>Skip for now</Button>
                <Button variant="primary" disabled={!!apiKeyError} onClick={nextFrom3}>Next →</Button>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={titleStyle}>Speaker identification (optional)</h2>
            <p style={{ ...bodyStyle, marginBottom: 14 }}>
              Live and Deep modes identify who is speaking using the pyannote model.
              This requires Python 3.11 to be installed on your machine.
              Python 3.12 and newer are not yet supported.
              It also requires a free Hugging Face account and accepting the
              model licence.
            </p>
            <ol style={{ ...bodyStyle, paddingLeft: 20, marginBottom: 14 }}>
              <li style={{ marginBottom: 6 }}>
                Go to{" "}
                <a
                  href="https://huggingface.co/pyannote/speaker-diarization-3.1"
                  target="_blank"
                  rel="noreferrer"
                  style={linkStyle}
                >
                  huggingface.co/pyannote/speaker-diarization-3.1
                </a>
                {" "}and accept the licence (free, takes 30 seconds)
              </li>
              <li>Paste your Hugging Face token below</li>
            </ol>
            <input
              type="password"
              placeholder="Paste your Hugging Face token"
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
              style={inputStyle}
            />
            <div style={{ marginTop: 8 }}>
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                style={{ ...smallStyle, ...linkStyle }}
              >
                Get your token at huggingface.co/settings/tokens
              </a>
            </div>
            <div style={{ marginTop: 4 }}>
              <a
                href="https://www.python.org/downloads/release/python-3119/"
                target="_blank"
                rel="noreferrer"
                style={{ ...smallStyle, ...linkStyle }}
              >
                Python 3.11 — python.org/downloads/release/python-3119
              </a>
            </div>
            <p style={{ ...smallStyle, marginTop: 10, marginBottom: 22 }}>
              Without this, Capture mode works fully. Live and Deep modes will be
              available once you add your token and Python 3.11.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="secondary" onClick={goBack}>← Back</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" onClick={skipFrom4}>Skip for now</Button>
                <Button variant="primary" onClick={doneFrom4}>Done →</Button>
              </div>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 style={{ ...titleStyle, textAlign: "center" }}>You're ready.</h2>
            <p style={{ ...bodyStyle, textAlign: "center", marginBottom: 6 }}>
              Capture mode is active.
            </p>
            <p style={{ ...smallStyle, textAlign: "center", marginBottom: 26 }}>
              Full setup guide at{" "}
              <a
                href="https://fortifide.org/docs/setup"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                fortifide.org/docs/setup
              </a>
            </p>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Button variant="primary" onClick={onComplete}>Open Forti Fide →</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
