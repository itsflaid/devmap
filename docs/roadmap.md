# DevMap — Roadmap

> Phases are sequential. Each phase must ship before the next one begins.
> Every phase should deliver something a real developer can immediately use.

---

# Phase 1 — Foundation

**Goal:** Build a reliable static analysis engine that understands modern web projects without relying on AI.

## Tasks

### Core Analysis
- File scanner with configurable ignore rules
- MD5 file hashing for incremental cache
- Analyzer registry
- `ts-morph` analyzer for JavaScript/TypeScript
- Heuristic fallback analyzer for unsupported files
- Framework detection (Next.js, Express, etc.)
- Import/require parser
- Dependency graph generation
- Entry point detection using graph topology
- External service detection
- Capability detection
- Entity extraction
- Domain inference
- Feature detection
- Project map JSON generation

### Navigation
- Lightweight project index
- Per-feature navigation maps

### CLI
- `devmap init`
- `devmap analyze`
- `devmap doctor`

## Deliverable

A developer can run:

```bash
devmap analyze
```

and receive an accurate understanding of the project structure through pure static analysis without any AI.

---

# Phase 2 — Codebase Understanding

**Goal:** Help developers understand unfamiliar codebases within minutes.

This phase builds entirely on the analysis snapshot produced in Phase 1.

## Tasks

### `devmap onboarding`
Generate a high-quality project reading guide.

Focus:
- Project overview
- Suggested reading order
- Architecture summary
- Feature overview
- Important entry points

---

### `devmap map`

Generate project relationship maps.

Support:

- Entire project
- Individual feature
- Individual file

Outputs:

- Markdown
- Mermaid diagram

---

### `devmap explain`

Explain code using the existing analysis snapshot.

Support:

- File
- Function
- Feature
- Module

Explain should consume existing DevMap context instead of rebuilding project understanding.

---

### `devmap flow`

Generate execution flow documentation.

Support:

- Authentication flow
- API flow
- Request lifecycle
- Feature flow

Outputs:

- Markdown narrative
- Mermaid diagrams

---

## Deliverable

Developers can explore an unfamiliar repository using:

```bash
devmap onboarding

devmap map

devmap explain authentication

devmap flow authentication
```

without manually reading hundreds of files.

---

# Phase 3 — AI Experience

**Goal:** Make AI-assisted understanding reliable, fast, and provider-independent.

This phase improves the AI experience rather than introducing AI itself.

## Tasks

### Providers

Add additional providers beyond the MVP.

- Claude
- Gemini
- Ollama
- Custom OpenAI-compatible providers

---

### AI Experience

- Better prompt templates
- Context Builder improvements
- Keyword ranking
- Context compression
- Token-aware trimming
- Provider fallback
- Retry logic
- Streaming improvements
- Better error handling
- AI cache optimization
- Stale snapshot detection

---

## Deliverable

Developers can choose any supported provider while receiving consistent DevMap outputs with minimal prompt engineering.

---

# Phase 4 — Universal Codebase Support

**Goal:** Expand DevMap beyond modern web applications.

Support will be added gradually based on demand and implementation maturity.

Potential targets include:

- Spring
- Laravel
- Django
- FastAPI
- Flutter
- Electron
- Go
- Rust
- .NET

The implementation order is intentionally flexible.

---

## Deliverable

DevMap understands multiple ecosystems using language-specific analyzers while preserving a consistent user experience.

---

# Phase 5 — Agent Layer

**Goal:** Transform DevMap from a snapshot generator into a continuously maintained codebase understanding layer.

## Tasks

### Incremental Understanding

- Incremental snapshot updates
- Working context
- Smart cache
- Context Builder
- Context synchronization

---

### Background Intelligence

- File change tracking
- Feature impact detection
- Incremental analysis
- Context invalidation

---

### Developer Experience

- IDE integration
- Reusable context
- Faster AI context generation

---

## Deliverable

DevMap maintains project understanding over time instead of rebuilding context from scratch after every change.

---

# Beyond the Roadmap

The following ideas represent the long-term vision for DevMap.

They are **not scheduled**, **not guaranteed**, and may evolve based on community feedback and real-world usage.

Potential directions include:

- DevMap Dashboard
- Visual Explorer
- VS Code Extension
- JetBrains Plugin
- Team Workspace
- Shared Snapshots
- Cloud Snapshot History
- Architecture Timeline
- CI/CD Integration
- DevMap Cloud

The priority remains building the best possible CLI before expanding into additional products.

---

# Version History

| Version | Milestone | Description |
|----------|-----------|-------------|
| 0.1.0 | Foundation | Initial public release with static analysis, Groq/OpenRouter support, project snapshot, and onboarding |
| 0.2.0 | Understanding | `devmap map`, improved onboarding, and overall analyzer reliability |
| 0.3.0 | Understanding | `devmap explain` and `devmap flow` |
| 1.0.0 | Stable | Mature web codebase understanding experience |
| 2.x | AI Experience | Expanded provider support and improved AI reasoning |
| 3.x | Universal | Multi-language and multi-framework support |
| 4.x | Agent Layer | Incremental understanding and reusable project context |
