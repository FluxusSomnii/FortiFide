import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/session-store";
import { useDisplayStore } from "../stores/display-store";
import { api } from "../bridge";
import type { FidesSettings, CapturePreset } from "../bridge";
import type { PatternCategory } from "@fides/pattern-library";

// ─── Constants ───

const DEDUP_OPTIONS: Array<{
  value: FidesSettings["dedupSensitivity"];
  label: string;
  desc: string;
}> = [
  {
    value: "strict",
    label: "Strict",
    desc: "Removes near-duplicate segments. Best for long conversations and meetings.",
  },
  {
    value: "balanced",
    label: "Balanced",
    desc: "Removes overlap artifacts, preserves intentional repetition after 15 seconds. Recommended.",
  },
  {
    value: "minimal",
    label: "Minimal",
    desc: "Only removes exact consecutive duplicates within 2 seconds. Preserves rapid repetition tactics.",
  },
  {
    value: "none",
    label: "None",
    desc: "No deduplication. Every chunk kept verbatim. Maximum fidelity.",
  },
];

const CHUNK_OPTIONS: Array<{ value: FidesSettings["chunkSizeSeconds"]; label: string }> = [
  { value: 3, label: "3s" },
  { value: 5, label: "5s" },
  { value: 10, label: "10s" },
  { value: 15, label: "15s" },
];

const CONTEXT_OPTIONS: Array<{ value: FidesSettings["contextWindowMinutes"]; label: string }> = [
  { value: 1, label: "1 min" },
  { value: 2, label: "2 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
];

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "manipulation", label: "Manipulation" },
  { id: "authority", label: "Authority" },
  { id: "fallacy", label: "Fallacy" },
  { id: "emotional", label: "Emotional" },
  { id: "framing", label: "Framing" },
  { id: "narrative", label: "Narrative" },
  { id: "cognitive-bias", label: "Cognitive Bias" },
];

const LANGUAGES = [
  "auto", "en", "zh", "es", "ar", "hi", "pt", "fr", "de", "ja",
  "ru", "ko", "it", "nl", "pl", "tr", "sv", "da", "fi", "no", "uk",
];

const LANGUAGE_LABELS: Record<string, string> = {
  auto: "Auto-detect", en: "English", zh: "Chinese", es: "Spanish",
  ar: "Arabic", hi: "Hindi", pt: "Portuguese", fr: "French",
  de: "German", ja: "Japanese", ru: "Russian", ko: "Korean",
  it: "Italian", nl: "Dutch", pl: "Polish", tr: "Turkish",
  sv: "Swedish", da: "Danish", fi: "Finnish", no: "Norwegian", uk: "Ukrainian",
};

const WHISPER_MODELS: Array<{
  value: FidesSettings["whisperModel"];
  label: string;
  size: string;
  desc: string;
}> = [
  { value: "tiny", label: "Tiny", size: "75 MB", desc: "Fastest, lower accuracy" },
  { value: "base", label: "Base", size: "150 MB", desc: "Good balance" },
  { value: "small", label: "Small", size: "500 MB", desc: "Better accuracy" },
  { value: "medium", label: "Medium", size: "1.5 GB", desc: "High accuracy" },
  { value: "large", label: "Large", size: "3 GB", desc: "Best accuracy, GPU recommended" },
];

const ANALYSIS_MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Recommended)" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Faster, cheaper)" },
  { value: "claude-opus-4-6", label: "Claude Opus 4 (Most capable, expensive)" },
];

const AUTO_DELETE_OPTIONS: Array<{ value: FidesSettings["sessionAutoDeleteDays"]; label: string }> = [
  { value: null, label: "Never" },
  { value: 7, label: "After 7 days" },
  { value: 30, label: "After 30 days" },
  { value: 90, label: "After 90 days" },
];

// ─── Styles ───

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  cursor: "pointer",
  userSelect: "none",
};

const sectionTitleStyle: React.CSSProperties = {
  color: "#d0d0d0",
  fontSize: 14,
  fontWeight: 500,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 12,
  marginBottom: 6,
  display: "block",
};

const hintStyle: React.CSSProperties = {
  color: "#555",
  fontSize: 11,
  marginTop: 4,
  lineHeight: 1.4,
};

const sliderTrackStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderRadius: 4,
  overflow: "hidden",
};

const toggleStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "#2a2a2a" : "transparent",
  border: "1px solid #2a2a2a",
  color: active ? "#d0d0d0" : "#666",
  fontSize: 11,
  padding: "5px 12px",
  cursor: "pointer",
  flex: 1,
  textAlign: "center",
});

const selectStyle: React.CSSProperties = {
  background: "#111",
  border: "1px solid #2a2a2a",
  borderRadius: 4,
  color: "#d0d0d0",
  fontSize: 12,
  padding: "5px 8px",
  width: "100%",
};

const inputStyle: React.CSSProperties = {
  background: "#111",
  border: "1px solid #2a2a2a",
  borderRadius: 4,
  color: "#d0d0d0",
  fontSize: 12,
  padding: "5px 8px",
  width: "100%",
  boxSizing: "border-box",
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
};

// ─── Mic device selector ───

function MicDeviceSelector({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [devices, setDevices] = useState<string[]>([]);
  useEffect(() => {
    invoke<string[]>("list_audio_input_devices").then(setDevices).catch(() => {});
  }, []);

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 6 }}>Microphone Device</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{
          background: "#111", border: "1px solid #2a2a2a", borderRadius: 4,
          color: "#d0d0d0", fontSize: 12, padding: "6px 10px", width: "100%",
          outline: "none", fontFamily: "inherit",
        }}
      >
        <option value="">System Default</option>
        <option value="none">None (disable mic)</option>
        {devices.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
        Select your microphone. Choose "None" to disable mic capture entirely (useful when only capturing system audio).
      </div>
    </div>
  );
}

// ─── Reusable sub-components ───

function StopSlider<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={sliderTrackStyle}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          style={toggleStyle(value === opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          background: checked ? "#4a7a4a" : "#2a2a2a",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: checked ? "#8c8" : "#666",
            position: "absolute",
            top: 2,
            left: checked ? 16 : 2,
            transition: "left 0.15s",
          }}
        />
      </div>
      {label && <span style={{ color: "#999", fontSize: 12 }}>{label}</span>}
    </label>
  );
}

function RangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#666" }}
      />
      <span style={{ color: "#888", fontSize: 11, minWidth: 36, textAlign: "right" }}>
        {formatValue ? formatValue(value) : value}
      </span>
    </div>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div style={{ borderBottom: "1px solid #1a1a1a" }}>
      <div style={sectionHeaderStyle} onClick={() => setOpen(!open)}>
        <span style={sectionTitleStyle}>{title}</span>
        <span style={{ color: "#555", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && <div style={{ paddingBottom: 16 }}>{children}</div>}
    </div>
  );
}

// ─── Excluded Windows Tag Input ───

function ExcludedWindowsInput({
  windows,
  onChange,
}: {
  windows: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !windows.includes(trimmed)) {
      onChange([...windows, trimmed]);
    }
    setInput("");
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        {windows.map((w) => (
          <span
            key={w}
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 3,
              color: "#999",
              fontSize: 11,
              padding: "2px 6px",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {w}
            <span
              onClick={() => onChange(windows.filter((x) => x !== w))}
              style={{ cursor: "pointer", color: "#666" }}
            >
              ×
            </span>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Window title to exclude..."
        />
        <button
          onClick={add}
          style={{
            background: "transparent",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            color: "#888",
            fontSize: 11,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Main Settings Component ───

function SavePresetForm({
  settings,
  updateSetting,
}: {
  settings: FidesSettings;
  updateSetting: <K extends keyof FidesSettings>(key: K, value: FidesSettings[K]) => void;
}) {
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const handleSave = () => {
    if (!name.trim()) return;
    const preset: CapturePreset = {
      id: name.trim().toLowerCase().replace(/\s+/g, "-"),
      name: name.trim(),
      isDefault: false,
      captureMode: settings.captureMode ?? "live",
      chunkSizeSeconds: settings.chunkSizeSeconds ?? 5,
      confidenceFloor: settings.confidenceFloor ?? 0.4,
      audioSource: settings.audioSource ?? "loopback",
      dedupSensitivity: settings.dedupSensitivity ?? "balanced",
    };
    updateSetting("presets", [...(settings.presets ?? []), preset]);
    setName("");
    setShowForm(false);
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        style={{ marginTop: 8, background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: "#666", fontSize: 11, padding: "4px 12px", cursor: "pointer" }}
      >
        Save Current as Preset
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
        placeholder="Preset name..."
        autoFocus
        style={{ background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 4, color: "#d0d0d0", fontSize: 12, padding: "4px 8px", outline: "none", flex: 1 }}
      />
      <button onClick={handleSave} style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#d0d0d0", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>Save</button>
      <button onClick={() => { setShowForm(false); setName(""); }} style={{ background: "transparent", border: "none", color: "#555", fontSize: 11, cursor: "pointer" }}>Cancel</button>
    </div>
  );
}

export function SettingsTab() {
  const settings = useSessionStore((s) => s.settings);
  const settingsLoaded = useSessionStore((s) => s.settingsLoaded);
  const updateSetting = useSessionStore((s) => s.updateSetting);
  const resetSettingsToDefaults = useSessionStore((s) => s.resetSettingsToDefaults);
  const loadSettings = useSessionStore((s) => s.loadSettings);
  const setConfidenceFloor = useDisplayStore((s) => s.setConfidenceFloor);
  const setCategoryVisible = useDisplayStore((s) => s.setCategoryVisible);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});

  // Load settings on mount
  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings();
    }
  }, [settingsLoaded, loadSettings]);

  // Check model download status
  useEffect(() => {
    invoke<{ downloaded: boolean }>("get_model_status")
      .then((s) => setModelStatus((prev) => ({ ...prev, [settings.whisperModel]: s.downloaded })))
      .catch(() => {});
  }, [settings.whisperModel]);

  // Sync confidence floor and categories to display store when changed
  const handleConfidenceFloor = useCallback(
    (v: number) => {
      updateSetting("confidenceFloor", v);
      setConfidenceFloor(v);
    },
    [updateSetting, setConfidenceFloor],
  );

  const handleCategoryToggle = useCallback(
    (catId: string, enabled: boolean) => {
      const cats = enabled
        ? [...settings.enabledCategories, catId]
        : settings.enabledCategories.filter((c) => c !== catId);
      updateSetting("enabledCategories", cats);
      setCategoryVisible(catId as PatternCategory, enabled);
    },
    [settings.enabledCategories, updateSetting, setCategoryVisible],
  );

  const handleReset = useCallback(async () => {
    await resetSettingsToDefaults();
    setShowResetConfirm(false);
    // Sync display store to defaults
    setConfidenceFloor(0.4);
    for (const cat of CATEGORIES) {
      setCategoryVisible(cat.id as PatternCategory, true);
    }
  }, [resetSettingsToDefaults, setConfidenceFloor, setCategoryVisible]);

  if (!settingsLoaded) {
    return (
      <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Loading settings...</div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
      {/* ─── Section 1: Audio & Capture ─── */}
      <Section title="Audio & Capture" defaultOpen={true}>
        {/* Deduplication Sensitivity */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Deduplication Sensitivity</span>
          <StopSlider
            options={DEDUP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={settings.dedupSensitivity}
            onChange={(v) => updateSetting("dedupSensitivity", v)}
          />
          <div style={hintStyle}>
            {DEDUP_OPTIONS.find((o) => o.value === settings.dedupSensitivity)?.desc}
          </div>
        </div>

        {/* Chunk Size */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Chunk Size</span>
          <StopSlider
            options={CHUNK_OPTIONS}
            value={settings.chunkSizeSeconds}
            onChange={(v) => updateSetting("chunkSizeSeconds", v)}
          />
          <div style={hintStyle}>
            How much audio Whisper transcribes at once. Shorter = faster feedback, longer = more context per segment.
          </div>
        </div>

        {/* Audio Source */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Audio Source</span>
          <StopSlider
            options={[
              { value: "loopback" as const, label: "System Audio" },
              { value: "microphone" as const, label: "Microphone" },
              { value: "both" as const, label: "Both" },
            ]}
            value={settings.audioSource}
            onChange={(v) => updateSetting("audioSource", v)}
          />
        </div>

        {/* Microphone Device */}
        <MicDeviceSelector
          value={settings.micDevice}
          onChange={(v) => updateSetting("micDevice", v)}
        />

        {/* Noise Threshold */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Noise Threshold</span>
          <RangeSlider
            min={0}
            max={1}
            step={0.05}
            value={settings.noiseThreshold}
            onChange={(v) => updateSetting("noiseThreshold", v)}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div style={hintStyle}>
            Minimum audio level before a chunk is transcribed. Increase to filter background noise.
          </div>
        </div>

        {/* Transcription Language */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Transcription Language</span>
          <select
            style={selectStyle}
            value={settings.transcriptionLanguage}
            onChange={(e) => updateSetting("transcriptionLanguage", e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang] ?? lang}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* ─── Section 2: Analysis ─── */}
      <Section title="Analysis" defaultOpen={false}>
        {/* Pattern detection is always on — no longer a user setting. */}

        {/* Context Window */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Context Window</span>
          <StopSlider
            options={CONTEXT_OPTIONS}
            value={settings.contextWindowMinutes}
            onChange={(v) => updateSetting("contextWindowMinutes", v)}
          />
          <div style={hintStyle}>
            How much transcript is sent when you click Clip & Analyse.
          </div>
        </div>

        {/* Confidence Floor */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Confidence Floor</span>
          <RangeSlider
            min={0}
            max={1}
            step={0.05}
            value={settings.confidenceFloor}
            onChange={handleConfidenceFloor}
            formatValue={(v) => `${Math.round(v * 100)}%`}
          />
          <div style={hintStyle}>
            Minimum confidence for a pattern to appear in results. Default: 40%.
          </div>
        </div>

        {/* Active Pattern Categories */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Active Pattern Categories</span>
          {CATEGORIES.map((cat) => (
            <label key={cat.id} style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={settings.enabledCategories.includes(cat.id)}
                onChange={(e) => handleCategoryToggle(cat.id, e.target.checked)}
                style={{ accentColor: "#666" }}
              />
              <span style={{ color: "#999", fontSize: 12 }}>{cat.label}</span>
            </label>
          ))}
        </div>

        {/* Daily Token Budget */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Daily Token Budget (USD)</span>
          <input
            style={inputStyle}
            type="number"
            min={0}
            step={0.5}
            value={settings.dailyTokenBudgetUsd ?? ""}
            placeholder="Unlimited"
            onChange={(e) => {
              const val = e.target.value === "" ? null : Number(e.target.value);
              updateSetting("dailyTokenBudgetUsd", val);
            }}
          />
          <div style={hintStyle}>
            Auto-analysis pauses when daily limit is reached. Manual clips always work.
          </div>
        </div>
      </Section>

      {/* ─── Section 3: Display ─── */}
      <Section title="Display" defaultOpen={false}>
        {/* Timestamp Format */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Timestamp Format</span>
          <StopSlider
            options={[
              { value: "exact" as const, label: "Exact" },
              { value: "relative" as const, label: "Relative" },
              { value: "both" as const, label: "Both" },
            ]}
            value={settings.timestampFormat}
            onChange={(v) => updateSetting("timestampFormat", v)}
          />
        </div>

        {/* Segment Compression Threshold */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Segment Compression</span>
          <RangeSlider
            min={100}
            max={2000}
            step={50}
            value={settings.segmentCompressionThreshold}
            onChange={(v) => updateSetting("segmentCompressionThreshold", v)}
            formatValue={(v) => `${v} chars`}
          />
          <div style={hintStyle}>
            Segments longer than this collapse by default. Click to expand.
          </div>
        </div>

        {/* Show Source Labels */}
        <div style={fieldStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={labelStyle}>Show Source Labels</span>
            <Toggle
              checked={settings.showSourceLabels}
              onChange={(v) => updateSetting("showSourceLabels", v)}
            />
          </div>
        </div>
      </Section>

      {/* ─── Section 4: Privacy ─── */}
      <Section title="Privacy" defaultOpen={false}>
        {/* Local Only Mode */}
        <div style={fieldStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ ...labelStyle, color: settings.localOnlyMode ? "#c66" : "#999" }}>
              Local Only Mode
            </span>
            <Toggle
              checked={settings.localOnlyMode}
              onChange={(v) => updateSetting("localOnlyMode", v)}
            />
          </div>
          {settings.localOnlyMode && (
            <div style={{ ...hintStyle, color: "#c66" }}>
              All API calls disabled. Whisper transcription works. Pattern analysis unavailable.
            </div>
          )}
        </div>

        {/* Session Auto-Delete */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Session Auto-Delete</span>
          <select
            style={selectStyle}
            value={settings.sessionAutoDeleteDays === null ? "null" : String(settings.sessionAutoDeleteDays)}
            onChange={(e) => {
              const val = e.target.value === "null" ? null : (Number(e.target.value) as 7 | 30 | 90);
              updateSetting("sessionAutoDeleteDays", val);
            }}
          >
            {AUTO_DELETE_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={opt.value === null ? "null" : String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
          <div style={hintStyle}>
            Automatically delete saved sessions older than selected period.
          </div>
        </div>

        {/* Excluded Windows */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Excluded Windows</span>
          <ExcludedWindowsInput
            windows={settings.excludedWindows}
            onChange={(v) => updateSetting("excludedWindows", v)}
          />
        </div>
      </Section>

      {/* ─── Section 5: Advanced ─── */}
      <Section title="Advanced" defaultOpen={false}>
        {/* Anthropic API Key */}
        {(() => {
          const [apiKey, setApiKey] = useState("");
          const [maskedKey, setMaskedKey] = useState<string | null>(null);
          const [saving, setSaving] = useState(false);
          const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

          useEffect(() => {
            api.getApiSettings().then((r) => {
              if (r.apiKey) setMaskedKey(r.apiKey);
            }).catch(() => {});
          }, []);

          const handleSave = async () => {
            if (!apiKey.trim()) return;
            setSaving(true);
            setStatus("idle");
            try {
              await api.saveApiSettings(apiKey.trim());
              setMaskedKey(`${apiKey.trim().slice(0, 8)}...${apiKey.trim().slice(-4)}`);
              setApiKey("");
              setStatus("saved");
              setTimeout(() => setStatus("idle"), 3000);
            } catch {
              setStatus("error");
            } finally {
              setSaving(false);
            }
          };

          return (
            <div style={fieldStyle}>
              <span style={labelStyle}>Anthropic API Key</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  type="password"
                  value={apiKey}
                  placeholder={maskedKey ?? "sk-ant-..."}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                />
                <button
                  style={{
                    padding: "4px 12px",
                    background: saving ? "#555" : "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: saving ? "wait" : "pointer",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                  disabled={saving || !apiKey.trim()}
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                {status === "saved" && <span style={{ color: "#4ade80", fontSize: 12 }}>Saved</span>}
                {status === "error" && <span style={{ color: "#ef4444", fontSize: 12 }}>Failed</span>}
              </div>
              <div style={hintStyle}>
                Required for pattern analysis. Key is stored locally in ~/.fortifide/settings.json.
                {maskedKey && <span style={{ marginLeft: 6, color: "#4ade80" }}>Current: {maskedKey}</span>}
              </div>
            </div>
          );
        })()}

        {/* Whisper Model */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Whisper Model</span>
          <StopSlider
            options={WHISPER_MODELS.map((m) => ({ value: m.value, label: m.label }))}
            value={settings.whisperModel}
            onChange={(v) => updateSetting("whisperModel", v)}
          />
          {(() => {
            const m = WHISPER_MODELS.find((x) => x.value === settings.whisperModel);
            return m ? (
              <div style={hintStyle}>
                {m.size} — {m.desc}
                {modelStatus[settings.whisperModel] === false && (
                  <span style={{ color: "#a86", marginLeft: 8 }}>
                    Model not downloaded. Will download on next capture start.
                  </span>
                )}
              </div>
            ) : null;
          })()}
        </div>

        {/* Analysis Model */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Analysis Model</span>
          <select
            style={selectStyle}
            value={settings.analysisModel}
            onChange={(e) => updateSetting("analysisModel", e.target.value)}
          >
            {ANALYSIS_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Hume AI API Key */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Hume AI API Key</span>
          <input
            style={inputStyle}
            type="password"
            value={settings.humeApiKey ?? ""}
            placeholder="Leave blank to skip tone analysis"
            onChange={(e) => {
              const val = e.target.value === "" ? null : e.target.value;
              updateSetting("humeApiKey", val);
            }}
          />
          <div style={hintStyle}>
            For emotional tone analysis. Get a key at hume.ai.
          </div>
        </div>

        {/* Export Format */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Export Format</span>
          <StopSlider
            options={[
              { value: "json" as const, label: "JSON" },
              { value: "text" as const, label: "Plain text" },
              { value: "markdown" as const, label: "Markdown" },
            ]}
            value={settings.exportFormat}
            onChange={(v) => updateSetting("exportFormat", v)}
          />
        </div>

        {/* ─── Diarization ─── */}

        {/* HuggingFace Token */}
        <div style={fieldStyle}>
          <span style={labelStyle}>HuggingFace Token</span>
          <input
            style={inputStyle}
            type="password"
            value={settings.huggingFaceToken ?? ""}
            placeholder="hf_..."
            onChange={(e) => {
              const val = e.target.value === "" ? null : e.target.value;
              updateSetting("huggingFaceToken", val);
            }}
          />
          <div style={hintStyle}>
            Required for speaker diarization model download. Get a free token at huggingface.co.
          </div>
        </div>

        {/* Capture Mode */}
        <div style={fieldStyle}>
          <span style={labelStyle}>Capture Mode</span>
          <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden", width: "fit-content" }}>
            {(["deep", "live", "capture"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  updateSetting("captureMode", mode);
                  useSessionStore.getState().setCaptureMode(mode);
                  updateSetting("speakerDiarization", mode !== "capture");
                }}
                style={{
                  background: settings.captureMode === mode ? "#2a2a2a" : "transparent",
                  border: "1px solid #2a2a2a",
                  borderRight: "none",
                  color: settings.captureMode === mode ? "#d0d0d0" : "#666",
                  fontSize: 12,
                  padding: "6px 16px",
                  cursor: "pointer",
                }}
              >
                {mode === "deep" ? "Deep" : mode === "live" ? "Speakers" : "Transcribe"}
              </button>
            ))}
            <div style={{ borderRight: "1px solid #2a2a2a" }} />
          </div>
          <div style={hintStyle}>
            {settings.captureMode === "deep" && "Whisper + diarization + LLM. Best speaker accuracy, ~15s latency. Text arrives in 60s blocks."}
            {settings.captureMode === "live" && "Whisper + diarization. Speaker labels with ~5-10s delay."}
            {settings.captureMode === "capture" && "Whisper only. Fastest output, no speaker labels."}
          </div>
        </div>
      </Section>

      {/* ─── Presets ─── */}
      <Section title="Presets" defaultOpen={false}>
        {(settings.presets ?? []).map((preset) => (
          <div key={preset.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
            <div>
              <span style={{ color: "#d0d0d0", fontSize: 13 }}>{preset.name}</span>
              <span style={{ color: "#555", fontSize: 11, marginLeft: 8 }}>
                {preset.captureMode}
              </span>
            </div>
            {!preset.isDefault && (
              <button
                onClick={() => {
                  const updated = (settings.presets ?? []).filter((p) => p.id !== preset.id);
                  updateSetting("presets", updated);
                }}
                style={{ background: "transparent", border: "none", color: "#555", fontSize: 14, cursor: "pointer", padding: "2px 4px" }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <SavePresetForm settings={settings} updateSetting={updateSetting} />
      </Section>

      {/* ─── Restore Defaults ─── */}
      <div style={{ padding: "24px 0", textAlign: "center" }}>
        {!showResetConfirm ? (
          <button
            onClick={() => setShowResetConfirm(true)}
            style={{
              background: "transparent",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              color: "#888",
              fontSize: 12,
              padding: "8px 24px",
              cursor: "pointer",
            }}
          >
            Restore Defaults
          </button>
        ) : (
          <div>
            <div style={{ color: "#999", fontSize: 12, marginBottom: 12 }}>
              Reset all settings to defaults? This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={handleReset}
                style={{
                  background: "#3a1a1a",
                  border: "1px solid #5a2a2a",
                  borderRadius: 4,
                  color: "#e55",
                  fontSize: 12,
                  padding: "6px 16px",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #2a2a2a",
                  borderRadius: 4,
                  color: "#888",
                  fontSize: 12,
                  padding: "6px 16px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
