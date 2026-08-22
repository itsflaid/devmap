# 8. Similarity & Merge

**Source:** `packages/cli/src/analyzers/features/featureSimilarity.ts`,
`featureMerge.ts`

Six different places in the codebase need to answer "are these two features
actually the same thing?" — role-based features merging with signal-based
ones, capability-derived features merging with entity-derived ones, and
(the hardest case) AI-inferred domain features merging with everything
static analysis already found. This chapter is the one shared answer all
of them use.

## The problem this replaced

The module docblock states the history directly, and it's worth repeating
because it explains *why* this module exists as a separate concern rather
than being folded into `featureDetector.ts`:

> Previously merge logic was scattered in two places: `featureDetector.ts`
> using name-only comparison, and `projectMap.ts` using
> `f.name.toLowerCase()` equality for domain features. Both had the same
> flaw: **relying on the name as identity.** `"Plan Management"` and
> `"Customizable Plans"` would never merge, because the names differ — even
> though they're describing the exact same thing an AI happened to word
> two different ways across two different runs.

That last point matters specifically because AI wording isn't stable
run-to-run (ch. 11's domain inference can phrase the same feature
differently each time it's called), so name-equality merging would create
duplicate features every time the wording drifted even slightly.

## `computeSimilarity()` — four weighted factors

```ts
export type FeatureIdentity = {
  name: string;
  files: string[];
  searchTerms: string[];
  relatedEntities: string[];
  purpose?: string;
};

const DEFAULT_WEIGHTS = {
  fileOverlap: 0.45,     // most reliable — concrete, unambiguous evidence
  termOverlap: 0.25,
  entityOverlap: 0.20,
  nameSimilarity: 0.10,  // least reliable — AI wording is volatile
};
```

`FeatureIdentity` is deliberately a narrower type than `FeatureInfo` — just
enough fields to compare, so this module doesn't need to import the full
feature type and stays reusable in isolation (the docblock notes this is
groundwork for a possible future fingerprint-persistence system).

Three of the four factors are **Jaccard similarity** (`|A ∩ B| / |A ∪ B|`)
over sets — files, normalized search terms, normalized related entities.
Two features that share no files and no terms score `0`; two identical
sets score `1`; two **empty** sets score `1` too (the reasoning: two
features with no file data aren't "conflicting," so treating that as
maximum rather than minimum similarity avoids an empty-data artifact
dragging the composite score down unfairly).

The fourth, name similarity, uses **trigram Dice coefficient** instead of
edit distance — the doc comment explains why: trigram overlap is more
robust than Levenshtein for short, differently-worded names, exactly the
`"Plan Management"` vs `"Customizable Plans"` case (~0.28 trigram
similarity — low, but the *other* three factors are what actually carry
that particular match past the threshold).

The composite score is a straight weighted sum, threshold `0.35` by
default — chosen, per the doc comment, so that `"Plan Management"` and
`"Customizable Plans"` (entity + term overlap, low name similarity) match,
while `"Authentication"` and `"Search"` (no overlap on anything) don't, and
`"Search"` vs `"Search Functionality"` (term overlap) does.

## `findSimilarFeature()` — best match, not first match

```ts
export function findSimilarFeature(
  candidates: FeatureIdentity[], target: FeatureIdentity, thresholdOrConfig?
): { index: number; score: number } | null
```

Scores every candidate and returns the single **highest**-scoring one that
clears the threshold — not the first one that clears it. This matters when
a new feature is plausibly similar to two existing entries; picking the
best rather than the first avoids merge order becoming a hidden source of
nondeterminism.

## The merge itself: enrich, never rename

**Source:** `featureMerge.ts`

`mergeIntoFeatureList(features, addition)` is the single function that
replaced both of the old scattered call sites. The rule that makes output
stable across repeated runs:

> **Canonical name: first-seen wins, and is never overwritten.**

If `"Plan Management"` is already in the list and a later AI-inferred
`"Customizable Plans"` merges into it, the entry keeps the name
`"Plan Management"` — even if the AI phrasing would arguably read better.
Stability across runs is valued over any single run's wording.

`mergeFeatureData()` — the actual field-by-field combine — treats each
field differently, and the reasoning is worth internalizing since it's the
kind of thing that's easy to get subtly wrong if you touch this code:

| Field | Rule | Why |
|---|---|---|
| `name` | existing wins, always | canonical identity, see above |
| `purpose` | existing wins, **unless** existing is a generic auto-generated fallback and the addition isn't | `isGenericPurpose()` detects boilerplate like `"Identifies X capability..."`/`"Manages X data and operations."` — a specific AI-written purpose is worth upgrading to, a specific *static* purpose should never be overwritten by a generic one |
| `files`, `evidence`, `entryPoints` | union, deduplicated | more evidence is strictly better |
| `searchTerms` | union, deduplicated, capped at `MAX_SEARCH_TERMS` (8) | keeps the field bounded across repeated merges |
| `confidence` | the higher of the two | merging evidence should never make a feature look *less* certain |
| `businessFlow` | existing wins if non-empty and not a placeholder, else addition's | `isPlaceholderBusinessFlow()` checks for the single auto-generated `"Identify files related to..."` stub |

### How `relatedEntities` gets derived for the entity-overlap factor

`toFeatureIdentity()` doesn't have a dedicated entities field on
`FeatureInfo` to read from directly — `extractRelatedEntities()`
reconstructs it from two narrower signals instead of trusting all of
`searchTerms` (which mixes entity names with generic technical keywords
from `FEATURE_SIGNALS`):

1. A regex against the feature's own name: `"X Management"`/`"X System"`/
   `"X Module"`/`"X Feature"`/`"X Service"` → `X` is almost certainly an
   entity name.
2. Any search term that's Title Case — since generic `FEATURE_SIGNALS`
   terms are lowercase by convention (ch. 5), a capitalized term reads as
   an actual entity name that leaked into `searchTerms`, not a technical
   keyword.

This is a narrower net on purpose — the comment notes generic technical
keywords still contribute to the *term* overlap factor already; entity
overlap is meant to catch specifically entity-name evidence, not
double-count the same terms twice.

## `mergeDomainFeatures()` — the AI merge entry point

A thin loop calling `mergeIntoFeatureList` once per AI-inferred feature —
this is exactly what ch. 1 showed being called from `createProjectMap`'s
Step 4, and it's the reason AI-suggested features can never silently
duplicate something static analysis already found.

## A groundwork feature not yet wired up

`buildFeatureFingerprint()`/`fingerprintSimilarity()` at the bottom of
`featureSimilarity.ts` are explicitly **not used anywhere yet** — the
comment marks them as foundation for a possible future
`.devmap/fingerprints.json` persistence layer that would let features be
matched by fingerprint across separate `devmap analyze` runs, rather than
only within a single run's in-memory list as today. If you're looking for
where fingerprint-based feature identity is *used*, it currently isn't —
this is forward-looking infrastructure, not a wired-in subsystem.

## See also

- Ch. 6 for the four evidence sources that all funnel through `mergeFeature`
- Ch. 11 for `mergeDomainFeatures`'s role in Step 4 of `createProjectMap`
- Ch. 1 for the call site in `projectMap.ts`
