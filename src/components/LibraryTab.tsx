import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { api, type SavedSession, type SessionSummary } from "../bridge";
import type { DetectionInstance, PatternEntry } from "@fides/pattern-library";
import { useSessionStore } from "../stores/session-store";
import type { FidesSettings } from "../bridge";

// ─── Constants ───

const COLOR_TAGS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
type ColorTag = (typeof COLOR_TAGS)[number];

const COLOR_MAP: Record<ColorTag, string> = {
  red: "#c44e4e",
  orange: "#c4864e",
  yellow: "#c4a24e",
  green: "#4e9e4e",
  blue: "#4e7ec4",
  purple: "#8e4ec4",
};

const DATE_FILTERS = [
  { label: "All time", ms: 0 },
  { label: "Today", ms: 86_400_000 },
  { label: "This week", ms: 604_800_000 },
  { label: "This month", ms: 2_592_000_000 },
] as const;

// ─── Time formatting ───

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Paragraph reconstruction ───

const PARA_GAP_MS = 30_000;
const PARA_MAX_WORDS = 400;

function endsSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1]!;
  return last === "." || last === "?" || last === "!";
}

interface MergedParagraph {
  text: string;
  source: string;
  timestamp: number;
  wordCount: number;
}

function mergeSegmentsIntoParagraphs(
  segments: ReadonlyArray<{ text: string; source: string; capturedAt: number }>,
): MergedParagraph[] {
  if (segments.length === 0) return [];
  const paragraphs: MergedParagraph[] = [];
  let currentText = "";
  let currentSource = "";
  let currentTimestamp = 0;
  let currentWords = 0;

  const flush = () => {
    const trimmed = currentText.trim();
    if (trimmed.length > 0) {
      paragraphs.push({ text: trimmed, source: currentSource, timestamp: currentTimestamp, wordCount: currentWords });
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segWords = seg.text.trim().split(/\s+/).filter(Boolean).length;
    if (i === 0) {
      currentText = seg.text.trim();
      currentSource = seg.source;
      currentTimestamp = seg.capturedAt;
      currentWords = segWords;
      continue;
    }
    const prev = segments[i - 1]!;
    const gap = seg.capturedAt - prev.capturedAt;
    const sourceChanged = seg.source !== currentSource;
    const gapTooLong = gap > PARA_GAP_MS;
    const tooManyWords = currentWords + segWords > PARA_MAX_WORDS;
    const prevEnd = endsSentence(currentText);

    if (sourceChanged || gapTooLong || (tooManyWords && prevEnd)) {
      flush();
      currentText = seg.text.trim();
      currentSource = seg.source;
      currentTimestamp = seg.capturedAt;
      currentWords = segWords;
      continue;
    }

    if (prevEnd && currentWords > 100) {
      currentText += "\n\n" + seg.text.trim();
    } else {
      currentText += " " + seg.text.trim();
    }
    currentWords += segWords;
  }
  flush();
  return paragraphs;
}

function exactTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatTimestamp(ms: number, format: "exact" | "relative" | "both"): string {
  if (format === "exact") return exactTime(ms);
  if (format === "relative") {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return exactTime(ms);
  }
  return exactTime(ms);
}

// ─── Hashtag editor ───

function HashtagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, "-").replace(/^#/, "").toLowerCase();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
      setInput("");
    }
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: 3,
            color: "#888",
            fontSize: 11,
            padding: "1px 6px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          #{tag}
          <button
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            style={{ background: "none", border: "none", color: "#555", fontSize: 11, cursor: "pointer", padding: 0, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) { addTag(input); setInput(""); } }}
        placeholder="+ tag"
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#666",
          fontSize: 11,
          width: 60,
          padding: "2px 0",
        }}
      />
    </div>
  );
}

// ─── Color tag picker ───

function ColorTagPicker({
  selected,
  onChange,
}: {
  selected: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {COLOR_TAGS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(selected === c ? null : c)}
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: COLOR_MAP[c],
            border: selected === c ? "2px solid #d0d0d0" : "2px solid transparent",
            cursor: "pointer",
            padding: 0,
            outline: "none",
          }}
        />
      ))}
    </div>
  );
}

// ─── Transcript preview ───

function TranscriptPreview({
  session,
  settings,
}: {
  session: SavedSession;
  settings: FidesSettings;
}) {
  const timestampFormat = settings.timestampFormat ?? "exact";
  const showSourceLabels = settings.showSourceLabels ?? true;
  const segments = session.segments;

  const items = useMemo(() => {
    if (!segments || segments.length === 0) {
      const wc = session.text.trim().split(/\s+/).filter(Boolean).length;
      return [{ type: "text" as const, text: session.text, wordCount: wc }];
    }
    const paragraphs = mergeSegmentsIntoParagraphs(segments);
    const result: Array<
      | { type: "source-divider"; source: string; timestamp: number }
      | { type: "paragraph"; para: MergedParagraph; afterDivider: boolean }
    > = [];
    let lastSource: string | null = null;
    for (const para of paragraphs) {
      let divider = false;
      if (showSourceLabels && para.source && para.source !== lastSource) {
        result.push({ type: "source-divider", source: para.source, timestamp: para.timestamp });
        lastSource = para.source;
        divider = true;
      }
      result.push({ type: "paragraph", para, afterDivider: divider });
    }
    return result;
  }, [segments, session.text, showSourceLabels]);

  return (
    <div style={{ padding: "12px 0", maxHeight: 400, overflowY: "auto" }}>
      {items.map((item, i) => {
        if (item.type === "text") {
          return (
            <div key="text-block">
              <div style={{ color: "#3a3a3a", fontSize: 11, marginBottom: 3 }}>
                {item.wordCount} word{item.wordCount !== 1 ? "s" : ""}
              </div>
              <div style={{ color: "#d0d0d0", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {item.text.length > 3000 ? `${item.text.slice(0, 3000)}…` : item.text}
              </div>
            </div>
          );
        }
        if (item.type === "source-divider") {
          return (
            <div key={`src-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 6px" }}>
              <span style={{ color: "#666", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>{item.source}</span>
              <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
              <span style={{ color: "#444", fontSize: 11, whiteSpace: "nowrap" }}>{formatTimestamp(item.timestamp, timestampFormat)}</span>
            </div>
          );
        }
        const { para, afterDivider } = item;
        return (
          <div key={`para-${i}`} style={{ marginBottom: 14 }}>
            <div style={{ color: "#444", fontSize: 11, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#3a3a3a" }}>{para.wordCount} word{para.wordCount !== 1 ? "s" : ""}</span>
              {!afterDivider && <span>{formatTimestamp(para.timestamp, timestampFormat)}</span>}
            </div>
            <div style={{ color: "#d0d0d0", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{para.text}</div>
          </div>
        );
      })}
      {session.detections.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #1a1a1a", color: "#666", fontSize: 11 }}>
          {session.detections.length} pattern{session.detections.length !== 1 ? "s" : ""} detected
        </div>
      )}
    </div>
  );
}

// ─── Session card ───

function SessionCard({
  session,
  isActive,
  isExpanded,
  expandedSession,
  settings,
  patterns,
  onExpand,
  onLoadInClip,
  onDelete,
  onUpdate,
}: {
  session: SessionSummary;
  isActive: boolean;
  isExpanded: boolean;
  expandedSession: SavedSession | null;
  settings: FidesSettings;
  patterns: PatternEntry[];
  onExpand: (id: string) => void;
  onLoadInClip: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, fields: Partial<SavedSession>) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.name || session.textPreview.slice(0, 60));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [editingName]);

  const saveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== (session.name || session.textPreview.slice(0, 60))) {
      onUpdate(session.id, { name: trimmed });
    }
    setEditingName(false);
  };

  const colorTag = session.colorTag as ColorTag | null;
  const hashtags = session.hashtags ?? [];
  const sources = session.sources ?? [];
  const wordCount = session.wordCount ?? 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #1a1a1a",
        borderLeft: colorTag ? `3px solid ${COLOR_MAP[colorTag]}` : isActive ? "3px solid #444" : "3px solid transparent",
      }}
    >
      {/* Card header */}
      <div
        onClick={() => onExpand(session.id)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          padding: "12px 16px",
          cursor: "pointer",
          background: isActive || isHovered || isExpanded ? "#111" : "transparent",
        }}
      >
        {/* Row 1: Name + actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <input
                ref={nameRef}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#0a0a0a",
                  border: "1px solid #333",
                  borderRadius: 3,
                  color: "#d0d0d0",
                  fontSize: 14,
                  padding: "2px 6px",
                  width: "100%",
                  outline: "none",
                }}
              />
            ) : (
              <div
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
                style={{
                  color: "#b0b0b0",
                  fontSize: 14,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "text",
                }}
                title="Click to rename"
              >
                {session.name || session.textPreview}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {isHovered && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onLoadInClip(session.id); }}
                  style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
                >
                  Open
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  style={{ background: "transparent", border: "none", color: "#555", fontSize: 14, cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "#c44e4e"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "#555"; }}
                >
                  ×
                </button>
              </>
            )}
            <span style={{ color: "#555", fontSize: 10, transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>
              ▼
            </span>
          </div>
        </div>

        {/* Row 2: Metadata */}
        <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#555", fontSize: 11 }}>{formatDate(session.createdAt)}</span>
          <span style={{ color: "#444", fontSize: 11 }}>{timeAgo(session.createdAt)}</span>
          {sources.length > 0 && (
            <span style={{ color: "#444", fontSize: 11 }}>{sources.join(", ")}</span>
          )}
          {wordCount > 0 && (
            <span style={{ color: "#444", fontSize: 11 }}>{wordCount.toLocaleString()} words</span>
          )}
          <span style={{ color: "#444", fontSize: 11 }}>
            {session.detectionCount} pattern{session.detectionCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Row 3: Hashtags */}
        {hashtags.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {hashtags.map((tag) => (
              <span key={tag} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 3, color: "#666", fontSize: 10, padding: "1px 5px" }}>
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{ padding: "8px 16px", background: "#1a0a0a", borderTop: "1px solid #2a1a1a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#c44", fontSize: 12 }}>Delete this session? This cannot be undone.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>Cancel</button>
            <button
              onClick={() => { setConfirmDelete(false); onDelete(session.id); }}
              style={{ background: "#3a1a1a", border: "1px solid #5a2a2a", borderRadius: 3, color: "#c44", fontSize: 11, padding: "3px 10px", cursor: "pointer" }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Expanded view */}
      {isExpanded && expandedSession && (
        <div style={{ padding: "0 16px 12px" }}>
          {/* Metadata editor */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <ColorTagPicker
              selected={expandedSession.colorTag ?? null}
              onChange={(color) => onUpdate(session.id, { colorTag: color })}
            />
            <HashtagEditor
              tags={expandedSession.hashtags ?? []}
              onChange={(tags) => onUpdate(session.id, { hashtags: tags })}
            />
            <button
              onClick={() => {
                const text = expandedSession.text;
                if (text) {
                  useSessionStore.getState().analyzeClip(text);
                }
              }}
              style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#888", fontSize: 11, padding: "3px 10px", cursor: "pointer", marginLeft: "auto" }}
            >
              Re-analyse
            </button>
          </div>

          <TranscriptPreview session={expandedSession} settings={settings} />
        </div>
      )}
      {isExpanded && !expandedSession && (
        <div style={{ padding: "12px 16px", color: "#555", fontSize: 12 }}>Loading...</div>
      )}
    </div>
  );
}

// ─── Main component ───

export function LibraryTab({ onNavigateToClip }: { onNavigateToClip: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<SavedSession | null>(null);
  const [patterns, setPatterns] = useState<PatternEntry[]>([]);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);
  const settings = useSessionStore((s) => s.settings);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [patternFilter, setPatternFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState(0);
  const [colorFilter, setColorFilter] = useState<string | null>(null);

  const fetchSessions = useCallback(() => {
    api.listSessions()
      .then((list) => { setSessions(list); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSessions(); }, [lastSavedAt, fetchSessions]);

  useEffect(() => {
    api.getLibrary().then(setPatterns).catch(() => {});
  }, []);

  const handleDelete = useCallback((id: string) => {
    api.deleteSession(id).then(() => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (expandedId === id) { setExpandedId(null); setExpandedSession(null); }
    }).catch(() => {});
  }, [expandedId]);

  const handleLoadInClip = useCallback((id: string) => {
    useSessionStore.getState().loadSavedSession(id);
    onNavigateToClip();
  }, [onNavigateToClip]);

  const handleExpand = useCallback((id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedSession(null);
      return;
    }
    setExpandedId(id);
    setExpandedSession(null);
    api.loadSession(id).then((session) => {
      setExpandedSession(session as SavedSession);
    }).catch(() => {});
  }, [expandedId]);

  const handleUpdate = useCallback((id: string, fields: Partial<SavedSession>) => {
    // Update expanded session locally
    if (expandedSession && expandedSession.id === id) {
      const updated = { ...expandedSession, ...fields };
      setExpandedSession(updated);
      // Persist
      api.patchSession(updated.id, updated).catch(() => {});
    } else {
      // Load, merge, save
      api.loadSession(id).then((session) => {
        const updated = { ...session, ...fields } as SavedSession;
        api.patchSession(updated.id, updated).catch(() => {});
      }).catch(() => {});
    }
    // Update summary list locally
    setSessions((prev) => prev.map((s): SessionSummary => {
      if (s.id !== id) return s;
      const updated: SessionSummary = { ...s };
      if (fields.name !== undefined) updated.name = fields.name;
      if (fields.colorTag !== undefined) updated.colorTag = fields.colorTag;
      if (fields.hashtags !== undefined) updated.hashtags = fields.hashtags;
      return updated;
    }));
  }, [expandedSession]);

  // Filter sessions
  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Date filter
    if (dateFilter > 0) {
      const cutoff = Date.now() - dateFilter;
      result = result.filter((s) => new Date(s.createdAt).getTime() >= cutoff);
    }

    // Color filter
    if (colorFilter) {
      result = result.filter((s) => s.colorTag === colorFilter);
    }

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((s) => {
        const name = (s.name || s.textPreview || "").toLowerCase();
        const tags = (s.hashtags ?? []).join(" ").toLowerCase();
        const preview = (s.textPreview || "").toLowerCase();
        return name.includes(q) || tags.includes(q) || preview.includes(q) ||
          (q.startsWith("#") && tags.includes(q.slice(1)));
      });
    }

    // Pattern filter — requires loading full sessions, so for now just filter by detection count
    // In practice, patternFilter matches against expandedSession detections
    // For list-level filtering, we'd need patternIds in the summary — skip for now if no detections
    if (patternFilter) {
      result = result.filter((s) => s.detectionCount > 0);
    }

    return result;
  }, [sessions, searchQuery, patternFilter, dateFilter, colorFilter]);

  const clearFilters = () => {
    setSearchQuery("");
    setPatternFilter(null);
    setDateFilter(0);
    setColorFilter(null);
  };

  const hasActiveFilters = searchQuery || patternFilter || dateFilter > 0 || colorFilter;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Search and filter bar */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        {/* Row 1: Search box */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, #tag, word, or pattern..."
            style={{
              flex: 1,
              background: "#0a0a0a",
              border: "1px solid #1a1a1a",
              borderRadius: 4,
              color: "#d0d0d0",
              fontSize: 12,
              padding: "6px 10px",
              outline: "none",
            }}
          />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 3, color: "#666", fontSize: 11, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Row 2: Filter controls */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Pattern filter */}
          <select
            value={patternFilter ?? ""}
            onChange={(e) => setPatternFilter(e.target.value || null)}
            style={{
              background: "#0a0a0a",
              border: "1px solid #1a1a1a",
              borderRadius: 3,
              color: patternFilter ? "#d0d0d0" : "#666",
              fontSize: 11,
              padding: "3px 6px",
              outline: "none",
              maxWidth: 180,
            }}
          >
            <option value="">All patterns</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Date filter */}
          <div style={{ display: "flex", gap: 0, borderRadius: 3, overflow: "hidden" }}>
            {DATE_FILTERS.map((df) => (
              <button
                key={df.label}
                onClick={() => setDateFilter(df.ms)}
                style={{
                  background: dateFilter === df.ms ? "#2a2a2a" : "transparent",
                  border: "1px solid #1a1a1a",
                  borderRight: "none",
                  color: dateFilter === df.ms ? "#d0d0d0" : "#555",
                  fontSize: 10,
                  padding: "3px 8px",
                  cursor: "pointer",
                }}
              >
                {df.label}
              </button>
            ))}
            <div style={{ borderRight: "1px solid #1a1a1a" }} />
          </div>

          {/* Color filter */}
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {COLOR_TAGS.map((c) => (
              <button
                key={c}
                onClick={() => setColorFilter(colorFilter === c ? null : c)}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: COLOR_MAP[c],
                  border: colorFilter === c ? "2px solid #d0d0d0" : "2px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                  outline: "none",
                  opacity: colorFilter && colorFilter !== c ? 0.3 : 1,
                }}
              />
            ))}
          </div>

          {/* Result count */}
          <span style={{ color: "#444", fontSize: 11, marginLeft: "auto" }}>
            {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
            {hasActiveFilters ? " match" : ""}
          </span>
        </div>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? null : filteredSessions.length === 0 ? (
          <div style={{ padding: "24px", color: "#555", fontSize: 13, textAlign: "center" }}>
            {hasActiveFilters ? "No sessions match your filters." : "No saved analyses."}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isActive={session.id === currentSessionId}
              isExpanded={session.id === expandedId}
              expandedSession={session.id === expandedId ? expandedSession : null}
              settings={settings}
              patterns={patterns}
              onExpand={handleExpand}
              onLoadInClip={handleLoadInClip}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
}
