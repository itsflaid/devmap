# DevMap — Roadmap

> Phases are sequential. Do not start a phase before the previous one ships.
> Each phase has a clear deliverable — something a real user can run.

---

## Phase 1 — Foundation ✅
**Goal:** Core analysis engine works.

**Delivered:**
- File scanner with ignore list
- Normalized analyzer registry with ts-morph for JS/TS and heuristic fallback
- Preprocessor layer for Vue/Svelte/Astro (embedded JS/TS extraction)
- Framework detection (Next.js, Express, React, Vue/Nuxt, Svelte/SvelteKit, Astro)
- Route detection with monorepo prefix support
- Entity extraction from Prisma schema with route fallback
- Relationship graph builder (one-to-one, one-to-many, many-to-many)
- Capability detection (CRUD, Sharing, Collaboration, Discovery, Social, etc.)
- Feature detection pipeline — 5 layers (Technical → Entity → Capability → Assembly → AI)
- Domain inference via AI — structured metadata only, ~300-500 tokens
- Dependency graph and entry point detection
- External service detection
- Project map assembly
- Lightweight agent index and per-feature navigation maps
- `devmap init` — setup wizard
- `devmap analyze` — full analysis pipeline
- `devmap doctor` — diagnostics

**Deliverable:** `devmap analyze` outputs accurate project structure with domain features for fullstack web JS/TS projects.

---

## Phase 2 — Understanding (Current)
**Goal:** Developers can understand any project faster through dedicated navigation commands.

**Commands:**

### ⭐ `devmap onboarding` — HIGH PRIORITY
Polish existing implementation. Current output is too generic.

Core question it answers:
> Where should I start reading this project?

Target output sections:
1. What This Project Does
2. Mental Model
3. Key Concepts
4. Important Areas to Understand
5. Key Flows
6. Where to Start (ordered reading path with explanation)

Rules:
- Derives reading path from snapshot, not generic advice
- Explains why each file should be read, not just lists it
- Works without AI call (snapshot-based)
- `--write` creates `ONBOARDING.md`

---

### ⭐ `devmap map [feature/file?]`
Core question it answers:
> This file/feature — what does it connect to, and how?

```bash
devmap map                    # full project dependency map
devmap map authentication     # map one feature
devmap map src/lib/auth.ts    # map one file
```

Output: text dependency tree + `.devmap/maps/[name].md` + `.devmap/maps/[name].mermaid`

Differentiator from `flow`: map = spatial (who connects to whom), flow = temporal (what happens in order).

---

### ⭐ `devmap explain [file/feature/function]`
Core question it answers:
> What does this file/feature/function do, in detail?

```bash
devmap explain src/lib/auth.ts
devmap explain "authentication feature"
devmap explain createWorkspace
```

Output: prose explanation of what the target does, what imports it, what it imports, why it's critical.

Requires AI — but targeted (one file/feature at a time, not whole codebase).

---

### ⭐ `devmap flow [target?]`
Core question it answers:
> How does this feature work from start to finish?

```bash
devmap flow                   # top 5 most critical flows (curated default)
devmap flow --all             # all detected flows
devmap flow authentication    # specific feature flow
devmap flow /api/snippets     # specific route flow
```

Output per flow:
- `.devmap/flows/[name].md` — narrative step-by-step explanation
- `.devmap/flows/[name].mermaid` — Mermaid diagram

`devmap flow` without target = curated top flows, not a dump. Use `--all` for complete output.

---

### Phase 2 — Generated file structure

```txt
.devmap/
  index.json
  snapshot.json
  features/*.json
  maps/               ← devmap map output
    authentication.md
    authentication.mermaid
    project.md
  flows/              ← devmap flow output
    authentication.md
    authentication.mermaid
  onboarding.md       ← devmap onboarding --write output
```

**Phase 2 Priority order:**
```
1. devmap onboarding (polish)
2. devmap map
3. devmap explain
4. devmap flow
```

**Deliverable:** Developer can clone any fullstack JS/TS project, run DevMap, and understand its structure in under 10 minutes without reading every file.

---

## Phase 2.5 — Ship & Distribute
**Goal:** Real users, real feedback.

Do not skip this. Perfect code with zero users = wasted effort.

**Tasks:**
- npm publish (`devmap` package)
- Landing page live (Astro + Tailwind, already designed)
- README with demo GIF
- Demo video / GIF (single most important distribution asset)
- First 10 real users
- Collect feedback

**Deliverable:** DevMap is publicly installable and discoverable.

---

## Phase 3 — Frontend SPA Support
**Goal:** Expand analysis coverage to pure frontend projects that do not rely on file-based or server-side routing.

> Rationale: Frontend SPA support is still JS/TS — same language, different architectural pattern. It belongs here, before AI provider expansion, because the quality of what DevMap analyzes matters more than how many providers can analyze it. A Vite + React Router app should be a first-class citizen, not a Phase 5 afterthought.

**Tasks:**

- `clientRouteDetector.ts` — React Router, Vue Router, TanStack Router, Svelte routing
- Store extraction
  - Zustand
  - Redux Toolkit
  - Pinia
  - Vuex (legacy)
- Client-side entry point detection
- Client-side feature detection
- Better dependency graph for SPA architectures

**Full support for:**
- React SPA (Vite + React Router)
- Vue SPA (Vite + Vue Router / Pinia)
- Svelte SPA (Vite + Svelte routing)

**Deliverable:** `devmap analyze` produces accurate snapshots for pure frontend SPA projects, with no requirement for Next.js, Nuxt, or SvelteKit.

---

## Phase 4 — AI Experience
**Goal:** Make AI understanding faster, more consistent, and provider-agnostic.

**Tasks:**

### Provider Support
- OpenAI provider
- Gemini provider
- Ollama local provider (offline, no API key)

### AI Experience
- Better Context Builder ranking
- Better prompt templates
- Better streaming UX
- Improved explanation quality
- Improved flow narration
- Provider diagnostics
- Per-project provider override

**Note:** Ollama requires clear warnings about model size, RAM requirements, and download time. Never silently download large models.

**Deliverable:** Developers can use any major AI provider while receiving consistent, high-quality project explanations.

---

## Phase 5 — Agent Layer
**Goal:** DevMap becomes the persistent context layer shared between developers and AI agents.

Static analysis remains the source of truth. Runtime context is stored separately so AI agents can build upon previous understanding without modifying analysis results.

### Runtime Structure

```txt
.devmap/
  snapshot.json
  index.json
  features/

  agent/
    context.json      ← reusable project context
    history.json      ← previous agent interactions
    cache.json        ← reusable runtime cache
    state.json        ← current agent runtime state
```

`snapshot.json` is always generated by `devmap analyze`.

Files inside `.devmap/agent/` are managed independently and are never overwritten by static analysis.

---

### Tasks

#### Persistent Context
- Runtime project context
- Incremental context updates
- Context versioning
- Context merge strategy

#### Runtime Intelligence
- Agent state management
- Context cache
- Smart context refresh
- Staleness detection using file hashes

#### Agent Collaboration
- Knowledge delta specification
- Safe merge algorithm
- Conflict detection
- Runtime history tracking

#### Developer Experience
- VS Code integration
- Smart cache for unchanged files
- Agent diagnostics
- Runtime cleanup utilities

---

### DevMap Responsibilities

- Generate immutable project snapshots
- Store runtime context
- Merge context updates safely
- Detect stale runtime data
- Preserve compatibility between snapshot and runtime context

---

### AI Agent Responsibilities

- Consume DevMap context
- Reuse existing runtime context
- Propose incremental context updates
- Avoid rebuilding project understanding from scratch

---

### Design Principles

- Static analysis remains the source of truth.
- Runtime context never replaces snapshot data.
- Runtime context should always be reproducible or discardable.
- Agents extend understanding instead of redefining it.
- Runtime updates should be incremental whenever possible.

---

### Deliverable

Developers and AI agents share a persistent project context that grows over time.

Instead of rebuilding repository understanding every session, agents reuse existing context, update only what changed, and preserve useful project knowledge across conversations.

---

## Phase 6 — Universal Analyzer
**Goal:** Expand DevMap beyond fullstack JavaScript/TypeScript while preserving the same analysis pipeline and snapshot format.

Phase 6 extends the static analysis engine to additional ecosystems through language-specific analyzers and extractors. Every supported language should produce the same high-level snapshot structure, allowing all DevMap commands to work consistently regardless of the underlying technology.

---

### Phase 6a — Multi-language Support (Community-driven)

Each language adds its own parser, analyzer, and extractor while producing the same normalized DevMap snapshot.

| Language | Framework | Strategy |
|----------|-----------|----------|
| PHP | Laravel | tree-sitter-php |
| Python | Django / FastAPI | tree-sitter-python |
| Java | Spring Boot | tree-sitter-java |
| Go | Gin / Echo | tree-sitter-go |
| Rust | Axum / Actix | tree-sitter-rust |
| Dart | Flutter | tree-sitter-dart |
| C# | ASP.NET Core | tree-sitter-c-sharp |

Tree-sitter provides the parsing layer.

Each ecosystem contributes language-specific implementations such as:

- Analyzer
- Entity Extractor
- Route Detector
- Framework Detector
- Capability Detector (when needed)

All implementations must produce the same normalized snapshot schema.

---

### Community Contributions

Universal Analyzer is designed to be community extensible.

Typical contributions include:

- New framework detectors
- New entity extractors
- New route detectors
- Additional language analyzers
- Database extractors (Drizzle, TypeORM, Mongoose, etc.)
- Benchmark repositories
- Accuracy improvements
- False-positive reduction

---

### Design Principles

- Static analysis remains deterministic.
- AI is never responsible for parsing source code.
- Every analyzer produces the same normalized output schema.
- New languages should integrate without changing existing commands.
- Existing commands (`analyze`, `map`, `flow`, `explain`, `onboarding`) should work automatically once a language is supported.

---

### Deliverable

DevMap analyzes the majority of modern web and application codebases using the same commands, snapshot format, and developer workflow regardless of programming language.

---

## Phase 7 — Platform (Vision)
**Goal:** Team and cloud features. Requires revenue model first.

- Web dashboard for snapshot history and visualization
- Visual Explorer — interactive architecture diagram
- Team Workspace — shared snapshots across team
- CI/CD integration — auto-analyze on push
- Monitoring — track architectural drift over time

**Note:** Do not plan this in detail until Phase 6 ships and revenue model exists.

---

## Version History

| Version | Phase | Description |
|---------|-------|-------------|
| 0.1.0 | 1 | `init` + `analyze` + `onboarding` + `doctor` — first public release |
| 0.2.0 | 2 | `devmap map` |
| 0.3.0 | 2 | `devmap explain` |
| 0.4.0 | 2 | `devmap flow` |
| 1.0.0 | 2 | Stable release — all Phase 2 commands ship and are production-ready |
| 1.1.0 | 3 | Frontend SPA support (React / Vue / Svelte without framework routing) |
| 2.0.0 | 4 | Multi-provider AI (OpenAI + Gemini + Ollama) |
| 3.0.0 | 5 | Agent Layer — persistent context across sessions |
| 4.0.0 | 6 | Universal Analyzer — multi-language support |
| 5.0.0 | 7 | Platform — dashboard + team features |
