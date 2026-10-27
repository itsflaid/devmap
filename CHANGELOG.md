# Changelog

All notable changes to DevMap are documented in this file.

## [Unreleased]

### Fixed

- Route and feature detection (found by running the analyzer on real Fastify, SvelteKit and
  Express projects):
  - `@fastify/autoload` is read: the folder path under the autoloaded `dir` prefixes every
    route (`routes/api/tasks/index.ts` serves `/api/tasks`), plus the registration `prefix`,
    `routeParams` and `dirNameRoutePrefix: false`. Before, every route was relative to `/`
    and the resource was lost
  - A `:id` or `{id}` URL parameter is never a resource, so `/:id` no longer becomes a
    ":id Management" feature (a shared `isDynamicSegment` replaces three different checks)
  - In SvelteKit, Astro and Nuxt an `@` folder is a literal URL character (`/profile/@[user]`);
    only Next's App Router treats `@slot` as a parallel route
  - A snake_case table (`user_roles`) is the entity `UserRole`, not "User_role"
  - A one-letter URL segment (`app/s/[subdomain]`) no longer crashes the whole analysis
    (`singularize("s")` returned an empty string)

### Planned

- Go, Java, C# and PHP (PSR-4) import resolution, after JS/TS is mature
- Public benchmark results
- Feedback-driven fixes from the `0.2.0` beta

## [0.8.3] - 2026-10-25

### Added

- A "VS Code Extension" feature for files that use the `vscode` API

### Fixed

- Feature detection (found by running 0.8.2 on a snippet manager with a web app and an
  editor extension): behavioral capabilities such as Content Sharing, Social Interactions
  and Public Discovery no longer fuse a resource, its collections and every behavior into
  one feature named after a page ("Share" held Snippet and Collection)
- A CRUD capability (`Snippet Management`) keeps its resource: it can no longer be pulled
  into another resource's feature through a shared route, so Snippet and Collection stay
  separate with their own entry points
- In an API with 10 or more routes, a single read-only endpoint (`GET /api/sidebar`,
  `/api/user-stats`) is no longer a one-file "Management" feature; a small API keeps it
- Resources named with a dash or underscore are named like models (`user-stats` is
  `UserStat`, not "User-stat")

## [0.8.2] - 2026-10-25

### Fixed

- Feature detection (found by running 0.8.1 on a real chat app): vocabulary signals such as
  Rate Limiting, Background Jobs, Encryption and Caching no longer fuse with each other or
  with a Reminder feature just because they share a file, so each stays visible
- A page and an entity or capability that only share a component are separate features;
  they still merge through the same route resource, entity or name (`Payments` and
  `Payment Management` are the same name)
- A feature's entry point is the page closest to the root, never a file under `scripts/`,
  `tools/` or `bin/`
- Scoped package terms (`@sentry/nextjs`, `@trigger.dev`) now match imports of that package
- `node:crypto` alone no longer means Encryption (it is also used for hashing), and a single
  file importing `redis` is no longer Caching

## [0.8.1] - 2026-10-25

### Added

- A "Home" feature for the page served at `/`, kept separate so it does not absorb the
  features it links to; the landing-UI role feature is folded into it

### Changed

- Website SEO: canonical URLs, Open Graph and Twitter cards with a 1200x630 preview
  image, JSON-LD (`WebSite`, `SoftwareApplication`, `TechArticle`, breadcrumbs),
  `robots.txt` and `sitemap.xml`, and a descriptive title and description for the docs page
- npm package page: richer description and keywords, `homepage` points to the website,
  and the README opens with badges, a tagline and links to the docs (shown on npm from the
  next publish)

### Fixed

- Feature detection no longer reports features from generic words: `index` no longer
  means Search, `event` Analytics, `content`/`mdx` CMS, `push` Notifications, and a
  service worker is not Background Jobs. `blob` only counts as a package import.
- Tool-generated folders (`.adonisjs/`, `.github/`, ...) and `e2e/` / `cypress/` folders
  no longer create features or become entry points
- `robots.txt`, `sitemap.xml`, `healthcheck`, `revalidate`, `trpc` and auth verbs such as
  `login` no longer produce "<name> Management" features
- Pages are named like pages: `settings` stays "Settings", `scheduled-posts` becomes
  "Scheduled Post", `status` is no longer "Statu"
- A component reachable from several pages is no longer claimed by the first page
- Two different pages are never merged through a shared component, and a signal such as
  Authentication no longer fuses the login, join and notes pages into one feature named
  after whichever sorts first (this hid "Notes" in the Remix Indie Stack)
- "CLI Commands" requires a real command-line program (shebang, `process.argv` or a CLI
  library) instead of any `src/main.ts`, `src/index.ts` or `commands/` folder

## [0.8.0] - 2026-10-23

### Added

- Framework detection and route mapping for Angular (`Routes` arrays, `loadComponent`,
  `children`, lazy `loadChildren` into routes files and NgModules), SolidStart,
  Qwik City, Elysia (`prefix`, `group`, `guard`, `.use` plugins across files), Koa
  (`@koa/router` / `koa-router` / `koa-route`, nested routers, `koa-mount`) and
  AdonisJS (v4–v6 route files, groups, `resource()`)
- Route paths and prefixes held in constants, `as const` objects, enums and template
  strings are resolved across files by the new Angular, Elysia, Koa and Adonis detectors
- Client-side router detection: React Router `<Routes>`/`<Route>` JSX and
  `createBrowserRouter` object trees, Vue Router route arrays, TanStack Router
  code-based routes (`getParentRoute`) and `svelte-spa-router` maps, including
  route tables kept in their own file and lazy `import()` pages
- Hono apps built by factory functions (`() => new Hono()`,
  `createFactory().createApp()`) and helpers that register routes on an app
  they are given
- Next.js routes: private `_folders`, intercepting routes, `@slot` pages and
  the `sitemap`/`robots`/`manifest` metadata routes are normalized

### Changed

- Critical-file ranking no longer keys on devmap's own file names. Files named
  router, controller, orchestrator, engine, dispatcher, scheduler, pipeline,
  registry or kernel, and non-index files that import eight or more local
  modules, get the execution-responsibility bonus

## [0.7.0] - 2026-10-22

### Added

- Framework detection and route mapping for Remix (v2 flat routes, folder
  routes, `remix-flat-routes`), React Router v7 framework mode (`app/routes.ts`
  with `route`, `index`, `layout`, `prefix` and `flatRoutes`), TanStack Router
  and TanStack Start (file routes, Start server handlers as API routes), Expo
  Router (`app/` and `src/app/`, groups, dynamic segments, `+api` routes) and
  Hono (`new Hono()` chains, `basePath`, `route()` mounts across files, `on`,
  `@hono/zod-openapi`)
- These route detectors find their own projects, so a monorepo now lists the
  routes of each frontend (Next + Expo + TanStack Start, say) instead of only
  the framework that won the single frontend slot
- Aliases declared only in bundler config are read without running it:
  `resolve.alias` in Vite, Vitest, webpack, Rollup and Astro (under `vite`),
  `kit.alias` in svelte.config, `alias` in nuxt.config and
  `config.resolve.alias[...] =` in a next.config webpack hook; object and
  `[{ find, replacement }]` forms, `path.resolve(__dirname, ...)`,
  `fileURLToPath(new URL(...))`, template strings and constants
- Entry points: React Router `app/routes.ts` and route modules, Remix route
  modules, TanStack `__root`/`router`, Expo `_layout`

### Changed

- Generated files (`routeTree.gen.ts`, `*.generated.ts`) no longer count as
  importers, so the files they index still show up as entry points, and they are
  never entries themselves

### Fixed

- A Remix folder route (`app/routes/blog/route.tsx`) is no longer mistaken for a
  Next.js App Router route handler

## [0.6.0] - 2026-10-20

### Added

- JS/TS monorepos: imports of workspace packages by name (`@acme/ui`,
  `@acme/ui/button`) now become dependency edges, resolved through the
  package's `exports` (conditions and `*` patterns), `source`/`module`/`main`
  and file layout; built output (`dist/`, `lib/`) is mapped back to `src/`
- package.json `imports` (`#internal/*`) subpath imports resolve inside the
  nearest package; bundler query suffixes (`./x.ts?raw`) are ignored
- Nuxt: `~`, `@`, `~~`, `@@`, `#shared`, `#server` aliases (Nuxt 3 root layout,
  Nuxt 4 `app/`, custom `srcDir`) and auto-import edges for components,
  composables, utils, `shared/`, `server/utils/` and Pinia stores
- Entry points are read from package.json (`bin`, published `main`, script
  targets) and framework conventions (Nuxt `app.vue`/`pages`/`server/api`,
  SvelteKit `+page`/`+server`, Remix `root`/`entry.*`, Next Pages Router)
- CommonJS exports (`module.exports = { ... }`, `exports.x = ...`) are read as
  exports and symbols
- Database detection recognizes TypeORM, Sequelize, MikroORM, Kysely, Knex,
  Firebase, Convex, PocketBase, MongoDB, Neon/Vercel Postgres, libSQL and
  Redis, and reports secondary stores as `database.additional`

### Fixed

- A `models/` or `schemas/` folder no longer makes a project "Mongoose";
  those folders only count once `mongoose` is installed
- tsconfig/jsconfig files in root-level folders such as `frontend/` are found,
  not only the ones under `apps/` and `packages/`
- On real projects this cuts "isolated" source files from 43% to 14%
  (create-t3-turbo) and from 87% to 8% (Nuxt app), so critical files and
  change impact are no longer computed from a near-empty graph

## [0.5.0] - 2026-10-17

### Fixed

- `scanFiles` no longer deadlocks (exit code 13, no output) on projects with
  50 or more directories open at once, and skips dangling symlinks and
  unreadable subdirectories instead of aborting the scan
- CRUD resources (`orders`, `users`, ...) are no longer merged into a single
  feature: capabilities are deduplicated by kind and name, and the feature
  merger refuses to union distinct entities
- Import graph: tsconfig/jsconfig aliases now work with comments and trailing
  commas, `extends`, `baseUrl`, project `references`, workspace sub-packages
  and SvelteKit `$lib`; exact aliases no longer capture longer specifiers
- Import graph: duplicate and self edges removed, dynamic `import()`,
  `import x = require()` and `import("x")` types create edges, `.jsx`/`.mts`/
  `.cts` specifiers resolve, and `../x` above the project root no longer
  matches root files
- Nested `.gitignore` files are honoured, binary extensions match
  case-insensitively, `.env` matching is by file name (`.envrc` is kept), and
  the ignore cache is reset on every scan
- `package.json` with a UTF-8 BOM is parsed; `@vue/cli-service` marks a Vue
  app; npm's default `"main"` no longer turns an Express/Next app into a
  library with an unknown framework
- Entry points no longer list barrel `index.ts` files that the app imports;
  only production code counts as an importer
- `src/features/demo` and `src/docs` are analysed as source; sample and docs
  folders are only excluded at repo or workspace level
- Routes: `pages/index` is `/`, `export { handler as GET }` and
  `export const { GET } = handlers` report methods, Nuxt `server/api` and
  `server/routes`, Express mounts with middleware, and multi-level routers
- File scope: root `test/` folders are tests, `.svelte`/`.vue`/`.astro` and
  SvelteKit `+page`/`+layout` files are UI, not API
- Project fingerprint no longer depends on the machine locale

### Added

- Import and symbol extraction for Python, Ruby, PHP, Go, C# and Java
  (previously always empty, with bogus symbols from docstrings), plus graph
  edges for Python imports, Ruby `require_relative` and relative PHP
  `require`/`include`

### Changed

- Dependencies updated within their semver ranges (`ignore`, `p-limit`,
  `tsx`, `@types/node`, and web tooling)

## [0.4.1] - 2026-10-03

### Added

- Analyzer pipeline loading spinners in `createProjectMap`: scanning,
  analyzing, dependency mapping, entity/feature extraction, and optional
  AI domain inference, with TTY animation, non-TTY fallback, and silent
  JSON output

### Changed

- Welcome banner trimmed to the big wordmark plus separator; removed the
  `[ DEVMAP CLI ]` label and capabilities line
- `devmap analyze` drops the duplicate scanning line now covered by the
  pipeline spinner

## [0.4.0] - 2026-09-13

### Added

- tRPC router and procedure detection
- Encryption/crypto signal descriptor in the feature registry
- Feature reconciliation diagnostics in project map and devmap doctor

### Changed

- Authentication semantic-role detection participates in the same
  feature candidate/reconciliation pipeline as every other detector

## [0.3.5] - 2026-09-13

### Fixed

- Entity feature detection no longer lets infrastructure or true-child
  entities starve out real domain entities when a Prisma schema has more
  than 8 relation-bearing models
- Page-feature ownership no longer inflates through barrel/re-export files,
  preventing unrelated components from being attributed to the wrong page
- Feature reconciliation no longer treats high fan-in shared files as
  sufficient evidence to merge unrelated feature candidates

## [0.3.0] - 2026-08-26

### Added

- Custom OpenAI-compatible provider support: `devmap init` now offers any
  self-hosted or third-party OpenAI-compatible endpoint with a base URL prompt
  (default `http://localhost:20128/v1`) and a model list fetched from the
  endpoint's `/models`
- Data-driven provider registry centralizing per-provider behavior and
  metadata, replacing hardcoded Groq/OpenRouter branching across config, init,
  config, doctor, and client creation
- Automated npm release: tag-pushed `v*.*.*` tags build, test, and publish via
  npm OIDC trusted publishing (`.github/workflows/publish.yml`)

### Changed

- Package description and README copy reframe DevMap as a persistent, reusable
  context layer for humans and AI agents
- Groq and OpenRouter clients share one SSE streaming/parsing helper with
  identical external behavior; custom endpoints get distinct connection-error
  wording
- Non-interactive init on providers without automatic model selection now
  fails clearly instead of saving an unusable `model: "auto"`

## [0.2.0] - 2026-08-18

### Added

- OpenRouter provider support with interactive provider selection, API-key
  validation, streaming responses, and user-selected free or paid models
- `ts-morph` analysis for JavaScript and TypeScript behind a normalized
  analyzer registry with heuristic and fallback analyzers
- Lightweight `.devmap/index.json` and per-feature navigation maps for agents
- `devmap map` for full dependency-graph navigation
- `devmap flow` with curated and AI-narrated flow documents
- `devmap explain` for file, feature, and function explanations

### Removed

- `devmap ask` (replaced by `devmap explain` and `devmap flow`)

### Changed

- Root-manifest CLI/library detection no longer blanks out a correctly
  detected workspace framework in mixed monorepos, and the minimum supported
  Node.js version is stated precisely as 22.12 to match dependency engines
- Snapshot metadata now separates the primary framework from frameworks found
  in workspace packages, prioritizes root documentation, and emits semantic
  file purposes and provider-neutral AI flows
- Project classification now supports multiple simultaneous project types —
  a workspace can be both a `node-cli` and a `web-app` at once — and demo,
  example, and sample projects are excluded from analysis
- Feature and service detection vocabulary is centralized in a domain registry
  (`analyzers/registry/`) so DevMap no longer detects itself as using the
  services it merely documents
- `devmap init` defaults OpenRouter to `openrouter/free` on Enter and explains
  how to change the stored model with `devmap config model <model-id>`
- Feature detection now separates documentation, landing UI, CLI commands,
  analysis, snapshot, and AI roles before assigning technical features
- Generated agent guidance now uses index-first navigation and treats the full
  snapshot as a last-resort archive

## [0.1.0] - 2026-06-15

Initial early beta release.

### Added

- `devmap init` with Groq key validation and safe project setup
- Static analysis for Next.js and Express projects
- Versioned reusable snapshots with stale and corrupt-state detection
- Route, dependency, entry point, database, feature, and service detection
- `devmap analyze` with cached AI architecture interpretation
- Command-based Groq model routing and configurable model overrides
- Streaming human-readable AI responses
- Machine-readable `--json` output for all MVP commands
- `devmap doctor` diagnostics
- Safe `DEVMAP.md` and `AGENTS.md` integration
- Cross-platform CI for Windows, macOS, and Linux on Node.js 22 and 24
- Packed-package end-to-end tests for Next.js and Express fixtures

### Security And Privacy

- Local persisted configuration and snapshots are validated before use
- Context file reads reject traversal and symlink escape outside project root
- Secret files and generated directories are excluded from scanning
- Raw stack traces and API keys are not printed during normal failures

### Known Limitations

- Supported stacks are limited to Next.js and Express
- Groq is the only AI provider
- Token-efficiency benchmarks are not yet published
- External user feedback will be collected after the beta is published

[Unreleased]: https://github.com/itsflaid/devmap/compare/v0.8.3...HEAD
[0.8.3]: https://github.com/itsflaid/devmap/releases/tag/v0.8.3
[0.8.2]: https://github.com/itsflaid/devmap/releases/tag/v0.8.2
[0.8.1]: https://github.com/itsflaid/devmap/releases/tag/v0.8.1
[0.8.0]: https://github.com/itsflaid/devmap/releases/tag/v0.8.0
[0.7.0]: https://github.com/itsflaid/devmap/releases/tag/v0.7.0
[0.6.0]: https://github.com/itsflaid/devmap/releases/tag/v0.6.0
[0.5.0]: https://github.com/itsflaid/devmap/releases/tag/v0.5.0
[0.4.1]: https://github.com/itsflaid/devmap/releases/tag/v0.4.1
[0.4.0]: https://github.com/itsflaid/devmap/releases/tag/v0.4.0
[0.3.0]: https://github.com/itsflaid/devmap/releases/tag/v0.3.0
[0.2.0]: https://github.com/itsflaid/devmap/releases/tag/v0.2.0
[0.1.0]: https://github.com/itsflaid/devmap/releases/tag/v0.1.0
