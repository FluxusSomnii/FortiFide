# REASONING.md — Forti Fide

Living ledger of open questions, deferred decisions, and active research directions.

States: CONFIRMED / HELD / TRYING

---

## HELD — Typesense for Session Archive Search and Pattern Library

**Date:** 2026-04-14

**Context:** Typesense is a single-binary local search engine with vector search, hybrid search, and sub-50ms retrieval. No runtime dependencies. Runs locally without data leaving the device.

**What it would give Forti Fide:**

*Session archive search:* After months of sessions, finding specific annotation moments — "high-confidence false urgency patterns from last month", "sessions where fear register exceeded 80%", "this specific phrase I heard three weeks ago" — is currently not possible without scrolling. Typesense indexes all transcript text and pattern annotations. Natural language search converts free-form queries into structured filters over the annotation database without SQL.

*Pattern library search:* The open pattern library indexed in Typesense with fuzzy search and semantic similarity. Contributors can check whether a pattern already exists before proposing a new one. Near-duplicate pattern proposals surfaced automatically.

**Why HELD not CONFIRMED:**

The session archive search and pattern library features are not yet built. Current build phase is closing known bugs (B3, B7) and stabilising the existing pipeline. Adding Typesense before the features that depend on it exist would be premature infrastructure.

**Trigger to resolve:** When the stored analyses feature and session archive search are being designed for implementation. Typesense is the right backing store at that point — add it then rather than now.

**Not needed for:** The Data tab charts (Recharts handles those), the live annotation pipeline (SQLite is sufficient), or existing session storage.

**RAM note:** Typesense stores full index in RAM. Forti Fide already runs Whisper and pyannote as background processes. Combined RAM pressure across all three instruments when running simultaneously needs measurement before shipping.

**Connected decisions:**
- Data tab rebuild (pending) — Recharts not Typesense
- Session archive feature (not yet scoped) — Typesense is the right tool when this is built
- Pattern library (community governance phase) — Typesense for contributor search UX
