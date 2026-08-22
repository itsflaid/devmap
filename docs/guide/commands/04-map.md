# `devmap map`

**Source:** `packages/cli/src/commands/map.ts`

The most structurally varied command in the CLI — `devmap map` doesn't
have one rendering path with options, it has **three genuinely different
rendering functions** depending on what kind of target was given, all
built on ch. 9's `buildBoundedTree`/`buildReverseGraph`.

## Target resolution decides everything downstream

```ts
function resolveMapTarget(snapshot, target): ResolvedTarget {
  if (!target) return { mode: "project" };
  const feature = snapshot.features.find(f => f.name.toLowerCase() === target.toLowerCase());
  if (feature) return { mode: "feature", value: feature.name };
  const fileTarget = resolveFileTarget(snapshot, target);
  if (fileTarget) return fileTarget;
  throw new DevmapError(`"${target}" isn't a known file or feature.`, /* lists known features */);
}
```

No target → project mode. A case-insensitive exact match against a
feature name → feature mode. Otherwise, `resolveFileTarget()`
(`utils/targetResolver.ts`) tries to resolve it as a file — supporting
partial/fuzzy path matches, not just an exact `fileIndex` key. Only if
none of these resolve does it throw, and the error message includes the
actual list of known feature names so the person isn't left guessing.

## File mode: two trees, deliberately asymmetric depth

```ts
const USES_DEPTH = 2;
const USED_BY_DEPTH = 1;
```

`buildFileMap()` walks the **forward** graph (`snapshot.fileGraph`) for
"Uses" at depth 2, and the **reverse** graph (`buildReverseGraph`, ch. 9)
for "Used by" at depth 1 — not the same depth for both. A file's outgoing
dependencies are usually a bounded, meaningful chain worth showing two
levels deep; incoming references ("who imports me") can fan out sharply
for a shared utility, so it's kept shallower by default even before ch.
9's `maxChildren` cap kicks in. `--depth` overrides both trees to the same
value if you need more of either.

## Feature mode: an internal tree, plus what's outside the boundary

`buildFeatureMap()` is the most involved of the three. It builds one
`buildBoundedTree` call **filtered to the feature's own files**
(`filter: (path) => featureFiles.has(path)`, depth 4 by default — the
deepest of any mode, since a feature's internal call chain is exactly what
this view exists to show) rooted at the feature's entry point. Everything
else is computed by diffing against that:

- **`unreached`** — files listed in `feature.files` that the tree walk
  from the entry point never actually reached. This can legitimately
  happen (a feature's file list, ch. 6, isn't always a single connected
  import graph) and is shown separately as *"Other files in this
  feature"* rather than silently dropped.
- **`externalDependencies`** — walking every feature file's outgoing
  edges in `fileGraph` and keeping only the ones landing *outside* the
  feature's own file set — "what does this feature reach into that isn't
  itself."
- **`externalDependents`** — the mirror, via `buildReverseGraph` — "what
  outside code reaches into this feature."

### Keeping the diagram and the text list in sync

A small but easy-to-miss detail, called out directly in the source
comment:

```ts
// Cap which files are actually drawn as edges to match the (possibly
// truncated) flat lists below — otherwise the mermaid diagram could
// still balloon even after the text list is capped.
```

`shownDependencies`/`shownDependents` are capped to the same limit
(`DEFAULT_MAX_CHILDREN`, or `Infinity` under `--all`) *before* being used
to filter which Mermaid edges get drawn — without this, the text "Depends
on" list could show a capped, readable 25 entries while the diagram below
it silently rendered all 80, telling two different stories about the same
feature.

## Project mode: feature-grouped by default, a full raw dump under `--all`

Without `--all`, `buildProjectMap()` doesn't draw a file-level graph at
all — it groups every file into its owning feature (first-feature-wins via
a `fileToFeature` map, since a file can technically appear in more than
one feature's list), then draws **cross-feature edges only**: if any file
in Feature A imports any file owned by Feature B, one deduplicated
`A → B` edge is added, not one edge per file pair. This is a deliberate
zoom-out — the project-level map answers "how do the features relate,"
not "how do the files relate" (that's what feature mode and file mode are
for). A coverage note at the bottom is explicit about what's excluded:
*"X of Y files belong to a detected feature. The rest (config, infra,
tests, etc.) aren't shown here."*

`--all` bypasses all of this and calls `buildFullProjectDump()` instead —
every file in `fileGraph`, sorted, each with its complete dependency list,
no feature grouping, no capping. This is the one path in the entire
command that reads `fileGraph` completely raw.

## Output: always written to disk, regardless of `--json`

Unlike `devmap onboarding`'s opt-in `--write`, `devmap map` **always**
writes both a `.md` and a `.mermaid` file to `.devmap/maps/<slug>.md`/
`.mermaid` (`slugifyMapName()` turns a feature name or file path into a
filesystem-safe slug) — this happens before the command even decides
whether to print to the terminal or emit JSON. The `--json` response
still includes both the markdown and mermaid content inline (`built.markdown`,
`built.mermaid`) *in addition to* the paths they were written to, so a
JSON-mode caller doesn't have to read the files back off disk to get the
content.

## See also

- Ch. 9 for `buildBoundedTree`, `buildReverseGraph`, `DEFAULT_MAX_CHILDREN`,
  and `renderMermaid`/`renderTree` (`utils/mapRenderer.ts`)
- Ch. 6 for how `feature.files`/`feature.entryPoint` — the input to
  feature mode — get decided in the first place
- Ch. 14 for `isSnapshotStale`, checked here the same way `onboarding.ts`
  checks it
