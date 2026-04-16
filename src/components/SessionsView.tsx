import { useState, useEffect, useMemo } from "react";
import { api, type SessionSummary } from "../bridge";
import { useSessionStore } from "../stores/session-store";

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const COLOR_PALETTE = ["#e85d4a", "#e8a04a", "#4ae8a0", "#6366f1", "#4a8ae8", "#a04ae8", "#888888"];

type SortMode = "newest" | "oldest" | "patterns";

export function SessionsView({ onSelectSession }: { onSelectSession: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortMode>("newest");
  const lastSavedAt = useSessionStore((s) => s.lastSavedAt);

  useEffect(() => {
    api.listSessions().then(setSessions).catch(() => {});
  }, [lastSavedAt]);

  const filtersActive = (colorFilter ? 1 : 0) + (audioOnly ? 1 : 0) + (search.trim() ? 1 : 0) + (sortBy !== "newest" ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setColorFilter(null);
    setAudioOnly(false);
    setSortBy("newest");
  };

  const filtered = useMemo(() => {
    let result = sessions.filter((s) => {
      // Text search — name, textPreview, hashtags
      const q = search.toLowerCase();
      const matchesText = !q ||
        (s.name ?? "").toLowerCase().includes(q) ||
        (s.textPreview ?? "").toLowerCase().includes(q) ||
        (s.hashtags ?? []).some((t) => t.toLowerCase().includes(q));

      // Color filter
      const matchesColor = !colorFilter || s.colorTag === colorFilter;

      // Audio filter
      const matchesAudio = !audioOnly || s.hasAudio || s.hasMicAudio || s.hasSystemAudio;

      return matchesText && matchesColor && matchesAudio;
    });

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === "patterns") return (b.detectionCount ?? 0) - (a.detectionCount ?? 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // newest
    });

    return result;
  }, [sessions, search, colorFilter, audioOnly, sortBy]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "18px 24px" }}>
      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search sessions, patterns, speakers..."
        style={{
          background: "#0f0f12", border: "1px solid #1a1a1e", borderRadius: 7,
          color: "#666", fontSize: 11, padding: "8px 12px", outline: "none", marginBottom: 8,
          fontFamily: "inherit",
        }}
      />

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {/* Color filter dots */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button onClick={() => setColorFilter(null)} style={{
            background: "none", border: "none", color: colorFilter ? "#444" : "#666",
            fontSize: 9, cursor: "pointer", padding: "2px 4px", fontFamily: "inherit",
          }}>All</button>
          {COLOR_PALETTE.map((c) => (
            <button key={c} onClick={() => setColorFilter(colorFilter === c ? null : c)} style={{
              width: 14, height: 14, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
              border: colorFilter === c ? "2px solid #ddd" : "2px solid transparent", outline: "none",
              opacity: colorFilter && colorFilter !== c ? 0.3 : 1, transition: "opacity 0.15s",
            }} />
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 14, background: "#1a1a1e" }} />

        {/* Audio only toggle */}
        <button onClick={() => setAudioOnly(!audioOnly)} style={{
          background: audioOnly ? "#181828" : "transparent",
          border: audioOnly ? "1px solid #303050" : "1px solid #1a1a1e",
          borderRadius: 4, color: audioOnly ? "#8888cc" : "#333",
          fontSize: 9, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.15s",
        }}>🎙 Audio only</button>

        {/* Divider */}
        <div style={{ width: 1, height: 14, background: "#1a1a1e" }} />

        {/* Sort buttons */}
        <div style={{ display: "flex", gap: 2 }}>
          {(["newest", "oldest", "patterns"] as const).map((mode) => (
            <button key={mode} onClick={() => setSortBy(mode)} style={{
              background: sortBy === mode ? "#181828" : "transparent",
              border: sortBy === mode ? "1px solid #303050" : "1px solid transparent",
              borderRadius: 3, color: sortBy === mode ? "#8888cc" : "#333",
              fontSize: 9, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit",
              textTransform: "capitalize", transition: "all 0.15s",
            }}>{mode === "patterns" ? "Most patterns" : mode}</button>
          ))}
        </div>

        {/* Active filter count */}
        {filtersActive > 0 && (
          <>
            <div style={{ width: 1, height: 14, background: "#1a1a1e" }} />
            <button onClick={clearFilters} style={{
              background: "none", border: "none", color: "#444",
              fontSize: 9, cursor: "pointer", padding: "2px 4px", fontFamily: "inherit",
              textDecoration: "underline", textUnderlineOffset: 2,
            }}>{filtersActive} filter{filtersActive !== 1 ? "s" : ""} · clear</button>
          </>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#303030", marginBottom: 12 }}>
        {filtered.length} session{filtered.length !== 1 ? "s" : ""}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 && filtersActive > 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#333", marginBottom: 8 }}>No sessions match your filters.</div>
            <button onClick={clearFilters} style={{
              background: "none", border: "none", color: "#5a5a8a",
              fontSize: 10, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit",
            }}>Clear all filters</button>
          </div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} onClick={() => onSelectSession(s.id)} style={{
              padding: "13px 16px", marginBottom: 5, background: "#0f0f12",
              borderTop: "1px solid #1a1a1e", borderRight: "1px solid #1a1a1e", borderBottom: "1px solid #1a1a1e",
              borderLeft: s.colorTag ? `3px solid ${s.colorTag}` : "1px solid #1a1a1e",
              borderRadius: 7, cursor: "pointer", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#222230"; if (s.colorTag) e.currentTarget.style.borderLeftColor = s.colorTag; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1e"; if (s.colorTag) e.currentTarget.style.borderLeftColor = s.colorTag; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {(s.hasAudio || s.hasMicAudio || s.hasSystemAudio) && <span style={{ fontSize: 7, color: "#e85d4a77" }}>● REC</span>}
                  <span style={{ fontSize: 12, color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name || s.textPreview || s.id}
                  </span>
                </div>
                <span style={{ fontSize: 10, color: "#2a2a2a", flexShrink: 0 }}>{timeAgo(s.createdAt)}</span>
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#2a2a2a" }}>
                {(s.wordCount ?? 0) > 0 && <span>{(s.wordCount ?? 0).toLocaleString()} words</span>}
                {s.detectionCount > 0 && <span style={{ color: "#e85d4a44" }}>{s.detectionCount} patterns</span>}
                {s.hashtags && s.hashtags.length > 0 && (
                  <span style={{ color: "#5a5a8a" }}>
                    {s.hashtags.map((t) => `#${t}`).join(" ")}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
