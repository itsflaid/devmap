# CLAUDE.md — DevMap Agent Guide

## Project Overview

DevMap is a CLI tool that reverse-engineers software projects to help developers and AI agents understand unfamiliar codebases. It scans files, analyzes structure, detects features, and generates `.devmap/` navigation artifacts — all powered by static analysis with optional AI enhancement.

- **npm package**: `@flaid/devmap`
- **Language**: TypeScript 6, Node >=22.12, ESM
- **Monorepo**: pnpm workspaces

## Repository Structure

```
devmap/
├── packages/cli/          ← @flaid/devmap npm package
│   ├── src/
│   │   ├── index.ts       ← CLI entry (commander)
│   │   ├── analyzers/     ← Analysis pipeline
│   │   │   ├── analysis/  ← File scanning, TS-morph/heuristic analyzers
│   │   │   ├── graph/     ← Dependency graph, entry points, source scope
│   │   │   ├── detectors/ ← Framework, routes, database, services, capabilities
│   │   │   ├── features/  ← Feature detection, merge, similarity
│   │   │   ├── inference/ ← Domain inference (AI), ownership topology
│   │   │   ├── pipeline/  ← Orchestrator (projectMap.ts), analyzer registry, metadata
│   │   │   └── registry/  ← Feature signal vocabulary (18 files)
│   │   ├── ai/            ← Provider abstraction (Groq, OpenRouter, Custom)
│   │   ├── cache/         ← Snapshot, file hash, agent navigation files
│   │   ├── commands/      ← Command handlers (init, analyze, map, flow, explain, onboarding, config, doctor)
│   │   ├── onboarding/    ← Onboarding model and builder
│   │   └── utils/         ← Config, errors, output, prompts, markdown renderer
│   ├── test/              ← 30 test files
│   └── package.json
├── apps/web/              ← Astro marketing site (unrelated to CLI)
├── docs/                  ← Public documentation
├── guide/                 ← User guides
└── .agents/skills/        ← ECC skills
```

## Architecture Summary

**80% static analysis, 20% AI interpretation.** AI is an enhancement layer, not the foundation.

### Pipeline Flow

```
scanFiles → analyzeFiles → buildDependencyGraph → detectFramework
→ detectRoutes → detectDatabase → extractEntities → detectCapabilities
→ detectFeatures → inferDomain(optional) → rankCriticalFiles
→ generateMinimalFlows → save snapshot + agent navigation files
```

### AI vs Deterministic Separation

AI has exactly 3 call sites — all optional, all non-fatal:

1. **Domain inference** during map creation (structured metadata only, ~300-500 tokens)
2. **Snapshot enrichment** (file purposes + feature terms, batched)
3. **Q&A text generation** (analyze interpretation, flow narration, explain command)

Everything else (files, graph, routes, features, flows, critical files) is 100% deterministic.

## Core Components

| Component | File | Purpose |
|---|---|---|
| CLI entry | `src/index.ts` | Commander program, command dispatch |
| Pipeline orchestrator | `src/analyzers/pipeline/projectMap.ts` | `createProjectMap()` — core 15-step pipeline |
| Analyzer registry | `src/analyzers/pipeline/analyzerRegistry.ts` | `AnalyzerRegistry.analyze` — first-supports-wins |
| Feature detector | `src/analyzers/features/featureDetector.ts` | 4-source feature merge via similarity engine |
| Feature similarity | `src/analyzers/features/featureSimilarity.ts` | Weighted Jaccard/trigram scoring (threshold 0.35) |
| Domain inference | `src/analyzers/inference/domainInference.ts` | AI call — structured metadata only |
| Snapshot enrichment | `src/ai/snapshotEnrichment.ts` | AI call — file purposes + feature terms |
| Agent navigation | `src/cache/agentNavigation.ts` | `writeAgentNavigationFiles()` — index.json + features/*.json |

## Data Model

### ProjectMap (snapshot.json)

```
version, generatedAt, fingerprint, projectRoot, framework,
project(ProjectMetadata), stats, entryPoints, criticalFiles,
routes, apiRoutes, externalServices, database?,
features, entityGraph?, capabilities?, domain?,
flows, onboarding, changeImpact, warnings?,
dependencies, fileGraph(imports), ai?, fileIndex
```

### FileIndexEntry

Per-file metadata: analyzer, analysisConfidence, hash, imports, exportedSymbols, symbols, topFunctions, lines, purpose?, scope (api|ui|database|config|service|cli|test|docs|unknown), featureRefs, searchTerms, importance.

### FeatureInfo

```
name, purpose, files, entryPoint?, entryPoints,
businessFlow, searchTerms, confidence(high|medium|low), evidence
```

## Languages Supported

**Native (ts-morph, high confidence)**: .ts, .tsx, .js, .jsx

**Preprocessed → ts-morph (high confidence)**: .vue (VuePreprocessor), .svelte (SveltePreprocessor), .astro (AstroPreprocessor)

**Heuristic (medium confidence)**: .py, .php, .go, .rb, .cs, .cjs, .cts, .mjs, .mts

**Fallback (low confidence)**: everything else

## Testing

30 test files in `packages/cli/test/`. Key covered areas:
- Analyzers, AI clients, agent navigation, entity extractors
- Feature similarity/merge, frontend features, framework routes
- Commands (init, analyze, map, flow, explain, onboarding, config, doctor)
- Utils (markdown terminal, JSON output, prompts, errors)

**Untested**: domain inference, ownership topology, cache layer internals, pipeline orchestrator, capability detector, service detector, filter engine, dependency graph builder, entry points detector.

## Development Commands

```bash
# Install
pnpm install

# Build
cd packages/cli && pnpm build

# Test
cd packages/cli && pnpm test

# Lint
pnpm lint

# Typecheck
pnpm typecheck

# Dev mode
pnpm dev

# Run CLI locally
pnpm devmap <command>
```

## Important Constraints

- No source files should be modified during reverse-engineering tasks
- AI errors are always non-fatal — `devmap analyze` completes even if AI fails
- Domain inference is cached for idempotency (`.devmap/domain-cache.json`)
- Snapshot is regenerated on every `devmap analyze` run
- `AGENTS.md` is never overwritten by init (append-only)
- `.devmap/` is always gitignored

## Known Limitations

- In-memory graph, rebuilt fully on every analyze run — no incremental analysis
- Regex-based heuristic analyzer is explicitly TODO'd toward tree-sitter
- No AST-level analysis for non-JS/TS languages
- Feature similarity threshold (0.35) is tuned but may cause false merges
- Domain inference is single-shot — no conversation context

## Engineering Notes

- All commands take a Dependencies object for testability
- `runSafely` wrapper handles errors and sets process.exitCode
- `AsyncLocalStorage` used for output mode (human/json)
- p-limit(50) concurrency for file scanning
- MD5 content hashing for fingerprinting
- `.js` → `.ts` extension swap in import resolution
- Singularize entity names for feature matching
- REASON_TAGS constant for critical file ranking reasoning
