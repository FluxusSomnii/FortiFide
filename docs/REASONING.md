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

---

## HELD — AAAK Compression Format

Investigate MemPalace's AAAK lossless compression format before building any AI context management features in Forti Fide.

**Context:** Forti Fide's session archive accumulates annotation data, transcripts, and pattern records over time. When AI-assisted features are added (pattern library search, session analysis, report generation), context management will determine what the model receives and at what cost. AAAK is a lossless compression format developed in the MemPalace project that may compress this context more efficiently than general-purpose approaches.

**Why HELD:** No AI context management features are currently in build scope. The session archive and pattern library features that would require context management are not yet scoped. Investigating AAAK before those features are designed would be premature.

**Trigger to resolve:** When AI context management for session archive or pattern library features is being designed. Evaluate AAAK alongside standard compression approaches at that point.

**Connected decisions:**
- Session archive feature (not yet scoped) — primary context management use case
- Hices AAAK entry (HELD) — cross-ecosystem: all instruments evaluate this before building context management

---

## HELD — AirLLM for Deep Mode Local Fallback

**Date:** 2026-04-15

Investigate AirLLM as the inference framework for Forti Fide's Deep mode when operating without API connectivity.

**Context:** AirLLM (github.com/geronimi73/AirLLM) runs large language models on consumer hardware by loading layers sequentially rather than holding the full model in RAM. Forti Fide's Deep mode provides richer rhetorical pattern analysis than the standard pipeline. Currently Deep mode requires API access. AirLLM could enable a local fallback for Deep mode that operates without sending audio data to any external service.

**What it would give Forti Fide:**
- Full Deep mode capability in offline environments or when the user has chosen Tier 0 for all data
- No dependency on API availability for the highest-quality analysis mode
- Consistent privacy guarantee: nothing leaves the device regardless of mode

**Why HELD:** Deep mode local fallback is not in current build scope. The current build phase is closing known bugs (B3, B7) and stabilising the existing pipeline. Adding local inference infrastructure before the pipeline is stable would create unnecessary complexity.

**Trigger to resolve:** When Deep mode local fallback is being scoped for implementation. Benchmark AirLLM against the required model size and target hardware at that point.

**RAM note:** AirLLM trades RAM for latency. Combined RAM pressure from Whisper, pyannote, and an AirLLM model needs measurement before shipping. The HELD entry in Hices for AirLLM carries the same RAM concern — shared constraint across both instruments when running simultaneously.

**Connected decisions:**
- Deep mode pipeline (existing) — the feature this would augment
- Hices AirLLM entry (HELD) — cross-ecosystem: both instruments evaluate AirLLM before local inference build begins
- RAM pressure across instruments — Typesense, Whisper, pyannote, and AirLLM cannot all be active simultaneously without measurement
