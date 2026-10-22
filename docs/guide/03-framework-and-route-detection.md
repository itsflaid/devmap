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
obvious package (`next`, `nuxt`, `astro`, `fastify`, `hono`, `@sveltejs/kit`,
`@nestjs/core`/`@nestjs/common`). The React-based meta-frameworks are keyed on
the package that makes them a framework rather than a library: `@remix-run/*`
(except `@remix-run/router`, which is React Router's own internals) for Remix,
`@react-router/dev` for React Router v7 framework mode (plain `react-router-dom`
is a client-side router and stays "React"), `@tanstack/react-start` for TanStack
Start, `@tanstack/react-router` for TanStack Router and `expo-router` for Expo.
`@solidjs/start` marks SolidStart, `@builder.io/qwik-city` (or `@qwik.dev/router`) Qwik City,
and `@angular/core` together with `@angular/platform-browser` or `@angular/cli`
Angular (a library that only lists `@angular/core` is not an app). On the backend
`elysia`, `koa` and `@adonisjs/core` are keyed the same way.
They sit before plain `react` in the frontend priority list because they all
ship React too. Three cases are more careful:

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
| Remix | `remix.config.*` | Specific to Remix v1/v2 |
| React Router v7 | `react-router.config.*` | Specific to framework mode |
| TanStack Router | `routeTree.gen.ts`, `tsr.config.json` | Written by the router plugin |
| Expo Router | `app.json` / `app.config.*` naming `expo-router` | The config plugin is how Expo Router is enabled |
| Angular | `angular.json` | The workspace file only Angular writes |
| AdonisJS | `adonisrc.ts` / `.adonisrc.json` | The rc file only AdonisJS writes |
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

**Source:** `routeDetector.ts` (+ one module per newer framework: `nestRouteDetector.ts`, `remixRouteDetector.ts`, `reactRouterRouteDetector.ts`, `tanstackRouteDetector.ts`, `expoRouteDetector.ts`, `honoRouteDetector.ts`, `clientRouteDetector.ts`, `solidStartRouteDetector.ts`, `qwikRouteDetector.ts`, `angularRouteDetector.ts`, `elysiaRouteDetector.ts`, `koaRouteDetector.ts`, `adonisRouteDetector.ts`; shared helpers in `routeUtils.ts`, `astUtils.ts` and `moduleBindings.ts`)

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
- **Remix** (`remixRouteDetector.ts`) — v2 flat routes under `app/routes/`
  (`notes.$noteId.tsx` → `/notes/:noteId`, `_auth.login.tsx` pathless layouts,
  `posts_.$id.tsx` un-nesting, `($lang)` optional segments, `files.$.tsx`
  splats, `sitemap[.]xml.tsx` escapes) plus folder routes (`blog/route.tsx`) and
  `remix-flat-routes` `+` folders. A module with no default export is a resource
  route and is listed as an API route with `GET` (loader) / `POST` (action). A
  layout that has an index sibling at the same URL is listed once, as the index.
- **React Router v7** (`reactRouterRouteDetector.ts`) — reads `app/routes.ts`
  from the syntax tree, so `route()`, `index()`, `layout()`, `prefix()`,
  nesting, spreads and arrays held in variables compose the way React Router
  composes them; `flatRoutes()` hands off to the Remix file-name rules.
- **TanStack Router / Start** (`tanstackRouteDetector.ts`) — each file under
  `routes/` declares its own id (`createFileRoute('/posts/$postId')`), which is
  what gets listed (the file name is only a fallback). Pathless `_layout`
  segments, `(group)` folders and trailing `_` are applied, `.lazy` files are
  merged with their route, the generated `routeTree.gen.ts` is ignored, and
  Start's `server: { handlers: { GET, POST } }` (or
  `createServerFileRoute().methods()`) makes an API route with those methods.
  Code-based routing (`createRootRoute()` / `createRoute({ getParentRoute })`)
  is read by the client router detector below.
- **Expo Router** (`expoRouteDetector.ts`) — `app/` or `src/app/` of every
  project that depends on `expo-router` (or the `root` set in `app.json`).
  `(group)` folders add no URL, `[id]` / `[...rest]` are kept as written,
  `_layout`, `+html` and `+not-found` are not screens, `hello+api.ts` is an API
  route with its exported methods, and `about.web.tsx` is the same screen as
  `about.tsx`.
- **Hono** (`honoRouteDetector.ts`) — read from the syntax tree by following
  values the way the runtime builds them: one app per `new Hono()`, chains
  (`app.get().post()`), `basePath()`, `app.route('/book', book)` (also when
  `book` is imported from another file), `app.on(['PUT','DELETE'], ...)`,
  constrained params (`:id{[0-9]+}` is shown as `:id`) and `@hono/zod-openapi`
  `app.openapi(createRoute({ method, path }), ...)`. Only apps nobody mounts are
  walked from the top, so each endpoint appears once under its full URL.
  A function that returns an app (`const create = () => new Hono()`) is one app
  per call, `createFactory().createApp()` is followed, and a helper that
  registers routes on an app it is given (`registerAuth(app.basePath('/auth'))`)
  is replayed at each call site with that app's prefix.
- **Client-side routers** (`clientRouteDetector.ts`) — apps that declare their
  routes in code instead of the file system. React Router `<Routes>` /
  `<Route>` JSX trees (including wrapper components such as route guards),
  `createBrowserRouter` / `createHashRouter` / `createMemoryRouter` object
  trees, Vue Router `routes: [...]` (`RouteRecordRaw`, lazy `import()`,
  nested children, named views; redirects are not pages), TanStack Router
  code-based routes composed through `getParentRoute`, and `svelte-spa-router`
  path maps. A route table kept in its own file is found by its types or
  router imports, the listed file is the page component the route renders
  (resolved through aliases), and an array of `{ path, name }` that is not a
  route table (a nav menu) is ignored. Pathless layouts are dropped when an
  index route shares their URL.
- **Next.js normalization** — private `_folders`, intercepting routes
  (`(.)photo`, `(..)photo`), `@slot` parallel routes (listed once) and the
  metadata routes `sitemap`, `robots` and `manifest` are handled.

  Remix, React Router, TanStack, Expo and Hono find their own projects (a
  `routes.ts` that imports `@react-router/dev/routes`, a `createFileRoute()` call,
  a package that depends on `expo-router`, a `new Hono()` imported from `hono`)
  and run whether or not their framework won the single-winner slot, so the
  second frontend of a monorepo still gets its routes.
- **SolidStart** (`solidStartRouteDetector.ts`) — `src/routes/` of every project
  that depends on `@solidjs/start`. `(group)` folders and `(group)name` parts add
  no URL, `[id]` / `[...rest]` / `[[optional]]` are kept as written, `users.tsx`
  beside `users/` is a layout that gives way to `users/index.tsx`, and a module
  exporting `GET` / `POST` / ... is also an API route with those methods.
- **Qwik City** (`qwikRouteDetector.ts`) — a folder under `src/routes/` is a URL
  when it holds an `index` file: `index.tsx` / `.mdx` are pages (`index@admin.tsx`
  is the same URL in another layout), `index.ts` exporting `onGet` / `onPost` /
  `onRequest` is an endpoint, and `layout.tsx`, `plugin@*.ts` are not routes.
- **Angular** (`angularRouteDetector.ts`) — `Routes` arrays, whether passed to
  `provideRouter`, `RouterModule.forRoot` or only exported. `children` and
  `loadChildren` compose their path onto the parent's, and `loadChildren` is
  followed into the routes file (`.then(m => m.ADMIN_ROUTES)`) or the routing
  module of an NgModule (`RouterModule.forChild`). `loadComponent` and component
  imports locate the listed file, redirects are not pages, and `**` is listed.
  Paths held in constants, `as const` objects and enums are resolved across files.
- **Elysia** (`elysiaRouteDetector.ts`) — one instance per `new Elysia()`:
  `prefix`, `group()`, `guard()`, `.use(plugin)` (an instance imported from another
  file, or a `(app) => app.get(...)` function plugin), `all`, `route()` and `ws()`.
  A mounted plugin is walked from its mount, so each endpoint appears once under
  its full URL.
- **Koa** (`koaRouteDetector.ts`) — `@koa/router` / `koa-router` instances (also
  `require("koa-router")()`): `prefix` (option or `.prefix()`), array and named
  paths, `del`, `router.use('/p', child.routes())`, `koa-mount`, and `koa-route`
  helpers. A router that only the application mounts (`app.use(router.routes())`)
  is a root.
- **AdonisJS** (`adonisRouteDetector.ts`) — `router.get/post/...`, `route()`,
  `on().render()`, `group(...).prefix()` (nested), and `resource()` expanded to its
  REST actions minus `apiOnly()`, `only()` and `except()`. v6, v5 and v4 route files
  are read. The listed file is the controller (`[Controller, 'method']`,
  `'#controllers/x.method'` or a v5 `'XController.method'` string); a route is a
  page when its action renders a view or Inertia response and an API route otherwise.
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
