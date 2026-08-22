# 1. Pipeline Orchestration

**Source:** `packages/cli/src/analyzers/pipeline/projectMap.ts`

Everything else in this guide is a subsystem that `createProjectMap()` calls
in a specific order. This chapter is the spine; later chapters zoom into
each vertebra.

## The function signature is the architecture

```ts
export async function createProjectMap(
  projectRoot: string,
  callAI?: (prompt: string) => Promise<string>
): Promise<ProjectMap>
```

`callAI` is optional, and that single detail explains a lot about how the
rest of the codebase is shaped:

- `createProjectMap` itself never imports Groq, OpenRouter, or any provider
  SDK. It only knows about `(prompt: string) => Promise<string>`.
- The caller (`commands/analyze.ts`) is responsible for building that
  wrapper — resolving config, creating the right client, wiring in
  fallback models — and decides whether to pass it at all.
- If `callAI` is omitted (no API key configured), the pipeline still
  produces a **complete** `ProjectMap`. AI domain inference is the only
  step that's skipped; static analysis never depends on it.

This is the pattern behind the guide's recurring theme: static analysis is
the foundation, AI is an optional enrichment pass injected from the outside.

## The call sequence

Reading top to bottom, `createProjectMap` runs roughly in this order
(see the source for exact line numbers — this is the dependency order, not
literal code order):

```
scanFiles(projectRoot)
  → analyzeFiles(files)                    // ch. 2 — TsMorph/Heuristic/Fallback cascade
  → buildDependencyGraph(files, analyses)  // ch. 9
  → countReferences(graph)
  → detectFramework(files) + detectFrameworks(files)   // ch. 3
  → detectProjectMetadata(...)
  → detectEntryPoints(graph)               // ch. 9
  → detectRoutes(files, frameworks, graph) // ch. 3
  → detectDatabase(files)                  // ch. 3

  Step 1: extractEntities(files, routes)                       // ch. 4
  Step 2: detectCapabilities(routes, entityGraph)               // ch. 7
  Step 3: detectFeatures(...) + attachFeatureEntryPoints(...)   // ch. 6
  Step 4: inferDomain(...) if callAI provided, then merge        // ch. 11

  rankCriticalFiles(...)
  → per-file: createFileIndexEntry(...)
  → generateMinimalFlows(...)              // ch. 9

  assemble and return ProjectMap
```

The four numbered steps are called out explicitly in code comments because
they have a real data dependency chain: capabilities need the entity graph,
features need both entities *and* capabilities, and domain inference needs
the fully-formed feature list. You can't reorder them.

### Step 4 in more detail — the only step that touches the network

```ts
if (callAI) {
  const inferenceInput = buildDomainInferenceInput(
    entityGraph, capabilities, features, framework, routes.length
  );
  const result = await inferDomain(inferenceInput, callAI, projectRoot);
  if (result) {
    domain = result;
    const domainFeatures = domainFeaturesToFeatureInfo(result.domainFeatures);
    mergeDomainFeatures(features, domainFeatures);
    features.sort((a, b) => a.name.localeCompare(b.name));
  }
}
```

Note that AI-inferred features are **not** appended — they're run through
`mergeDomainFeatures` (the ch. 8 similarity engine), so an AI-suggested
"Customizable Plans" that overlaps an already-detected "Plan Management"
gets folded into the existing entry instead of creating a near-duplicate.
The features array is re-sorted afterward since merging can change which
names exist.

## Fingerprinting: how the pipeline knows nothing changed

```ts
export function createProjectFingerprint(files: ScannedFile[]): string {
  const content = files
    .map((file) => [file.path, hashContent(file.content)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}:${hash}`)
    .join("\n");
  return hashContent(content);
}
```

Every file gets hashed individually (MD5 via `hashContent`, see ch. 14),
the `path:hash` pairs are sorted by path for determinism, then the whole
joined string is hashed again into one fingerprint. Sorting matters: without
it, two runs over the same files in different filesystem enumeration order
would produce different fingerprints for identical content.

`commands/analyze.ts` compares this fingerprint against the previous
snapshot's fingerprint before doing anything expensive:

```ts
if (previous.status === "valid" && previous.snapshot.fingerprint === snapshot.fingerprint) {
  // reuse the existing snapshot — no AI calls, no re-enrichment
}
```

This is the mechanism that makes `devmap analyze` cheap to run repeatedly:
static analysis always reruns (it's fast), but AI enrichment and snapshot
writes are skipped whenever the fingerprint matches.

## Two separate scoring systems, one shared signal

This is worth calling out because it's easy to conflate on a first read:
`projectMap.ts` computes file importance **twice**, for two different
purposes, with two different formulas.

**`rankCriticalFiles()`** produces the top-10 `criticalFiles` list shown in
CLI output and used by onboarding:

```ts
let score = referencedBy * 3;
if (entryPointSet.has(file.path)) score += 12;
if (calculateExecutionResponsibilityBonus(file.path) > 0) score += 16; // orchestrator/router/controller-shaped filenames, or anything in commands/
if (/(types?|constants?)\.[cm]?[jt]sx?$/.test(file.path)) score -= 8;   // types/constants files are rarely "critical" to read first
if (/(auth|session|db|middleware|schema|config)/i.test(file.path)) score += 3;
score += calculateCriticalSemanticBonus(file, analysis);               // 0–50, see below
if (/(page|layout|route|server|app|main|index)\./.test(file.path)) score += 2;
```

**`calculateImportance()`** produces the `importance` field (0–100, capped)
stored per-file in `fileIndex`, used for ranking within feature maps and
agent navigation output:

```ts
let importance = referencedBy * 10 + criticalScore * 5 + featureRefs.length * 8;
if (isEntryPoint) importance += 20;
if (/(index|main|app|server|layout|page|route)\./.test(path)) importance += 5;
importance += calculateSemanticImportanceBonus(...);  // 0–70, see below
```

Both formulas independently call into **the same underlying signal** —
`detectAuthenticationSemanticRole()` from the feature engine (fully explained
in ch. 6) — but weight it completely differently: the critical-files version
caps the bonus around 50, the importance version around 70. This isn't a
bug; `criticalFiles` is a short, human-facing top-10 list where you don't
want auth files crowding out everything else, while `importance` is a dense
per-file score meant to sort *within* a feature that's often auth-heavy by
nature. If you're tuning one of these, check whether the other needs a
matching adjustment — they're intentionally different, but drifting apart by
accident is the actual risk.

## `classifyFileScope` — the other per-file tag

Separately from importance, every file gets a coarse `FileScope`
(`api | ui | database | config | service | cli | test | docs | unknown`),
computed by `classifyFileScope()` using cheap path and export-name regexes
(e.g. anything under `commands?/cli/bin/scripts?/console/` → `"cli"`; export
names matching `GET|POST|PUT|...` → `"api"`). This is intentionally simpler
than the `FileRole` classifier in ch. 2 — `FileScope` exists for high-level
filtering (e.g. "exclude docs and test files from agent navigation
candidates"), not for architectural documentation.

## Assembling `ProjectMap`

The return value is the single most important type in the codebase — every
command, every generated file, ultimately reads from a `ProjectMap`. A few
things worth knowing about how it's built:

- Optional fields (`database`, `entityGraph`, `capabilities`, `domain`,
  `warnings`) are attached with conditional spreads
  (`...(database ? { database } : {})`) rather than always being present as
  `null`/`undefined` — this keeps `.devmap/snapshot.json` and `--json`
  output lean when a project genuinely has no database or no detected
  capabilities.
- `agentInstructions` is a small, hardcoded object baked into *every*
  snapshot: `navigationPolicy: "index-first"`, `maxInitialFiles: 3`,
  `fallbackRule: "..."`. This is the machine-readable half of the same
  contract that `AGENTS.md` states in prose (ch. 13) — it means an agent
  that only ever reads `snapshot.json` directly (skipping `AGENTS.md`
  entirely) still gets the navigation contract.
- `dependencies` (npm package names from `package.json`) and `fileGraph`
  (resolved file-to-file imports) are deliberately separate fields with
  similar-sounding names — don't confuse them when reading downstream code.

## See also

- Ch. 2 for what `scanFiles` and `analyzeFiles` actually do
- Ch. 6 for the full `detectAuthenticationSemanticRole` mechanism referenced
  twice above
- Ch. 9 for `buildDependencyGraph`, `detectEntryPoints`, and flow generation
- Ch. 14 for `hashContent` (MD5) and how the fingerprint feeds snapshot
  staleness checks elsewhere in the CLI
