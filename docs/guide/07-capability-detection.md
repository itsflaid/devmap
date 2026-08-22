# 7. Capability Detection

**Source:** `packages/cli/src/analyzers/detectors/capabilityDetector.ts`

Feature detection (ch. 6) answers "what libraries does this project use?"
Capability detection answers a different question: "what does this project
actually **let a user do**, based on the shape of its API routes?" A route
table with `GET/POST/PUT/DELETE /snippets` implies CRUD on a `Snippet`
entity whether or not the code imports anything you'd recognize by name.

```ts
export type CapabilityKind =
  | "crud" | "sharing" | "collaboration" | "discovery" | "publishing"
  | "social" | "file-management" | "real-time" | "search" | "reporting";

export type CapabilityInfo = {
  kind: CapabilityKind;
  name: string;
  entities: string[];   // which entity this operates on
  evidence: string[];   // route files
  confidence: "high" | "medium" | "low";
};
```

## Two detection passes, both API-routes-only

`detectCapabilities()` runs two independent passes and deduplicates by
`kind` at the end:

### Pass 1 — CRUD, grouped by resource

Every API route's first non-generic path segment becomes a "resource"
(`extractResourceName` — strips dynamic segments, version prefixes
`v1/v2/v3`, and anything shorter than 3 characters). Routes are grouped by
resource, and HTTP methods across all of that resource's routes are
unioned: any `GET` → has-read, any of `POST/PUT/PATCH` → has-write, any
`DELETE` → has-delete. A resource needs at least read *or* write evidence
to count at all; having all three (read + write + delete) bumps confidence
to `"high"` instead of `"medium"`.

The resource name is resolved to an actual entity name via
`resolveEntityName()` — try an exact case-insensitive match against
`entityGraph.entityNames` first, then a singularized match, falling back to
just capitalizing the (already-singularized) resource string if no entity
graph match exists at all. This means CRUD capabilities still get sensible
names even on a project where entity extraction (ch. 4) came up completely
empty.

### Pass 2 — behavioral signals, from a tuned signal table

`BEHAVIORAL_SIGNALS` is ten hand-tuned entries (sharing, publishing,
collaboration, discovery, social, file-management, real-time, search,
reporting — plus CRUD from pass 1) each with **its own** path-pattern list
and **two independent thresholds**:

```ts
type BehavioralSignal = {
  kind: CapabilityKind;
  name: string;
  pathPatterns: RegExp[];
  highConfidenceAt: number;    // matches needed for "high" confidence
  minimumMatches?: number;     // matches needed to surface at all (default 1)
};
```

## Why the thresholds are tuned the way they are

This is worth reading directly from the source comment because it's a
genuine design history, not just a table of magic numbers:

> `highConfidenceAt = 1` was too aggressive — a single route match on a
> generic path like `/search` or `/stats` was enough to create a "high"
> confidence feature, even when that route was just a UI page.

The fix has two parts, both still visible in the current code:

1. **Behavioral detection only runs on API routes, never page routes.**
   `detectCapabilities()` filters to `apiRoutes` before calling
   `detectBehavioralCapabilities` — a `/search` **page** route is a UI
   pattern (there's a search box somewhere), not evidence of search
   infrastructure. Only `/api/search`-shaped routes count.
2. **Per-signal thresholds, chosen per how ambiguous the path pattern is:**

   | Capability | `minimumMatches` | `highConfidenceAt` | Why |
   |---|---|---|---|
   | Search | 2 | 2 | A single `/api/search` could be a simple list filter, not real search infra |
   | Social | 2 | 3 | A lone `/comments` route could be anything — needs multiple social signals (likes *and* comments, say) before it counts |
   | Sharing, Collaboration, Reporting | 1 | 1–2 | Path patterns specific enough (`workspace`, `invite`, `report`) that one match is meaningful, but confidence still needs 2 for the less-unambiguous ones |
   | Publishing, Discovery, File Management, Real-time | 1 | 1 | Path patterns specific enough that a single match is both sufficient to surface *and* enough for high confidence |

If you're adding a new behavioral signal, the pattern to follow is: start
by asking how many *unrelated* things a matching path segment could mean in
an arbitrary project. `/api/live` is almost always real-time; `/api/stats`
is not always real reporting infrastructure (plenty of apps have a
`/dashboard` that's just a landing page). The more generic the path
vocabulary, the higher both thresholds should be.

## Deduplication and confidence merging

Both passes can produce entries with the same `kind` (a resource pattern
matching both a CRUD shape and a behavioral signal). `deduplicateCapabilities()`
keeps one entry per kind, unioning `entities` and `evidence` (capped at 5
files) and keeping the **higher** of the two confidences via a simple rank
map (`{ high: 2, medium: 1, low: 0 }`).

## A third, independent `singularize()`

Worth flagging since it's easy to miss: this file has its own private
`singularize()`, structurally similar to but **not the same function** as
the one exported from `analysis/extractors/fallbackExtractor.ts` (ch. 4) —
this one has no irregular-word map (`people` → `person`, etc.) and slightly
different suffix handling. Two independent, drifting implementations of the
same idea across the codebase. If a resource name singularizes incorrectly
in a capability but correctly in an entity, or vice versa, check which of
the two functions actually ran.

## See also

- Ch. 4 for `EntityGraph`/`entityNames`, consumed by `resolveEntityName`
- Ch. 6 for `capabilitiesToFeatures()`, which turns this chapter's output
  into `FeatureInfo` entries (and drops low-confidence ones with no
  resolvable entry point)
- Ch. 3 for where the `RouteInfo[]` input comes from
