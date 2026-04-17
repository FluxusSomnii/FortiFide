/**
 * Check 5 — Hugging Face token action card.
 *
 * Three failure modes from the engine:
 *   Missing        → no token configured yet
 *   WrongVersion   → a token is configured but Hugging Face rejected it
 *   Unknown        → transient (network) error; show retry, hide the input
 *
 * Tokens are persisted via the existing settings store path that every other
 * component uses: `updateSetting("huggingFaceToken", value)`. Reusing that
 * keeps the wizard consistent with the Settings tab — save here = save there.
 */
import { useState } from "react";
import type { CheckResult, HfTokenDetails } from "../setupTypes";
import { ActionCardShell } from "../ActionCardShell";
import { WizardButton } from "../WizardButton";
import { openExternal } from "../shellOpen";
import { useSessionStore } from "../../../stores/session-store";
import { bodyStyle, smallStyle, COLORS, FONT_BODY } from "../setupStyles";

interface Props {
  check: CheckResult<HfTokenDetails>;
  onRecheck: () => void;
}

const TOKEN_SETTINGS_URL = "https://huggingface.co/settings/tokens";

export function HfTokenActionCard({ check, onRecheck }: Props) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (check.status === "ok") return null;

  // Transient error path — don't offer the token input; the token may be fine.
  if (check.status === "unknown") {
    return (
      <ActionCardShell ariaLabel="Hugging Face token — connectivity issue">
        <p style={bodyStyle}>
          Could not reach Hugging Face to validate the token. This looks like
          a network issue, not a token problem. Check your connection and
          retry.
        </p>
        {check.message ? (
          <p style={{ ...smallStyle, color: COLORS.muted }}>{check.message}</p>
        ) : null}
        <div>
          <WizardButton variant="primary" onClick={onRecheck}>
            Retry
          </WizardButton>
        </div>
      </ActionCardShell>
    );
  }

  const submit = async () => {
    const value = token.trim();
    if (!value) {
      setError("Paste the token before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // IMPORTANT: await the real async save path rather than the store's
      // fire-and-forget `updateSetting`. The Rust engine re-reads
      // fides-settings.json on every get_setup_state() call, so if we
      // re-check before the Node sidecar has flushed the write to disk,
      // the engine sees the old (missing) token and the wizard flips back
      // to the "Missing" state even though the new token is in the store.
      const store = useSessionStore.getState();
      const updated = { ...store.settings, huggingFaceToken: value };
      await store.saveSettings(updated);
      onRecheck();
    } catch (e) {
      console.error("[SETUP] HF token save failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(0,0,0,0.35)",
    border: `1px solid ${error ? COLORS.err : COLORS.border}`,
    borderRadius: 6,
    padding: "10px 12px",
    color: COLORS.text,
    fontFamily: FONT_BODY,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  };

  return (
    <ActionCardShell ariaLabel="Hugging Face token">
      <p style={bodyStyle}>
        {check.status === "wrong_version"
          ? "This token is invalid or expired. Create a new read-scope token and paste it below."
          : "Forti Fide uses Hugging Face models for speaker detection. You need a free account and a read-scope token. Create one, then paste it below."}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton
          variant="primary"
          external
          onClick={() => openExternal(TOKEN_SETTINGS_URL)}
        >
          Create a token
        </WizardButton>
      </div>
      <input
        type="password"
        placeholder="hf_…"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          if (error) setError(null);
        }}
        aria-label="Hugging Face token"
        aria-invalid={error ? "true" : "false"}
        autoComplete="off"
        spellCheck={false}
        style={inputStyle}
      />
      {error ? (
        <div style={{ ...smallStyle, color: COLORS.err }}>{error}</div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <WizardButton variant="primary" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Save token"}
        </WizardButton>
        <WizardButton variant="secondary" onClick={onRecheck}>
          Re-check
        </WizardButton>
      </div>
      <p style={{ ...smallStyle, color: COLORS.muted }}>
        Your token is stored locally on this device. It is never transmitted
        except directly to huggingface.co when Forti Fide needs it.
      </p>
    </ActionCardShell>
  );
}
