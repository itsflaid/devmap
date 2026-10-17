# Changelog

All notable changes to DevMap are documented in this file.

## [Unreleased]

### Planned

- Public benchmark results
- Feedback-driven fixes from the `0.2.0` beta

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

[Unreleased]: https://github.com/itsflaid/devmap/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/itsflaid/devmap/releases/tag/v0.3.0
[0.2.0]: https://github.com/itsflaid/devmap/releases/tag/v0.2.0
[0.1.0]: https://github.com/itsflaid/devmap/releases/tag/v0.1.0
