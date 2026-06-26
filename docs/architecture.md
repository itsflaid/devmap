# DevMap — Architecture (Revised)

> **Note:** This is a revised architecture aligned with the latest roadmap.

## Architecture Philosophy

```text
80% Static Analysis
20% AI Interpretation
```

Static analysis is the source of truth.
AI interprets structured metadata rather than raw source code.

---

## High-Level Architecture

```mermaid
flowchart TD

    ROOT[Project Root]
    ROOT --> SCAN[File Scanner]
    SCAN --> FILES[ScannedFile Array]

    FILES --> REG[Analyzer Registry]

    REG -->|".vue .svelte .astro"| PRE[Preprocessor Layer]
    PRE -->|VuePreprocessor| TSM
    PRE -->|SveltePreprocessor| TSM
    PRE -->|AstroPreprocessor| TSM

    REG -->|".ts .tsx .js .jsx"| TSM[TsMorphAnalyzer]
    REG -->|".py .php .go .rb"| HEU[HeuristicAnalyzer]
    REG -->|"*"| FALL[FallbackAnalyzer]

    TSM -->|"confidence: high"| ANALYSIS[FileAnalysis Map]
    HEU -->|"confidence: medium"| ANALYSIS
    FALL -->|"confidence: low"| ANALYSIS

    FILES --> FW[Framework Detector]
    FILES --> ROUTES[Route Detector]
    FILES --> DB[Database Detector]
    FILES --> EXT[External Service Detector]
    FILES --> META[Project Metadata]

    ANALYSIS --> DEP[Dependency Graph]
    DEP --> ENTRY[Entry Point Detector]

    FILES -->|"schema.prisma"| ENTITY[Entity Extractor]
    ROUTES -->|"fallback"| ENTITY

    ENTITY --> RELGRAPH[Relationship Graph]

    ROUTES --> CAP[Capability Detector]
    ENTITY --> CAP

    ANALYSIS --> FEAT[Feature Detector]
    ROUTES --> FEAT
    DB --> FEAT
    ENTITY --> FEAT
    RELGRAPH --> FEAT
    CAP --> FEAT

    FEAT --> TECH_FEAT[Technical Features]
    FEAT --> DOMAIN_FEAT[Domain Features]

    TECH_FEAT --> AI_IN[AI Inference Input]
    DOMAIN_FEAT --> AI_IN
    ENTITY --> AI_IN
    CAP --> AI_IN

    AI_IN --> AI[Optional AI Domain Inference]
    AI --> AI_OUT[Domain Result]

    ANALYSIS --> CRIT[Critical File Ranker]
    DEP --> CRIT
    ENTRY --> CRIT

    META --> PMAP[Project Map]
    FW --> PMAP
    ROUTES --> PMAP
    DB --> PMAP
    EXT --> PMAP
    DEP --> PMAP
    ENTRY --> PMAP
    CRIT --> PMAP
    TECH_FEAT --> PMAP
    DOMAIN_FEAT --> PMAP
    AI_OUT --> PMAP

    PMAP --> SNAP[Snapshot Generator]

    SNAP --> DEVMAP[.devmap/]

    DEVMAP --> IDX[index.json]
    DEVMAP --> FMAP[features/*.json]
    DEVMAP --> SHOT[snapshot.json]
```

---

## Generated Structure

```text
.devmap/
├── snapshot.json
├── index.json
├── features/
│   ├── authentication.json
│   └── ...
├── maps/                 (Phase 2)
├── flows/                (Phase 2)
├── onboarding.md         (Phase 2)
└── agent/                (Phase 5)
```

### Current (Phase 1)

- snapshot.json
- index.json
- features/*.json

### Phase 2

- maps/
- flows/
- onboarding.md

### Phase 5

- agent/
- incremental context
- working memory
- smart cache

---

## Architecture Principles

1. Static analysis is always the source of truth.
2. AI never discovers project facts from raw source.
3. Snapshot is immutable until `devmap analyze`.
4. Agent runtime data never overwrites snapshot.
5. Context Builder combines:
   - snapshot
   - feature maps
   - generated docs
   - agent context (future)

---

## Agent Layer (Future)

Agent Layer is planned for Phase 5.

It stores runtime context only:

```text
.devmap/agent/
├── context.json
├── cache.json
├── history.json
└── state.json
```

This directory is intentionally separated from `snapshot.json`.

Snapshot contains project facts.

Agent contains temporary runtime knowledge.

