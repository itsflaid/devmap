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
│   │   ├── commands/      ← Command handlers (init, analyze, map, flow, explain, onboarding, config, doctor, mcp)
│   │   ├── mcp/           ← MCP server: tools, resources, prompts, snapshot provider, refresher + lock
│   │   ├── onboarding/    ← Onboarding model and builder
│   │   └── utils/         ← Config, errors, output, prompts, markdown renderer
│   ├── test/              ← 48 test files (`*.test.ts`, auto-discovered by `run-tests.ts`) + `mcp-smoke.mjs`, `package-e2e.mjs`
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
| Route detectors | `src/analyzers/detectors/routeDetector.ts` (+ `remix`, `reactRouter`, `tanstack`, `expo`, `hono`, `client`, `solidStart`, `qwik`, `angular`, `elysia`, `koa`, `adonis`, `nest`, `trpc` modules, shared `routeUtils.ts`, `astUtils.ts`, `moduleBindings.ts`) | `detectRoutes()` — per-framework route extraction; newer detectors find their own projects so monorepos get every frontend |
| Analyzer registry | `src/analyzers/pipeline/analyzerRegistry.ts` | `AnalyzerRegistry.analyze` — first-supports-wins |
| Feature detector | `src/analyzers/features/featureDetector.ts` | 4-source feature merge via similarity engine |
| Feature similarity | `src/analyzers/features/featureSimilarity.ts` | Weighted Jaccard/trigram scoring (threshold 0.35) |
| Domain inference | `src/analyzers/inference/domainInference.ts` | AI call — structured metadata only |
| Snapshot enrichment | `src/ai/snapshotEnrichment.ts` | AI call — file purposes + feature terms |
| Agent navigation | `src/cache/agentNavigation.ts` | `writeAgentNavigationFiles()` — index.json + features/*.json |
| MCP server | `src/mcp/server.ts` | `createDevmapServer()` — tools (`devmap_overview/map/flow/routes/impact/find/analyze`, `devmap_explain` only with `--allow-ai`), resources, prompts |
| MCP queries | `src/mcp/queries.ts` | Pure read-only queries over a `ProjectMap` (overview, routes, impact, find) |
| MCP snapshot provider | `src/mcp/snapshotProvider.ts` | mtime-cached snapshot, TTL-cached staleness, opt-in auto-refresh |
| MCP refresher | `src/mcp/refresh.ts` | Single-flight analysis + `.devmap/analyze.lock` |

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

**Focus: the JS/TS ecosystem first.** Depth of analysis for TypeScript/JavaScript projects (Next, Nuxt, SvelteKit, Astro, Remix, React Router v7, TanStack Router/Start, Expo Router, SolidStart, Qwik City, Angular, Express, Fastify, Hono, Elysia, Koa, AdonisJS, Nest, tRPC, monorepos) comes before breadth. Other languages stay at the level below until JS/TS is mature.

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
- **Entry points** (`entryPoints.ts`): package.json `bin` > published/root `main` (only if no source file imports it) > file conventions (Next `page|layout|route`, SvelteKit `+page|+server`, Nuxt `app.vue`/`pages/`/`server/api`, Remix/React Router `root`/`entry.*`/`app/routes.ts`/`app/routes/**`, TanStack `routes/__root`/`src/router`, Expo `_layout`, SolidStart/Qwik `entry-*`/`root.tsx`, Angular `app.config|routes|module`, Adonis `start/routes|kernel`) > scripts targets (`tsx src/x.ts`). Config files are never entries; private workspace package roots are not entries; generated files (`*.gen.ts`, `*.generated.ts`) are neither entries nor importers.
- Bundler query suffixes (`./x.ts?raw`) are stripped before resolution.

## Testing

48 test files in `packages/cli/test/`. Key covered areas:
- Analyzers, AI clients, agent navigation, entity extractors
- Dependency graph: aliases, workspace packages, `#imports`, Nuxt auto-imports/aliases, entry points (`graph-resolution`, `dependency-graph-alias`, `js-ts-ecosystem`, `js-ts-frameworks`)
- Feature similarity/merge, frontend features, framework routes (`framework-routes`; Remix/React Router/TanStack/Expo/Hono and bundler aliases in `js-ts-frameworks`; client-side routers, Hono factories, Next normalization and critical-file ranking in `js-ts-gaps`; SolidStart, Qwik City, Angular, Elysia, Koa, AdonisJS and constant-resolved paths in `js-ts-more-frameworks`), detector fixes
- Heuristic language readers (`heuristic-languages`), scanner robustness, project scope/metadata
- Commands (init, analyze, map, flow, explain, onboarding, config, doctor)
- MCP server (`core-api`, `mcp-server`, `mcp-freshness`, `mcp-explain`): tools, resources, prompts, stale/missing snapshots, auto-refresh and lock, offline-never-touches-AI, stdio process with a clean protocol stream. `test/mcp-smoke.mjs` runs the compiled `dist/` as a server (CI and publish workflow)
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

MCP server (after `pnpm build:cli`): `node packages/cli/test/mcp-smoke.mjs`.

## Important Constraints

- No source files should be modified during reverse-engineering tasks
- AI errors are always non-fatal — `devmap analyze` completes even if AI fails
- Domain inference is cached for idempotency (`.devmap/domain-cache.json`)
- Snapshot is regenerated on every `devmap analyze` run
- `AGENTS.md` is never overwritten by init (append-only)
- `.devmap/` is always gitignored
- `devmap mcp` owns stdout: it is the JSON-RPC stream. Never `console.log` from code the MCP server can reach; use `output.*` inside `withJsonOutput()` (silent) or stderr
- The MCP server is read-only and static by default. Only `devmap_analyze` / `--auto-refresh` write, and only inside `.devmap/`. AI is reachable only with `--allow-ai`; `devmap_explain` is registered only then

## Known Limitations

- In-memory graph, rebuilt fully on every analyze run — no incremental analysis
- Regex-based heuristic analyzer is explicitly TODO'd toward tree-sitter
- No AST-level analysis for non-JS/TS languages; Go/Java/C#/PHP-namespace imports produce no graph edges yet
- Nuxt auto-import detection is name-based (no type information) and ignores layers and custom `imports.dirs`
- Bundler-config aliases are folded statically: values that depend on env vars, plugins or custom helpers are skipped, and Jest `moduleNameMapper` / Parcel aliases are not read
- Client router detection reads literal route arrays, JSX trees and `getParentRoute` chains; routes assembled by loops, spreads of computed values or runtime config are not followed
- Elysia, Koa and Adonis detectors follow literal call chains and mounts; routers built inside factory functions, `.use()` of computed values and runtime-assembled paths are not followed. Angular reads literal `Routes` arrays and `loadChildren` imports
- Feature similarity threshold (0.35) is tuned but may cause false merges
- Domain inference is single-shot — no conversation context
- `.devmap/analyze.lock` is taken by MCP-driven analysis only; `devmap analyze` does not take or check it
- The MCP staleness check re-scans project files (cached for 10 s), so it is not free on very large repositories

## Engineering Notes

- All commands take a Dependencies object for testability
- `runSafely` wrapper handles errors and sets process.exitCode
- `AsyncLocalStorage` used for output mode (human/json)
- `runMap`, `runFlow`, `runAnalyze` and `runExplain` are exported and shared by the CLI and the MCP server; options `write:false`, `narrate:false`, `offline:true` and `loaded` make them safe for a long-lived process
- MCP tests copy a fixture to a temp dir and analyze it there; analyzing in place and saving the snapshot elsewhere changes the fingerprint and every result reports `stale: true`
- p-limit(50) concurrency for file scanning
- MD5 content hashing for fingerprinting
- `.js` → `.ts` extension swap in import resolution (shared in `graph/localPaths.ts`)
- Database detection ranks ORM/BaaS above drivers; a cache (Redis) is only ever listed as `additional`
- Singularize entity names for feature matching
- REASON_TAGS constant for critical file ranking reasoning
- Critical-file execution bonus (`projectMap.ts`) is name-based (router, controller, orchestrator, engine, dispatcher, scheduler, pipeline, registry, kernel, `commands/`) or fan-out-based (≥ 8 distinct local imports in a non-index file) — never tied to devmap's own file names
- Angular, Elysia, Koa and Adonis detectors share `moduleBindings.ts` (`createModuleIndex`): imports/`require`, exports and re-exports, and `stringOf` (literals, templates, `+`, constants, `as const` objects and enums across files). Instances (Elysia/Koa) are keyed by `new` expression and only unmounted ones are walked from the top, like Hono
- Feature merging (`featureCandidates.ts`): two page candidates never merge by shared file, a page never merges with a vocabulary signal unless they share the exact name, a `standalone` candidate (Home) is never merged, and a bridge candidate cannot fuse two different pages or entities. Weak signal words live in `genericTerms`; package-only words in `importTerms`; `excludePaths` removes false paths per signal
- `nonResourceSegments.ts` lists operational URL segments (health, revalidate, robots.txt, login ...) that never become resources or "Management" features
- Client-side routes (`clientRouteDetector.ts`) are self-gated by router imports/types and run for every project, like the other self-gating detectors; Hono factory functions are modeled as one app per call
