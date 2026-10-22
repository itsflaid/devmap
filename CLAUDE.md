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
│   │   │   ├── graph/     ← Dependency graph, alias/workspace/package.json resolution, Nuxt auto-imports, entry points, source scope
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
│   ├── test/              ← 41 test files (`*.test.ts`, auto-discovered by `run-tests.ts`)
│   └── package.json
├── apps/web/              ← Astro marketing site (unrelated to CLI)
├── docs/                  ← Public documentation
│   └── guide/             ← User guides
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
| Route detectors | `src/analyzers/detectors/routeDetector.ts` (+ `remix`, `reactRouter`, `tanstack`, `expo`, `hono`, `client`, `nest`, `trpc` modules, shared `routeUtils.ts`) | `detectRoutes()` — per-framework route extraction; newer detectors find their own projects so monorepos get every frontend |
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

**Focus: the JS/TS ecosystem first.** Depth of analysis for TypeScript/JavaScript projects (Next, Nuxt, SvelteKit, Astro, Remix, React Router v7, TanStack Router/Start, Expo Router, Express, Fastify, Hono, Nest, tRPC, monorepos) comes before breadth. Other languages stay at the level below until JS/TS is mature.

**Native (ts-morph, high confidence)**: .ts, .tsx, .js, .jsx — ESM and CommonJS (`module.exports`, `exports.x`) exports are both read

**Preprocessed → ts-morph (high confidence)**: .vue (VuePreprocessor), .svelte (SveltePreprocessor), .astro (AstroPreprocessor)

**Heuristic (medium confidence)**: .cjs, .cts, .mjs, .mts (JS readers); .py, .rb, .php, .go, .cs, .java (per-language readers in `languageReaders.ts`)

**Fallback (low confidence)**: everything else

Dependency-graph edges exist for JS/TS-family files, Python modules and relative `require`/`include` in Ruby/PHP. Go, Java, C# and PHP namespace/PSR-4 imports are read but not yet resolved to edges (deliberately deferred).

### JS/TS import resolution (`analyzers/graph/`)

Order for a non-relative specifier: `#subpath` (package.json `imports`) → tsconfig/jsconfig aliases and framework aliases (`aliasResolver.ts`) → workspace package by name (`packageManifests.ts`) → skipped as an npm package.

- **Aliases**: JSONC tsconfig, `extends`, `references`, `baseUrl`; configs are discovered at the root, in `apps|packages|libs|services/*` and in any root-level folder (`frontend/`, `client/`) and apply only below their own directory. SvelteKit `$lib`; Nuxt `~`, `@`, `~~`, `@@`, `#shared`, `#server` are rebuilt because `.nuxt/tsconfig` is not checked in.
- **Bundler-config aliases** (`bundlerAliases.ts`): `resolve.alias` (Vite/Vitest/webpack/Rollup, Astro under `vite`), `kit.alias` (svelte.config), `alias` (nuxt.config) and `config.resolve.alias[...] =` (next.config webpack hook) are read from the syntax tree, never executed. Object and `[{ find, replacement }]` forms; values are folded from `path.resolve/join(__dirname, ...)`, `fileURLToPath(new URL(..., import.meta.url))`, template strings, `+` and top-level constants. Unknown values (env vars, unknown helpers) are skipped. Mappings are `optional` and come after tsconfig's, so tsconfig wins.
- **Workspace packages**: `@scope/pkg` and `@scope/pkg/sub` resolve through the member's `exports` (conditions, `*` patterns), then `source`/`module`/`main`/`types`, then the file layout. Build output (`dist/index.mjs`, `dist/types/index.d.ts`, `lib/index.js`) is mapped back to `src/`.
- **Nuxt auto-imports** (`nuxtAutoImports.ts`): components (by Nuxt naming rules), `composables/`, `utils/`, `shared/`, `server/utils/` and Pinia `stores/` become edges for the files that use them. camelCase helpers must be *called* to link; `use*`/PascalCase names link on any reference.
- **Entry points** (`entryPoints.ts`): package.json `bin` > published/root `main` (only if no source file imports it) > file conventions (Next `page|layout|route`, SvelteKit `+page|+server`, Nuxt `app.vue`/`pages/`/`server/api`, Remix/React Router `root`/`entry.*`/`app/routes.ts`/`app/routes/**`, TanStack `routes/__root`/`src/router`, Expo `_layout`) > scripts targets (`tsx src/x.ts`). Config files are never entries; private workspace package roots are not entries; generated files (`*.gen.ts`, `*.generated.ts`) are neither entries nor importers.
- Bundler query suffixes (`./x.ts?raw`) are stripped before resolution.

## Testing

41 test files in `packages/cli/test/`. Key covered areas:
- Analyzers, AI clients, agent navigation, entity extractors
- Dependency graph: aliases, workspace packages, `#imports`, Nuxt auto-imports/aliases, entry points (`graph-resolution`, `dependency-graph-alias`, `js-ts-ecosystem`, `js-ts-frameworks`)
- Feature similarity/merge, frontend features, framework routes (`framework-routes`; Remix/React Router/TanStack/Expo/Hono and bundler aliases in `js-ts-frameworks`; client-side routers, Hono factories, Next normalization and critical-file ranking in `js-ts-gaps`), detector fixes
- Heuristic language readers (`heuristic-languages`), scanner robustness, project scope/metadata
- Commands (init, analyze, map, flow, explain, onboarding, config, doctor)
- Utils (markdown terminal, JSON output, prompts, errors)

**No dedicated unit tests**: capability detector (exercised through feature/onboarding tests), cache layer internals. Domain inference is covered by `analyze-ai`; the pipeline orchestrator, service detector, filter engine, dependency graph builder and entry point detector are covered by `analyzers`, `graph-resolution` and `js-ts-ecosystem`.

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
- No AST-level analysis for non-JS/TS languages; Go/Java/C#/PHP-namespace imports produce no graph edges yet
- Nuxt auto-import detection is name-based (no type information) and ignores layers and custom `imports.dirs`
- Bundler-config aliases are folded statically: values that depend on env vars, plugins or custom helpers are skipped, and Jest `moduleNameMapper` / Parcel aliases are not read
- Client router detection reads literal route arrays, JSX trees and `getParentRoute` chains; routes assembled by loops, spreads of computed values or runtime config are not followed
- Feature similarity threshold (0.35) is tuned but may cause false merges
- Domain inference is single-shot — no conversation context

## Engineering Notes

- All commands take a Dependencies object for testability
- `runSafely` wrapper handles errors and sets process.exitCode
- `AsyncLocalStorage` used for output mode (human/json)
- p-limit(50) concurrency for file scanning
- MD5 content hashing for fingerprinting
- `.js` → `.ts` extension swap in import resolution (shared in `graph/localPaths.ts`)
- Database detection ranks ORM/BaaS above drivers; a cache (Redis) is only ever listed as `additional`
- Singularize entity names for feature matching
- REASON_TAGS constant for critical file ranking reasoning
- Critical-file execution bonus (`projectMap.ts`) is name-based (router, controller, orchestrator, engine, dispatcher, scheduler, pipeline, registry, kernel, `commands/`) or fan-out-based (≥ 8 distinct local imports in a non-index file) — never tied to devmap's own file names
- Client-side routes (`clientRouteDetector.ts`) are self-gated by router imports/types and run for every project, like the other self-gating detectors; Hono factory functions are modeled as one app per call
