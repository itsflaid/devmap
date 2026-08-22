# 13. Agent Navigation Output

**Source:** `packages/cli/src/cache/agentNavigation.ts`

Everything in chapters 1–12 builds a `ProjectMap` in memory. This chapter
is where that data actually becomes the files an AI coding agent reads:
`.devmap/index.json` and `.devmap/features/*.json`. If `docs/generated-files.md`
tells you *what* these files contain, this chapter explains *how* they're
built and — more importantly — *why* the ranking inside them works the way
it does. This is arguably the actual product: everything upstream exists to
produce good input to this file.

## Two views of the same features, at two granularities

`writeAgentNavigationFiles()` produces one lightweight pointer per feature
(inside `index.json`) and one detailed map per feature (`features/<id>.json`)
— deliberately different shapes for a "browse, then drill in" navigation
pattern:

```ts
type AgentFeatureIndex = {
  id: string; name: string; summary: string;
  keywords: string[]; criticalFiles: string[]; map: string; // pointer to the detail file
};
```

vs. the full feature map, which additionally carries `entryPoints`,
`relatedFiles` (every file, each with its own inferred `role` string),
optional `flow` steps, up to 12 `keywords`, `confidence`, and —
the field actually meant to be read top-to-bottom — `sourcePriority`.

### `featureId()` and a dedup safety net

Feature names become slugs (`"Checklist Item Management"` →
`"checklist-item-management"`) via a straightforward lowercase-and-hyphenate
transform. The dedup step existing at all is a direct acknowledgment that
two differently-capitalized or differently-punctuated names can collide
on the same slug — first-seen wins, same stability principle ch. 8 used
for feature identity.

Before writing new feature files, every existing `.json` under
`.devmap/features/` is deleted (`removeStaleFeatureMaps`) — this is what
keeps a renamed or removed feature from leaving an orphaned, stale file
behind after a re-analyze.

### `sourcePriority` — yet another file-ordering formula

Within one feature's detail map, `sourcePriority` orders that feature's
own files by: is it an entry point (first), then its original position in
`feature.files` (preserves whatever order upstream detection produced),
then `fileIndex[path].importance` descending (ch. 1), then alphabetical as
a final tiebreak. This is deliberately simple compared to the next section
— it only needs to order files *within* an already-scoped feature, not
decide which files across the whole project matter most.

## `selectIndexCriticalFiles` — the "start here" ranking for the whole project

This is the one every AI agent actually hits first, and it's the most
elaborate ranking formula in the codebase — worth understanding in full
since it's a genuinely different computation from anything in ch. 1 or
ch. 6, not a restatement of them.

**Candidates** are pooled from everywhere a file could plausibly be
important: all entry points, every feature's entry point(s) and files
(skipping the `Documentation` feature specifically — it would otherwise
flood this list with docs, which have their own separate treatment), every
flow's entry point and step files, and every already-computed critical
file from ch. 1. That pool is filtered to exclude `test`/`docs`-scoped
files, then ranked by `calculateStartHereScore()`:

```ts
return (entryIndex >= 0 ? 1_000_000 - entryIndex * 10_000 : 0)  // being a known entry point dominates everything else
  + commandBonus            // +500 if FileScope === "cli"
  + commandPathBonus        // +300 if path matches /commands?/
  + entryProximityBonus     // up to +200, decaying by 60 per BFS hop from the nearest entry point
  + flowOwnership * 120     // number of flows this file appears in
  + featureOwnership * 100  // number of features this file is an entry point for
  + (metadata?.featureRefs.length ?? 0) * 40
  + (metadata?.importance ?? 0);  // ch. 1's score, as a final small nudge
```

Two things are worth calling out specifically:

- **The `1,000,000`-scale entry-point term isn't arbitrary inflation** — it
  guarantees actual entry points always sort above everything else,
  *while still preserving their relative order* (earlier entries in
  `snapshot.entryPoints` score higher than later ones, via the
  `-entryIndex * 10_000` term) rather than treating all entry points as
  tied.
- **`entryProximityBonus` needs its own BFS**, computed by
  `computeEntryDistance()` — a breadth-first walk of `fileGraph` seeded
  from every entry point simultaneously. The comment explains exactly why
  this was added: without it, "the file the entry point calls directly"
  and "some file three imports deeper" only differed by generic
  `importance`, which doesn't actually track call-graph position. This
  fixes a real blind spot — importance alone can't distinguish "close to
  where execution starts" from "important but buried three layers down."

## A naming collision worth being precise about

Ch. 1 mentioned `ProjectMap.agentInstructions` — a structured object
(`navigationPolicy`, `maxInitialFiles`, `fallbackRule`) embedded in
`snapshot.json`. This chapter's `index.json` **also** has a field called
`agentInstructions` — but here it's a single prose string:

```
"Read this file first. Pick the relevant feature by keywords, open its
feature map, then inspect only source files listed in sourcePriority.
Do not read snapshot.json unless index.json and feature maps are
insufficient."
```

These are **two separate fields, in two separate output files, with two
different shapes**, that happen to share a name because they serve the
same underlying purpose (telling an agent how to navigate) at two
different levels of the output — one structured and machine-parseable
(`snapshot.json`), one a directly-readable instruction
(`index.json`). Don't assume editing one updates the other.

## Human-readable project summary generation

`createProjectSummary()`/`describeProjectKind()` turn the structured
`projectTypes` array (ch. 14 — plural, since ch. 3's framework detection
can legitimately find both a frontend and backend in one scan) into a
sentence: `"DevMap is a TypeScript monorepo containing a Node.js CLI and
web application. Main capabilities: ..."`. `describeProjectKind()` handles
one, two, or many detected types with different grammar (`"centered on a
Node.js CLI"` for a single CLI-only project vs. an Oxford-comma-joined list
for several) — small, but it's the difference between the summary reading
like a template and reading like a sentence.

## See also

- Ch. 1 for `ProjectMap.agentInstructions`, `criticalFiles`, and
  `fileIndex.importance` — all consumed here, none of them recomputed here
- Ch. 9 for `fileGraph`, walked again by `computeEntryDistance`'s BFS
- Ch. 14 for `projectTypes`/`workspaceType` and how snapshot.json relates
  to what this chapter writes
