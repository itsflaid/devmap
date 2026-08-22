# 6. Feature Detection Engine

**Source:** `packages/cli/src/analyzers/features/featureDetector.ts`

This is the single largest file in the analysis engine (~1000 lines) and
the one most other chapters point back to. `detectFeatures()` is where four
independent kinds of evidence — file roles, registry keywords, route
capabilities, and entity relationships — all get turned into the same
`FeatureInfo` shape and merged into one list.

```ts
export type FeatureInfo = {
  name: string;
  purpose: string;
  files: string[];
  entryPoint?: string;
  entryPoints: string[];
  businessFlow: string[];
  searchTerms: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};
```

## The four evidence sources, run in sequence

```ts
export function detectFeatures(
  files, analyses, routes, database?, entityGraph?, capabilities?, fileGraph?
): FeatureInfo[] {
  // 1. ROLE_FEATURES        — Documentation, Web Landing, CLI Commands
  // 2. FEATURE_SIGNALS      — registry-driven (ch. 5): Auth, Payments, Search, ...
  // 3. capabilitiesToFeatures — from route/capability detection (ch. 7)
  // 4. entityGraphToFeatures  — from entity relationships (ch. 4)
  //    + detectFrontendPageFeatures / detectClientRouteFeatures (ch. 10)
  return enrichAuthenticationFeature(features, scopedFiles, analyses)
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

Each source after the first calls `mergeFeature()` rather than pushing
directly — meaning a feature detected two different ways (say, "Payments"
from a `FEATURE_SIGNALS` keyword match *and* a capability detected from
`/api/checkout`) gets combined into one entry instead of appearing twice.
`mergeFeature` is a thin wrapper that delegates to the similarity engine in
ch. 8 — this file doesn't implement its own merge logic.

### 1. `ROLE_FEATURES` — file-role-based

Three features (`Documentation`, `Web Landing`, `CLI Commands`) are detected
purely from the `FileRole` classifier (ch. 2), not keywords. The comment
block above `ROLE_FEATURES` explains what's deliberately *not* here:
architectural-layer roles (`api-handler`, `service`, `middleware`,
`repository`, `ui-component`) are excluded because they're implementation
concerns, not domain features a person would recognize; `ai-integration` is
excluded because it's handled via `FEATURE_SIGNALS` instead (import-based
detection is more reliable than role-based for that one).

`Documentation` evidence goes through an extra filter,
`isDocumentationEvidence()`, on top of the role check — this excludes
`.github/` files and known meta-files (`CONTRIBUTING.md`, `LICENSE.md`,
`AGENTS.md`, etc. — see `isDocumentationMeta` from ch. 2) so the
"Documentation" feature reflects actual project docs, not repo boilerplate.

### 2. `FEATURE_SIGNALS` — registry-driven

Every `category: "feature"` descriptor from ch. 5's registry gets matched
against a pre-filtered file set (technical source files, evidence-eligible,
excluding the registry's own definition files — see `isRegistryFile`, which
exists for the same self-matching reason `serviceDetector.ts` excludes
itself in ch. 3).

`matchesSignal()` branches on the `importOnly` flag:

```ts
if (importOnly) {
  // AI Integration only — an actual import, a hardcoded provider URL, or
  // classifyFileRole === "ai-integration". Prose mentions don't count.
  ...
}
// Everything else: path segment match first, then import specifier match.
```

Path matching (`matchesPathTerm`) has a length-dependent strategy worth
knowing if a signal ever produces surprising false positives:

```ts
// ≤7 chars: word-boundary regex — "ai" must not match "detail"/"tailwind"/
//           "email"; "search" must not match "SearchSurah.tsx"
// ≥8 chars: plain substring — long terms are specific enough ("elasticsearch")
```

Short terms are dangerous as bare substrings (`"ai"` appears inside dozens
of unrelated words), so they get a real regex boundary check
(`(?:^|[/._-])term(?:[/._-]|$)`), cached per-term in a module-level
`regexCache` map to avoid recompiling the same pattern across every file in
a large scan. Long terms are long enough that a boundary check adds
overhead without meaningfully reducing false positives.

After matching, `signal.minimumDistinctFiles` (ch. 5) is enforced — but
only against evidence that already passed a **file tier** check (`primary`
or `supporting`, see below), so a `reference`-tier file (e.g. a config
file) can't itself satisfy the distinct-file requirement.

### 3. `capabilitiesToFeatures` — from capability detection

Turns each `CapabilityInfo` (ch. 7) into a `FeatureInfo`, with one
quality gate: **a capability with no resolvable entry point and
non-`"high"` confidence is dropped entirely**:

```ts
if (entryPoints.length === 0 && cap.confidence !== "high") return null;
```

The comment explains the reasoning directly: a route pattern matched
without a backing implementation file to point to produces a feature with
empty `criticalFiles` and a misleading name — worse than not detecting it
at all. `purposeFromCapability()` is a plain switch over capability kind
(`crud`, `sharing`, `collaboration`, `discovery`, `publishing`, `social`,
`file-management`, `real-time`, `search`, `reporting`) producing a
human-readable purpose sentence for each.

### 4. `entityGraphToFeatures` — the ownership model

This is the most conceptually interesting of the four. Not every entity
becomes its own feature — a naive "one feature per table" approach would
turn something like `ChecklistItem` (a child row that only ever exists
under a `Message`) into a standalone, confusing feature of its own. Instead,
every entity is classified by its position in the relation graph:

| Classification | Rule | Outcome |
|---|---|---|
| **True child** | Exactly one parent via one-to-many, AND (no children of its own OR a child-like name suffix: `Item`, `Entry`, `Detail`, `Line`, `Row`, `Part`, `Step`, `Variant`, `Option`) | Skipped as standalone — folded into the parent's purpose string instead |
| **Standalone** | Multiple parents, or owns other entities itself (an intermediate node) | Gets its own `"<Entity> Management"` feature |
| **Owned** | Non-infrastructure, non-true-child entities owned via one-to-many/one-to-one | Named in the owning feature's purpose (`buildEntityPurpose`) |
| **Peer** | Many-to-many associations | Named in the purpose as "associates with X" |

`INFRASTRUCTURE_ENTITY_NAMES` (`Account`, `Session`, `VerificationToken`,
`AuditLog`, etc.) is excluded from becoming a feature at all, regardless of
relations — these exist to support an external system (NextAuth/Lucia
internals, audit tables), not the application's own domain. The comment on
this set explicitly notes the "Account" exclusion is safe even for projects
that *do* have a genuine domain concept called "Account" (e.g. billing
accounts) — those still surface through `FEATURE_SIGNALS` or capabilities
instead.

Once an entity is confirmed standalone, its **files** are found via
`findEntityFiles()` — matching path segments against the entity name split
into words (`ChecklistItem` → `checklist`, `item`), tiered so `.prisma`
files rank above migration files — unless the entity already carries
`sourceFiles` from extraction (ch. 4's `SQLExtractor` sets this, since raw
SQL table references have no reliable filename convention to search for).

## File tiering and entry-point scoring — used by every path above

Two small functions are consulted by all four evidence sources, which is
why they live at module scope rather than inside any one branch:

**`classifyFileTier(path)`** → `"primary" | "supporting" | "reference" |
"excluded"`. Migrations, `.sql` files, generated code, and lockfiles are
`excluded` outright. `schema.prisma` and `*.config.*` are `reference`
(useful context, not something you'd point someone to first). Anything
under `api/`/`routes/`, files named `*.service.*`/`*.action.*`/etc., and
anything under `hooks/`/`stores/` are `primary`. Everything else source-ish
is `supporting`.

**`scoreEntryPointRelevance(file)`** — a *lower* score means a *better*
entry-point candidate (this is a "golf score," not a confidence score).
Generic utility files (`utils.ts`, `helpers.ts`, `types.ts`) score 100 —
effectively disqualified via `ENTRY_POINT_EXCLUDE_THRESHOLD = 90`. Route
handlers score 5, `api/` files score 10, CLI commands score 15, services
score 20-25 — the ordering encodes "how likely is a newcomer to actually
want to start reading here."

Both `capabilitiesToFeatures` and `entityGraphToFeatures` filter candidate
entry points through **both** functions together: score under the
threshold, *and* tier is `primary` or `supporting` — a file could pass one
check and fail the other, and both have to agree.

## The authentication semantic-role subsystem

**Source:** `detectAuthenticationSemanticRole()`, exported from this file

This is the piece referenced from outside this chapter more than anything
else in the codebase — ch. 1 showed it consulted twice inside
`projectMap.ts` for unrelated scoring formulas. Within this file itself,
it's the deciding factor for which files get folded into the
`Authentication` feature via `collectAuthenticationFeatureFiles()`.

It classifies a file into one of four roles, checked in priority order (a
file matching an earlier rule never falls through to a later one):

```ts
export type AuthSemanticRole = "auth-config" | "guard" | "provider" | "consumer";
```

1. **`auth-config`** — the file *is* the auth setup itself: `src/auth.ts`/
   `auth.ts` by convention, or content referencing NextAuth-shaped symbols
   (`nextauth`, `getServerSession`, `credentials`, `authConfig`) alongside
   an auth import.
2. **`guard`** — middleware/proxy files, or any file that shows *both*
   auth signals (path/import/symbol) *and* guard signals (`guard`,
   `middleware`, `proxy`, `protected`) — a file can be auth-adjacent
   without being a guard, so both have to be present.
3. **`provider`** — a `providers.ts`-shaped filename combined with an auth
   import or symbol (React context providers wrapping the app in a
   session).
4. **`consumer`** — the catch-all: a layout/app-shell file using
   session-consuming symbols (`useSession`, `signOut`, `useAuth`), or,
   failing all of the above, simply *any* file with an auth path, import,
   or symbol signal at all.

`collectAuthenticationFeatureFiles()` runs every architecture-source,
technical-feature file through this classifier (with graceful fallbacks —
`extractImportsFallback`/`extractSymbolsFallback` reconstruct imports and
symbols via lightweight regex when a real `FileAnalysis` isn't available)
and keeps only files that resolve to a non-`null` role. It also explicitly
excludes files under `analyzers/`/`detectors/` and anything shaped like
`*analyzer.ts`/`*detector.ts` (`isAnalyzerImplementationFile`) — otherwise
DevMap analyzing its *own* codebase would tag `frameworkDetector.ts`
(which legitimately mentions "auth" in comments and identifiers) as part of
some project's Authentication feature.

If an `Authentication` feature already exists from `FEATURE_SIGNALS`, the
enrichment step **merges into it** (union of files, recalculated
confidence) rather than creating a second entry — this runs *after* the
other three evidence sources specifically so it can enrich whatever they
already produced.

### A related but separate priority list

`orderAuthenticationFiles()` / `authenticationFilePriority()` decide
*display order* once files are already selected — proxy/middleware first
(10), `auth.ts` next (20), then auth API routes, login/register pages,
providers, and finally layout/dashboard shells (80). This is a different
concern from `FEATURE_FILE_PRIORITIES["Authentication"]` (used by the
generic `featureFilePriority()` for *initial* evidence ranking before
merging) — two separate ordering tables for authentication files that
happen to agree in spirit but aren't the same code path. If you're changing
how auth files get ordered, check which of the two functions your call site
actually goes through.

## See also

- Ch. 1 for `calculateSemanticImportanceBonus`/`calculateCriticalSemanticBonus`,
  the two `projectMap.ts` functions that also call `detectAuthenticationSemanticRole`
- Ch. 5 for where `FEATURE_SIGNALS` and its `importOnly`/`minimumDistinctFiles`
  flags come from
- Ch. 7 for `CapabilityInfo`, the input to `capabilitiesToFeatures`
- Ch. 8 for what `mergeFeature`/`mergeIntoFeatureList` actually does
- Ch. 10 for `detectFrontendPageFeatures`/`detectClientRouteFeatures`
