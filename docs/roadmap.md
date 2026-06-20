# DevMap — Roadmap

> Phases are sequential. Do not start a phase before the previous one ships.
> Each phase has a clear deliverable — something a real user can run.

---

## Phase 1 — Foundation
**Goal:** Core analysis engine works. No AI yet.

**Tasks:**
- File scanner with ignore list
- Framework detection (Next.js, Express)
- Import/require parser → dependency graph
- Entry point detection from graph topology
- External service detection from imports
- Project map JSON generation
- MD5 file hashing for cache
- `devmap init` — setup wizard
- `devmap doctor` — diagnostics

**Deliverable:** `devmap analyze` outputs accurate project structure
without any AI call. Pure static analysis.

**Why no AI yet:** Validate that the analysis is accurate before
adding AI on top. If the foundation is wrong, AI output will be wrong too.

---

## Phase 2 — AI Integration
**Goal:** Users can understand projects faster with AI interpretation.

**Tasks:**
- Groq integration with provider abstraction layer
- Prompt templates for analyze and ask
- Context Builder — keyword search + file ranking
- [x] Streaming output for human `analyze` and `ask` responses
- Retry logic + model fallback
- Token-aware context trimming (max 5 files, max 200 lines each)
- Cache integration — skip AI for unchanged files
- Stale snapshot detection + user prompt
- All error scenarios handled (no raw stack traces)

**Deliverable:** `devmap analyze` with AI interpretation,
`devmap ask` with context-aware answers, and `devmap onboarding` for a
snapshot-based reading guide when the output is stable enough for `0.1.0`.

---

## Phase 3 — Documentation Generation
**Goal:** DevMap generates useful project documentation automatically.

**Tasks:**
- `devmap docs` — generate structured markdown docs folder
- Expand `devmap onboarding` beyond the MVP guide when richer snapshot fields
  are available

**Deliverable:**
```
docs/
├── project-overview.md
├── architecture.md
├── onboarding.md
└── api.md
```

**Note:** Quality bar here is high. Do not ship until output is
genuinely useful — not just filled with AI hallucinations.

---

## Phase 4 — Advanced Analysis
**Goal:** DevMap goes beyond understanding into actionable insights.

**Tasks:**
- `devmap flow [module]` — narrative flow explanation
- `devmap deadcode` — detect unused files, exports, functions
  (static analysis first, AI for explanation only)
- `devmap report` — project health score with recommendations

**Note for deadcode:** Use static analysis as the detector,
AI only for explaining results. Never rely on AI to detect dead code —
accuracy must be near 100% or developers won't trust it.

---

## Phase 5 — Multi-Provider
**Goal:** Users can choose their preferred AI provider.

**Tasks:**
- OpenAI adapter (GPT-4o mini as default)
- Gemini adapter (1.5 Flash as default)
- Provider selection in `devmap init`
- Per-project provider override in `.devmap/config.json`
- Provider-specific model recommendations

**Order:** OpenAI first (most requested), Gemini second.

---

## Future Ideas
Not planned. Not scheduled. Revisit when Phase 5 ships.

- **Local AI / Ollama** — run DevMap fully offline
- **Hybrid Mode** — local for small files, cloud for complex queries
- **VS Code Extension** — DevMap inside the editor
- **`devmap watch`** — auto-update snapshot on file save
- **`devmap visual`** — SVG/PNG architecture diagram
- **Team features** — shared snapshots, team config
- **Cloud dashboard** — web UI for snapshot history

---

## Version History

| Version | Phase | Description |
|---|---|---|
| 0.1.0 | 2 | Early beta with static analysis, Groq AI, JSON output, and streaming |
| 0.2.0 | 2 | Feedback-driven reliability and analyzer improvements |
| 1.0.0 | 2 | Stable `devmap analyze` + `devmap ask` release |
| 1.1.0 | 2 | Performance improvements, cache optimization |
| 1.2.0 | 2 | Express support solidified |
| 2.0.0 | 3 | `devmap docs` + expanded onboarding |
| 3.0.0 | 4 | `devmap deadcode` + `devmap flow` + `devmap report` |
| 4.0.0 | 5 | OpenAI + Gemini support |
