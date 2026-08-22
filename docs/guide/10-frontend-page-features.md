# 10. Frontend Page Features

**Source:** `packages/cli/src/analyzers/detectors/frontendFeatureDetector.ts`

A page-driven app can have real, user-facing features with **zero database
presence** — a Quran reader page, a static FAQ section, a settings screen.
Entity-based feature detection (ch. 6) would never surface these on its
own. This detector exists specifically to fill that gap, for both
file-based routing (Next.js/Nuxt/SvelteKit) and client-side routing
(React Router/Vue Router/svelte-spa-router).

## Why this has to run unconditionally, not as a fallback

The doc comment on `detectFrontendPageFeatures` explains a real bug this
fixes, worth reading verbatim because it's a good example of how the
extractor fallback chain (ch. 4) can produce a subtly wrong result:

> Entity-derived features only run as a fallback chain that stops at the
> first non-empty source. A project with even one Prisma model (e.g. a
> NextAuth `Session` table) never reaches route-hint fallback, so
> page-only features like "Quran" or "Dzikir" — which have zero database
> presence — never surfaced at all.

In other words: a project can have a database (so `extractEntities`
returns non-empty at the Prisma tier and never falls through to
route-hints), while still having whole sections of the app that are pure
frontend pages with no corresponding table. This detector runs **every
time**, unconditionally, merging alongside whatever entity/capability
features already exist — it's not part of the extractor fallback chain at
all.

## Grouping by top-level path segment

Both detectors (file-based and client-side) follow the same shape: group
matching routes by their **first path segment**, treat each group as a
candidate feature, name it via the same `singularize()` helper from ch. 4
(`"reports"` → `"Report"`), and find which files that segment "owns" via a
shared reachability rule.

**`detectFrontendPageFeatures()`** groups page-kind routes (ch. 3) by
segment, skipping the root path, purely-dynamic segments (`/[locale]`),
and a short exclusion list — `NON_FEATURE_PAGE_SEGMENTS` (`auth`, `oauth`,
`callback`, `api`, `static`, `assets`, `public`). The comment explicitly
contrasts this with the *wider* exclusion list capability detection uses
(`NON_RESOURCE_SEGMENTS`, ch. 7): pages named `"settings"` or `"profile"`
are real, meaningful destinations a user navigates to, so they're kept
here even though the same words are excluded as CRUD *resource* names
elsewhere. Same-looking problem, different correct answer depending on
context.

## Client-side routing: five regex patterns, one per convention

**`findClientRoutes()`** doesn't have folder conventions to lean on — for
an SPA, routes are defined *in code*, as JSX or config objects. Since
there's no framework-provided AST for "a route definition" the way there
is for Next.js file conventions, this is pattern matching over five known
shapes, documented directly in the constants:

```ts
const CLIENT_ROUTE_PATTERNS = [
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?element=\{<(\w+)/g,       // React Router JSX (element)
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?component=\{?(\w+)/g,    // React Router JSX (component)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?element:\s*<(\w+)/g,            // React Router data config (element)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?Component:\s*(\w+)/g,           // React Router data config (Component)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*(\w+)\s*[,}]/g,    // Vue Router (identifier form)
];
```

Plus two more handled separately: a **lazy-import Vue Router** form
(`component: () => import("./views/About.vue")`, captured as a relative
specifier rather than an identifier) and **svelte-spa-router**'s object-map
form (`{ '/about': About }`) — the latter is gated behind actually finding
a `from "svelte-spa-router"` import in the same file first, since a bare
`{ "/path": Identifier }` shape is far too generic to trust as a route
definition on its own.

All of this is explicitly documented as pattern-matching common
conventions, not a JSX/AST parser — same trade-off philosophy as the SQL
table-name extraction in ch. 4. One named limitation: patterns assume
`path` appears before `element`/`component` in the JSX attributes, which
is idiomatic but not enforced by the framework — reversed attribute order
is a known v1 miss.

### Resolving an identifier or specifier back to a real file

A route match only gives you an identifier (`"QuranPage"`) or, for the
lazy-import form, a relative specifier (`"./views/About.vue"`) — neither
is directly a file path. Two different resolvers handle the two cases:

- **`resolveRouteComponentFile()`** — for identifiers: look up what the
  defining file actually imports (`fileGraph[route.definedIn]`, an edge
  the dependency graph, ch. 9, already computed) and find the import whose
  filename stem matches the identifier case-insensitively. This is a
  lookup against already-resolved data, not new import resolution.
- **`resolveRouteSpecifierFile()`** — for the Vue Router lazy form: the
  specifier is a real relative import path, so it gets normalized against
  the defining file's directory and checked against the same extension/
  index-file candidate list `dependencyGraph.ts` uses for regular imports
  (ch. 9) — necessarily a separate implementation here since this path
  never goes through `buildDependencyGraph`'s import scanning at all (it's
  inside a route-config object literal, not a top-level `import`
  statement).

## Ownership: a stricter rule than "reachable"

**`collectOwnedFiles()`** is the interesting part, and it's shared
verbatim between both detectors (file-based and client-side) since the
question is identical either way: given a set of seed files (the route/page
files themselves), which other files does this feature actually **own**,
as opposed to merely **use**?

The rule: a reachable file counts as owned only if **every** file that
imports it is *also* within the reachable set:

```ts
const hasExternalReferrer = referrers.some((referrer) => !reachable.has(referrer));
if (!hasExternalReferrer) owned.add(file);
```

A component imported only by this feature's pages is owned. A shared
`Button` component imported by ten different pages across the app is
**not** — even though it's technically reachable from this feature's
entry point, it has an "external referrer" (every other page that also
imports it), so it stays out. The doc comment states the design bias
explicitly: false-negative (a feature looking smaller than it really is)
is preferred over false-positive (a feature claiming a shared file it
doesn't actually own) — an under-scoped feature map is misleading in a
minor way; an over-scoped one that claims shared infrastructure is
misleading in a way that actively confuses "what would I need to touch to
change this feature."

## See also

- Ch. 6 for where these results get merged (`detectFeatures`'s fourth
  evidence source)
- Ch. 9 for `buildReverseGraph`, reused here for the ownership check
- Ch. 4 for `singularize()`, shared with entity/route-hint naming
- Ch. 7 for why the page-segment exclusion list here is deliberately
  narrower than capability detection's resource exclusion list
