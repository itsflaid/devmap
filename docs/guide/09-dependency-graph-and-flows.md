# 9. Dependency Graph & Flows

**Source:** `packages/cli/src/analyzers/graph/`, plus the flow-generation
half of `pipeline/projectMap.ts`

Two related but distinct data structures live here: the **file-to-file
import graph** (who imports whom) and **flows** (a narratable sequence of
files for a specific feature or request path, built on top of that graph).
The graph also directly powers `devmap map`.

## Building the graph: `buildDependencyGraph()`

**Source:** `graph/dependencyGraph.ts`

For every scanned file, take its import specifiers (reusing
`analyses[path].imports` from ch. 2 if available, otherwise a private
regex fallback identical in shape to the one in `heuristicAnalyzer.ts`),
keep only **relative** ones (`.`-prefixed — bare package imports are
irrelevant to an internal file graph), and resolve each to an actual
project file via `resolveImport()`.

Resolution tries a fixed list of candidate suffixes against the specifier
— every common extension (`.ts .tsx .js .jsx .mjs .cjs .vue .svelte
.astro`), then the same list again under an `/index.*` folder-import
convention. It also handles the "wrote a `.js` extension in the specifier
but the actual file on disk is `.ts`" case (common in ESM-strict
TypeScript configs) by trying the `.ts`/`.tsx` variants of a `.js`-suffixed
specifier too. If none of the candidates exist in the scanned file set
(`localPaths`), the import is silently dropped — the graph only ever
represents *resolved, in-project* edges, never external packages or
broken imports.

The result, `FileGraph = Record<string, string[]>`, is the single shared
data structure nearly every other chapter's algorithms walk: entry-point
detection, critical-file scoring (ch. 1), Express/Fastify mount resolution
(ch. 3), `devmap map`/`devmap flow` (ch. commands 4–5), and change-impact
analysis (below).

`countReferences(graph)` inverts the edge counts into "how many files
import *this* file" — the `referencedBy` figure used directly in ch. 1's
critical-file scoring.

## Entry points: convention first, orphan-with-outgoing-edges second

**Source:** `graph/entryPoints.ts`

```ts
const ENTRY_PATTERNS = [
  /(^|\/)page\.[jt]sx?$/, /(^|\/)layout\.[jt]sx?$/, /(^|\/)middleware\.[jt]s$/,
  /(^|\/)(server|app|index|main)\.[cm]?[jt]sx?$/, /(^|\/)route\.[jt]s$/
];
```

A file qualifies as an entry point if it's a source file, passes
`isArchitectureSource` (ch. 3), and **either**:
- matches one of the framework-convention filename patterns above, **or**
- is never imported by anything (`!imported.has(path)`) but *does* import
  something itself (`graph[path]?.length > 0`) — an orphan with outgoing
  edges is a reasonable heuristic for "nothing calls this, but it calls
  other things, so it's probably invoked externally" (a CLI script, a
  cron job file, etc.).

Results are capped at 20 and sorted alphabetically — this list feeds
straight into `agentInstructions`/onboarding as "where to start reading."

## Reverse graphs and bounded tree walks — what `devmap map` is built on

**Source:** `graph/dependencyMap.ts`

Two utilities exist specifically to make `devmap map`'s tree output
possible without either recursing forever on a cycle or dumping an
unreadably huge tree for a hub file:

**`buildReverseGraph()`** inverts `FileGraph` into "who imports me"
(dependents rather than dependencies) — this is what makes a "used by"
view possible at all, since the forward graph alone only answers "what do
I import."

**`buildBoundedTree()`** walks outward from a root up to `maxDepth` hops,
building a `MapTreeNode` tree rather than a flat list, with two safety
mechanisms baked in:

- **Cycle handling** — an `ancestors` list is threaded through recursive
  calls (not a global visited set — each *branch* tracks its own
  ancestors, so the same file can legitimately appear in two different
  branches of the tree). If a candidate is already an ancestor on the
  *current* branch, it's emitted once as a leaf with `isCycle: true`
  instead of being expanded further — real import cycles (`A → B → A`)
  are common enough in JS/TS codebases that this isn't an edge case to
  special-case around, it's a normal path.
- **Fan-out capping** — `DEFAULT_MAX_CHILDREN = 25`. The doc comment
  explains why this exists: a shared `types.ts` or `utils.ts` can have
  extremely high fan-in, and without a cap a single "used by" tree (or the
  Mermaid diagram rendered from it) balloons to hundreds of nodes. Cut-off
  children are counted, not just dropped — `truncatedCount` surfaces as
  the `"… +N more"` line you see in `devmap map` output (rendered by
  `renderTree()` in `utils/mapRenderer.ts`, ch. commands 4). Passing
  `maxChildren: Infinity` (wired to the `--all` CLI flag) bypasses the cap
  entirely.

`collectNodesWithinDepth()` is the flat-list sibling of the same walk —
used where a feature map needs "what files does this feature's boundary
touch" as a deduplicated set rather than a nested tree.

## Flows: `generateFeatureFlows()` and `generateRequestFlows()`

**Source:** back in `pipeline/projectMap.ts`

Two flow generators, both exported for reuse by `commands/flow.ts` (ch.
commands 5) with configurable `limit`/confidence options, and both called
once with tight default limits inside `createProjectMap` itself
(`generateMinimalFlows` — 3 feature flows minimum-high-confidence, 5
request flows, API routes only) so every snapshot always has *some* flow
data even before anyone runs `devmap flow` explicitly.

**`generateFeatureFlows()`** turns a feature's already-computed
`businessFlow` (a list of narrative strings from ch. 6) into steps,
attempting to associate each narrative line with an actual file by
checking whether the file path appears as a substring within the label
text. Only features meeting the confidence threshold *and* with more than
one real business-flow step *and* without the generic
`"Identify files related to..."` placeholder are included.

**`generateRequestFlows()`** is graph-driven rather than narrative-driven:
starting from a route's file, `collectFlowFiles()` does a **breadth-first
walk of the dependency graph, capped at 5 files**, to produce "the files
this request path touches, roughly in call order." Each step's label is
rendered via `renderFlowStepLabel()`, which prefixes the very first step
with `"Start with"` and every subsequent one with `"Review"`, appending up
to 2 exported top-level function names from that file's index entry as a
hint of what's actually in it.

Both flow types can render a Mermaid diagram via `renderMermaidFlow()` — a
**different, simpler** implementation than `utils/mapRenderer.ts`'s
`renderMermaid()` (ch. commands 4): this one renders a straight linear
chain (`S1 --> S2 --> S3`, using each step's index as the node ID) since a
flow is inherently a sequence, not an arbitrary graph — `mapRenderer.ts`'s
version handles arbitrary edge lists instead. They're not meant to be
merged; a linear flow and a dependency graph are genuinely different
shapes.

## Onboarding path and change impact — two more graph consumers

`buildOnboardingPath()` assembles the `onboarding.recommendedPath` field
(consumed by both the onboarding system, ch. 15, and `AGENTS.md`'s
navigation instructions) as an ordered `Set` — well-known root docs first
(`README.md`, `AGENTS.md`, `DEVMAP.md`, `package.json`), then entry points,
then critical files, then everything else sorted by `importance`
descending, capped at 12 total.

`buildChangeImpact()` produces the `changeImpact` map — for every file,
which features/flows reference it and which other files depend on it
(`dependents`), so "if I change this file, what might break" has a direct
answer per file in the snapshot. It uses its own private
`buildReverseDependencies()`, structurally similar to but **not the same
function** as `buildReverseGraph()` in `dependencyMap.ts` — this one
doesn't dedupe inline (relies on the graph itself having no duplicate
edges) and explicitly sorts each dependents array at the end for
deterministic output. Another instance of the "same idea, two independent
implementations" pattern that shows up more than once in this codebase —
see ch. 4 for another example with relation-building.

## See also

- Ch. 1 for how `entryPoints` and `references` feed critical-file scoring
- Ch. 3 for how the graph resolves Express/Fastify router mounts
- Ch. 6/8 for `businessFlow`, the narrative input to `generateFeatureFlows`
- Commands ch. 4/5 for how `devmap map`/`devmap flow` expose this at the CLI
