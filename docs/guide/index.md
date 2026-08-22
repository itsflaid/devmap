# Index — what's in every file

`README.md` is the front door (philosophy, reading order, quick links).
This file is the lookup table: one real paragraph per `.md` file in this
folder, so you can find the right chapter without opening five of them
first.

---

## System chapters (`guide/`)

### `01-pipeline-orchestration.md`
Covers `analyzers/pipeline/projectMap.ts` — the `createProjectMap()`
function every command ultimately calls. Explains why `callAI` is an
optional parameter (and what that implies about static analysis never
depending on AI), walks the full call sequence from `scanFiles` through
flow generation, and covers `createProjectFingerprint()`, the MD5-based
determinism mechanism the rest of the CLI relies on to detect "nothing
changed." Flags that **two separate scoring systems**
(`rankCriticalFiles` vs. `calculateImportance`) both consult the same
authentication semantic-role signal but weight it very differently — read
this before touching either one.

### `02-scanning-and-analysis.md`
Covers `fileScanner.ts`, `filterEngine.ts`, and the `AnalyzerRegistry`
cascade in `analysis/`. Explains why file-scan ordering has to be
deterministic, the four-layer ignore system (hardcoded directories,
hardcoded lockfiles, path patterns, and the project's own `.gitignore`),
and the three-tier analyzer fallback (`TsMorphAnalyzer` →
`HeuristicAnalyzer` → `FallbackAnalyzer`) — including how `.vue`/
`.svelte`/`.astro` files get their embedded script extracted before
`ts-morph` ever sees them. Also introduces `FileRole`, a second,
independent per-file classifier (test/config/api-handler/service/...)
that feature detection leans on heavily later.

### `03-framework-and-route-detection.md`
Covers `frameworkDetector.ts`, `routeDetector.ts`, `nestRouteDetector.ts`,
`databaseDetector.ts`, and `serviceDetector.ts`. Explains the shared
`isArchitectureSource()` gatekeeper (why an `examples/` folder can't
confuse framework detection), the two-phase dependency-first/
file-structure-second detection strategy that can return both a frontend
*and* a backend framework from one monorepo scan, and per-framework route
extraction for all seven supported frameworks — including how Express/
Fastify router mounts get resolved through the dependency graph, and why
NestJS is the one detector built on a real AST instead of regex.

### `04-entity-extraction.md`
Covers `analysis/extractors/` — the Prisma → SQL → route-hint fallback
chain that produces `EntityInfo`/`EntityGraph`. Explains how Prisma
relation *direction* is inferred rather than read directly, why SQL table
names are pulled from AST string literals instead of a quote-pairing
regex (and the stopword/title-case filters needed to avoid false
positives from ordinary UI copy), and the `singularize()` helper shared
with route-hint naming. Flags that per-entity relations and the
top-level entity graph's relations are computed by **two separate
functions**, not one.

### `05-signal-registry.md`
Covers `analyzers/registry/` — the centralized `SignalDescriptor` system
that backs feature signals, external-service detection, *and*
AI-provider detection from one shared list. Explains the `importOnly`
flag (prose mentions shouldn't count, only real imports) and
`minimumDistinctFiles` (single-match evidence is too weak for some
signals), then walks through `FEATURE_SIGNALS`/`SERVICES`/
`SOURCE_SERVICE_SIGNALS` as three derived views over one flat list.
Shortest chapter on purpose — it doubles as a "how to add a new provider
signal" how-to.

### `06-feature-detection-engine.md`
Covers `featureDetector.ts`, the largest and most-referenced file in the
codebase. Walks all four evidence sources feeding `detectFeatures()`
(file-role-based, registry-keyword-based, capability-based,
entity-based), the ownership model that decides whether an entity
becomes its own feature or gets folded into a parent's purpose as a
"true child," file-tiering and entry-point-scoring helpers used by every
evidence source, and the authentication semantic-role subsystem — the
single most cross-referenced piece of logic in the whole guide.

### `07-capability-detection.md`
Covers `capabilityDetector.ts`. Explains the two detection passes (CRUD
grouped by URL resource, and ten hand-tuned behavioral signals like
sharing/collaboration/real-time), and goes deep on the actual design
history behind why confidence thresholds are tuned per-signal — a single
`/search` route used to trigger a false "high confidence" search feature,
and the fix (API-routes-only, per-signal `minimumMatches`) is explained
with the reasoning intact. Flags a second, independent `singularize()`
that quietly diverges from ch. 4's.

### `08-similarity-and-merge.md`
Covers `featureSimilarity.ts`/`featureMerge.ts` — the one engine every
feature-merging decision in the codebase (role-based, signal-based,
capability-based, entity-based, *and* AI-inferred features) routes
through. Explains the four weighted similarity factors (file/term/entity
Jaccard overlap plus trigram name similarity), why "first-seen name wins"
is the merge rule, and the field-by-field merge table (why `purpose`
sometimes gets overwritten and `confidence` never goes down). Also notes
an unused fingerprinting function reserved for a future cross-run
persistence layer.

### `09-dependency-graph-and-flows.md`
Covers `analyzers/graph/` plus the flow-generation half of
`projectMap.ts`. Explains how the file-to-file import graph is built and
resolved, entry-point detection, and the cycle-safe, fan-out-capped
bounded tree walk that `devmap map` renders directly. Also covers the two
flow generators behind `devmap flow` (`generateFeatureFlows`, narrative-
driven; `generateRequestFlows`, graph-BFS-driven) and flags a second,
independently-implemented reverse-dependency helper used only for
change-impact analysis.

### `10-frontend-page-features.md`
Covers `frontendFeatureDetector.ts`. Explains a real bug this module
exists to prevent (a project with even one database table never reaches
the route-hint fallback tier, so pure frontend-only page features would
otherwise never surface), the five regex patterns used to detect
client-side routes across React Router/Vue Router/svelte-spa-router, and
the "ownership" rule — a file only belongs to a feature if *every* file
that imports it is also inside that feature's boundary.

### `11-ai-domain-inference.md`
Covers `analyzers/inference/` — the only pipeline step that touches the
network. The flagship "why AI needs structural grounding" chapter:
explains why entity names alone (`Message`, `Room`) can't distinguish a
chat app from a personal notes app, how `classifyOwnershipTopology()`
supplies the structural evidence that actually can, the prompt's explicit
instruction to trust that evidence over naming, SHA-256 caching for
run-to-run stability, and why every failure degrades to `null` instead of
throwing.

### `12-ai-provider-and-context-builder.md`
Covers `ai/` in full — `GroqClient`/`OpenRouterClient`, prompt templates,
and the ~925-line retrieval engine behind `devmap explain`. Explains
Groq's model-fallback chain and 429/5xx/decommissioned-model handling
(and why OpenRouter's client is deliberately simpler), the bilingual
(English + Indonesian) keyword/stop-word/concept-alias system inside
`contextBuilder.ts`, how detected question intent picks a file/line
budget, and the separate snapshot-enrichment AI pass that rewords
existing fields rather than inferring new ones.

### `13-agent-navigation-output.md`
Covers `cache/agentNavigation.ts` — what actually gets written to
`.devmap/index.json` and `.devmap/features/*.json`, the files DevMap
tells AI coding agents to read first. Explains the `selectIndexCriticalFiles`
scoring formula (entry-point rank, CLI-command bonus, BFS distance-to-
entry decay, flow/feature ownership weight) and flags a same-named-field
collision between two related-but-distinct concepts worth not confusing.

### `14-snapshot-cache-and-config.md`
Covers `cache/fileHash.ts`, `cache/snapshot.ts`, and `utils/config.ts`.
Explains why MD5 (`hashContent`) and SHA-256 (ch. 11's domain-inference
cache) are two deliberately separate hashing mechanisms rather than one
shared utility, snapshot schema versioning and the migration shim that
normalizes older snapshot shapes on read, and the global-vs-project-local
config split — including why `apiKey`/`provider` are silently ignored if
someone puts them in the wrong file.

### `15-onboarding-system.md`
Covers `onboarding/model.ts` + `modelBuilder.ts` — the pure, AI-free
narrative-generation logic behind `devmap onboarding` (the command itself
is documented separately, see below). Explains the four branching
"how it works" story templates matched to project shape, a second
independent safeguard against the same `Message`/`Room` misreading ch. 11
handles at the AI-prompt level — this one applied to the human-facing
narrative instead — and flags this as the **third** independent "what to
read first" ranking in the codebase, alongside ch. 1's and ch. 13's.

---

## Command docs (`guide/commands/`)

### `01-init.md`
Covers `commands/init.ts`. Explains the dependency-injection pattern
every command in the CLI follows, how provider/API-key/model each
resolve through their own priority chain with a non-interactive fallback,
and why an existing `AGENTS.md` is never silently overwritten.

### `02-analyze.md`
Covers `commands/analyze.ts` — the only place `createProjectMap()`
actually gets called and persisted. Explains the fingerprint-based fast
path (and the easy-to-miss detail that agent-navigation files still get
rewritten even on a cache hit), the three separate AI-related caches in
play during a single run, and why a `DevmapError` degrades gracefully
while any other thrown error is allowed to crash the command.

### `03-onboarding.md`
Covers `commands/onboarding.ts` — the Markdown-rendering and CLI layer
sitting on top of ch. 15's model-building logic. Explains language
resolution (explicit flag → interactive prompt → quiet English default),
the six-section Markdown structure, and the hardcoded
`AVAILABLE_COMMANDS` list that has to be updated by hand whenever a new
CLI command ships or it silently vanishes from the guide's footer.

### `04-map.md`
Covers `commands/map.ts` — three genuinely different rendering paths
(file, feature, project) chosen by what the target resolves to. Explains
the deliberately asymmetric "uses" vs. "used by" tree depth, how feature
mode diffs an internal tree walk against the full file set to compute
external dependencies/dependents, and why the Mermaid diagram's edge list
is capped to match the (possibly-truncated) text list exactly.

### `05-flow.md`
Covers `commands/flow.ts`. Explains that `--all` isn't a display filter
on the same data — it triggers a genuinely looser regeneration
(`minConfidence: "medium"`, all route kinds, no limit) — how target
resolution only auto-accepts an unambiguous partial match, and how
per-flow AI narration fails independently per flow rather than aborting
the whole command.

### `06-explain.md`
Covers `commands/explain.ts`. Explains the three-way target resolver
(feature → file → function name, in that order), why `devmap explain`
currently has **no** free-text question path despite `contextBuilder.ts`
clearly being built for one, and why this is the one command with no
static-only fallback — no API key means an immediate, clear error instead
of a degraded result.

### `07-config.md`
Covers `commands/config.ts` — currently just the `config model`
subcommand, and the smallest file in the CLI. Explains the `--local`
branch point (project-only override vs. every project on the machine),
and why setting the model to `"auto"` is a meaningful stored choice, not
the same as leaving it unset.

### `08-doctor.md`
Covers `commands/doctor.ts`. Explains why `doctor` deliberately re-runs
its own fresh file scan and framework detection instead of trusting
whatever's cached in `.devmap/snapshot.json` (so a stale snapshot becomes
detectable rather than silently trusted), the live network check that
confirms a stored API key/model still actually work today, and what
populates the final `issues[]` list.
