# 3. Framework & Route Detection

**Source:** `packages/cli/src/analyzers/detectors/`

This is the layer that turns a pile of scanned files into "this is a Next.js
+ Express monorepo with these routes, this database, and these external
services." It's four cooperating detectors, but they all lean on one shared
gatekeeper first.

## The gatekeeper: `isArchitectureSource()`

**Source:** `analyzers/graph/sourceScope.ts`

Before any detector looks at a file, almost all of them filter through this:

```ts
const NON_PRODUCTION_SEGMENTS = new Set([
  "__fixtures__", "__mocks__", "__tests__", "coverage",
  "demo", "docs", "example", "examples", "fixtures", "samples", "test", "tests"
]);

export function isArchitectureSource(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  if (segments.some((segment) => NON_PRODUCTION_SEGMENTS.has(segment))) return false;
  return !/\.(test|spec)\.[jt]sx?$/i.test(path);
}
```

This one function is why a repo with an `examples/todo-app/` folder doesn't
get self-detected as whatever framework that example happens to use — any
path segment matching the non-production set disqualifies the file from
framework, route, database, and critical-file scoring entirely. If DevMap
is ever misclassifying itself (or another project) because of a demo,
fixture, or sample folder, this is the first place to check.

## Framework detection: dependency-first, file-structure second

**Source:** `frameworkDetector.ts`

`detectFrameworks()` returns **up to two** frameworks — one frontend, one
backend — not a single winner. That's deliberate:

```ts
export function detectFrameworks(files: ScannedFile[]): DetectedFramework[] {
  // ...
  return [
    FRONTEND_FRAMEWORKS.find((framework) => detected.has(framework)),
    BACKEND_FRAMEWORKS.find((framework) => detected.has(framework)),
  ].filter(Boolean);
}
```

`FRONTEND_FRAMEWORKS = [nextjs, nuxt, sveltekit, astro, react, vue, svelte]`
and `BACKEND_FRAMEWORKS = [nestjs, fastify, express, koa]` are two separate
priority-ordered lists — first match within each list wins, so `nextjs`
still beats `astro` if a project somehow triggers both. A monorepo with a
Next.js app and an Express API in the same scan gets **one entry from
each list**, not just whichever was detected first. `detectFramework()`
(singular) is a thin wrapper that returns just the frontend winner, falling
back to backend, for callers that only want one label.

### Two-phase evidence, in priority order

**Phase 1 — `package.json` dependencies.** This runs first and is treated
as the highest-confidence signal. Straightforward cases check for the
obvious package (`next`, `nuxt`, `astro`, `fastify`, `@sveltejs/kit`,
`@nestjs/core`/`@nestjs/common`). Three cases are more careful:

- **React**: only added if `react` is a dependency *and* a real runtime
  marker is present (`react-dom`, `react-scripts`, or a Vite React plugin)
  *and* neither `next` nor `astro` is also present — otherwise a Next.js
  app (which obviously depends on `react`) would double-count as plain
  React.
- **Vue**: mirrors the same pattern against Nuxt (`vue` + a Vite Vue plugin
  or `vue-cli-service`, but not if `nuxt` is present).
- **Svelte**: same pattern against SvelteKit.

**Phase 2 — file structure heuristics**, used to catch projects where
`package.json` is missing or lives at a different monorepo level. Every
pattern here was chosen to avoid a specific false positive — the source
comments spell out the reasoning inline, and it's worth reading them
directly rather than just the regexes:

| Framework | File signal | Why it's safe as a standalone trigger |
|---|---|---|
| Next.js | `next.config.*`, or `app/**/{page,route}.*` / `pages/_app` | App/Pages Router conventions are Next-specific |
| Astro | `src/pages/*.astro` | Specific enough alone |
| Nuxt | `nuxt.config.*` | As specific as `next.config.*` |
| Vue | `App.vue` at root/`src/` | Specific enough alone |
| SvelteKit | `src/routes/**/+page.svelte` | The `+` prefix is SvelteKit-only |
| NestJS | `nest-cli.json` | As specific as the other config-file signals |
| Express | **only** as a narrow fallback — see below | `server.ts`/`app.ts` are common filenames in Next.js and vanilla Node too |

Express is the interesting one. `server.ts`/`app.ts` are such common
filenames across frameworks that a bare filename match would misclassify
plenty of non-Express projects. So the file-heuristic path is gated
**behind** the dependency check having already run:

```ts
// Express: ONLY add via file heuristic if express was already confirmed in
// package.json, OR — narrow fallback — if package.json is missing entirely.
```

When there truly is no parseable `package.json` at all, DevMap falls back
one level further and scans file *content* for an actual `express()` call
site or `require("express")`/`from "express"` — evidence specific enough
that a Next.js project's own `app.ts` utility file won't trigger it.

## Route detection: one detector per framework, merged

**Source:** `routeDetector.ts` (+ `nestRouteDetector.ts`)

`detectRoutes()` runs **every** detector whose framework was actually
detected and concatenates the results — same "don't force a single winner"
philosophy as framework detection, and for the same reason: a monorepo scan
can legitimately have both Next.js page routes and Express API routes.

Each framework gets its own convention-driven extractor:

- **Next.js** — App Router (`app/**/page|route.*`) and Pages Router
  (`pages/**`, skipping `_app`/`_document`), with the folder path anywhere
  in the file path (not anchored to the root) specifically so monorepo
  layouts like `apps/web/src/app/...` are matched.
- **Astro** — `src/pages/**`; `.astro`/`.md`/`.mdx` are pages, other
  `.ts/.js` files are endpoints exporting `GET`/`POST`/etc. (same
  export-based method detection as Next.js route handlers).
- **Nuxt** — root-level `pages/**.vue` (a documented v1 limitation: a
  customized `srcDir` in `nuxt.config` isn't accounted for).
- **SvelteKit** — the route unit is a **folder** under `src/routes/`, not a
  filename; only `+page.svelte` and `+server.[jt]s` count as routes.
- **NestJS** — the only detector implemented with a real AST (`ts-morph`),
  not regex. Controllers are decorator + class based
  (`@Controller('users')` scoping `@Get(':id')` on a method), which flat
  per-line regex genuinely cannot associate correctly — you need to know
  which class a decorated method belongs to. Known v1 limitations are
  called out directly in the source: the object form
  `@Controller({ path: '...' })` isn't handled, and
  `app.setGlobalPrefix()` isn't composed into paths.
- **Express** and **Fastify** — regex-based, and both solve the same
  harder problem: **router mounting**.

### Router/plugin mount resolution (Express & Fastify)

Both `detectExpressRoutes` and `detectFastifyRoutes` do a two-pass resolve
so that `app.use('/api/users', usersRouter)` composes into `/api/users/:id`
routes instead of just showing `/api/users` with no sub-paths:

1. **First pass** — collect direct route method calls per file, *and*
   collect mount statements (`app.use(prefix, identifier)` for Express;
   `app.register(plugin, { prefix })` for Fastify).
2. **Second pass** — for each mount, resolve `identifier` to an actual file
   using the **dependency graph** (`graph[mountFile]`, built in ch. 9) —
   only files the mounting file actually imports are candidates. Among
   those candidates, prefer one whose content contains the identifier name
   as a word boundary match; if that's ambiguous, fall back to "the only
   imported candidate that defines any route methods." If resolution stays
   ambiguous (more than one candidate matches), it's left unresolved rather
   than guessing.
3. Resolved sub-routes get their prefix composed via `composeMountPath()`;
   files absorbed into a mount are excluded from being *also* emitted as
   standalone routes (`mountedFiles` tracks this). An Express mount that
   can't be resolved at all still emits a placeholder `USE` route for the
   prefix, so the mount isn't silently invisible — Fastify's unresolved
   plugin case is simply dropped instead, since a plugin without routes
   genuinely isn't a route.

This mount resolution is the reason `detectRoutes()` optionally accepts the
file dependency graph as a third argument — without it, `resolveRouterTarget`
returns `undefined` immediately and mounted routers just don't expand.

## Database & external service detection

**Source:** `databaseDetector.ts`, `serviceDetector.ts`

`detectDatabase()` is a short signal table (`DATABASE_SIGNALS`) checked in
order — Prisma, Drizzle, Mongoose, Supabase, then raw-SQL drivers
(`pg`, `mysql2`, `better-sqlite3`, etc.) — first match wins, combining a
dependency check with optional path patterns (e.g. `schema.prisma`).

`detectExternalServices()` is structurally different: instead of a local
list, it pulls from the **signal registry** (ch. 5) —
`SERVICES` and `SOURCE_SERVICE_SIGNALS` — checking package names (both
declared dependencies *and* actually-imported specifiers, which catches
transitive-but-imported packages a stale `package.json` might miss) against
`SERVICES`, then scanning file content (lowercased) for provider-specific
string signals via `SOURCE_SERVICE_SIGNALS`. One detail worth knowing if
you're debugging a missing/phantom service: both scans explicitly exclude
the registry's own definition files
(`isServiceSignalDefinitionFile` skips `serviceDetector.ts`/
`featureDetector.ts` and anything under `analyzers/registry/`) — otherwise
DevMap analyzing its *own* source would detect itself as using every
service it merely has string literals for.

## See also

- Ch. 5 for the `SERVICES` / `SOURCE_SERVICE_SIGNALS` registry structure
- Ch. 9 for how the dependency graph that mount resolution relies on gets
  built
- Ch. 4 for entity extraction, which consumes `routes` as a fallback signal
  when no ORM schema is present
