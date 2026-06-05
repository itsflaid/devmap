# DevMap Progress

Last updated: 2026-06-05

## Current Status

DevMap is now set up as a working pnpm monorepo with a functional CLI foundation.
The project is still in Phase 1 from the roadmap: static analysis first, no AI
answering yet.

The CLI can currently:

- Initialize local DevMap config with `devmap init`.
- Analyze a project and save `.devmap/snapshot.json`.
- Detect source files, imports, entry points, critical files, and known external services.
- Answer a question in a static mode by finding likely relevant files.
- Run setup diagnostics with `devmap doctor`.

## Update Summary

### Workspace Setup

- Updated root `package.json` to match the documented monorepo workflow.
- Added root scripts:
  - `pnpm dev:cli`
  - `pnpm build:cli`
  - `pnpm test:cli`
- Marked the root package as private because this repository is a workspace root.
- Updated project metadata to use the MIT license and DevMap description.

### CLI Package Setup

- Renamed the CLI package to `@devmap/cli`.
- Added the `devmap` binary entry pointing to `./dist/index.js`.
- Added scripts:
  - `pnpm --filter @devmap/cli dev`
  - `pnpm --filter @devmap/cli build`
  - `pnpm --filter @devmap/cli test`
- Kept `commander` on version `^12.0.0` so the CLI stays compatible with the
  Node.js 18+ requirement from the docs.
- Added Node types to `tsconfig.json` so TypeScript understands `process`,
  `console`, and `node:*` imports.

### Git Hygiene

- Added `.gitignore` with:
  - `node_modules/`
  - `dist/`
  - `.devmap/`
  - `.env`
  - `.env.*`
  - `*.log`
- Removed the accidentally tracked `node_modules/.pnpm-workspace-state-v1.json`
  from Git tracking while keeping the local file intact.
- Added pnpm build-script policy for `esbuild`, which is needed by `tsx`.

## Implemented Files

### `packages/cli/src/index.ts`

Main CLI entry point.

Responsibilities:

- Creates the `devmap` command with Commander.
- Registers the MVP command surface:
  - `init`
  - `analyze`
  - `ask`
  - `doctor`
- Exposes `--version` and command help.

### `packages/cli/src/commands/init.ts`

Initial setup command.

Current behavior:

- Creates `~/.devmap/config.json`.
- Sets Groq as the default provider.
- Leaves API key empty for now because it is user secret data.
- Ensures `.devmap/` is ignored in the current project.

### `packages/cli/src/commands/analyze.ts`

Static project analysis command.

Current behavior:

- Scans the target project folder.
- Builds a project map.
- Prints project name, framework, file count, line count, entry points,
  critical files, and external services.
- Saves the snapshot to `.devmap/snapshot.json`.
- Supports `--deep` and `--fresh` flags at the CLI level.

The `--deep` output is still simple and static for now. The richer AI explanation
belongs to Phase 2.

### `packages/cli/src/commands/ask.ts`

Static question command.

Current behavior:

- Reads `.devmap/snapshot.json`.
- If no snapshot exists, runs a quick analyze first.
- Extracts keywords from the question.
- Scores files by matching keywords against file paths and exported symbols.
- Shows the top relevant files and a short preview.

This does not call AI yet. Phase 2 will replace the static answer section with
context-aware Groq output.

### `packages/cli/src/commands/doctor.ts`

Setup diagnostics command.

Current behavior:

- Shows Node.js version.
- Checks whether DevMap config exists.
- Checks whether API key is set.
- Checks whether a project snapshot exists.
- Warns when Groq API key is missing.

### `packages/cli/src/analyzers/fileScanner.ts`

Recursive filesystem scanner.

Responsibilities:

- Walks a project folder.
- Applies ignore rules.
- Reads file content.
- Returns path, absolute path, extension, size, line count, and content.

### `packages/cli/src/analyzers/filterEngine.ts`

Ignore-rule engine for scanning.

Currently ignores common generated or unsafe paths:

- `.git`
- `.devmap`
- `.next`
- `.turbo`
- `.vercel`
- `build`
- `coverage`
- `dist`
- `node_modules`
- `out`
- `.env*`
- logs, maps, lockfiles, and common binary assets

### `packages/cli/src/analyzers/frameworkDetector.ts`

Framework detector.

Current detection:

- Detects Next.js from `next` dependency or an `app/` folder.
- Detects Express from `express` dependency or common server entry files.
- Falls back to `unknown`.

### `packages/cli/src/analyzers/dependencyGraph.ts`

Import graph builder.

Responsibilities:

- Parses static `import`, `export from`, and `require()` specifiers.
- Resolves local relative imports.
- Supports TypeScript source resolution when imports use `.js` suffixes.
- Counts references between files.

### `packages/cli/src/analyzers/entryPoints.ts`

Entry-point detector.

Current logic:

- Prioritizes source files only.
- Detects known entry patterns like:
  - `page.tsx`
  - `layout.tsx`
  - `middleware.ts`
  - `server.ts`
  - `app.ts`
  - `index.ts`
  - `route.ts`
- Also includes source files that import other files but are not imported
  by another local file.

### `packages/cli/src/analyzers/serviceDetector.ts`

External service detector.

Current logic:

- Reads package dependencies and actual package imports.
- Detects known services such as Prisma, Supabase, Stripe, NextAuth, Midtrans,
  Resend, Cloudinary, Firebase, OpenAI, and Groq.
- Avoids false positives from documentation text or the detector source file itself.

### `packages/cli/src/analyzers/projectMap.ts`

Project map builder.

Responsibilities:

- Coordinates scanner, graph builder, framework detector, entry detector, and
  service detector.
- Creates the snapshot data shape used by `analyze` and `ask`.
- Stores per-file metadata:
  - hash
  - imports
  - exported symbols
  - line count

### `packages/cli/src/cache/fileHash.ts`

Small MD5 hashing utility.

Used to identify file content changes for snapshots and future cache behavior.

### `packages/cli/src/cache/snapshot.ts`

Snapshot persistence helper.

Responsibilities:

- Writes `.devmap/snapshot.json`.
- Reads existing snapshots.
- Provides the canonical snapshot path.

### `packages/cli/src/utils/config.ts`

Global config helper.

Responsibilities:

- Reads `~/.devmap/config.json`.
- Writes `~/.devmap/config.json`.
- Provides the canonical config path.

### `packages/cli/src/utils/gitignore.ts`

Git ignore helper.

Responsibilities:

- Ensures `.devmap/` exists in project `.gitignore`.
- Avoids duplicate `.devmap/` entries.

### `packages/cli/src/utils/output.ts`

Terminal output helper.

Responsibilities:

- Keeps command output consistent.
- Provides helpers for sections, steps, success messages, warnings, errors,
  and key-value rows.

## Verification

The following checks passed:

```bash
pnpm --filter @devmap/cli test
pnpm --filter @devmap/cli build
node packages\cli\dist\index.js --help
node packages\cli\dist\index.js init
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "where is the scanner logic"
node packages\cli\dist\index.js doctor
```

## Current Known Limitations

- AI integration is not implemented yet.
- `ask` currently only finds relevant files and previews them.
- `analyze --deep` currently prints a simple static breakdown.
- Framework support is still MVP-level: Next.js, Express, or unknown.
- The generated snapshot is local-only and intentionally ignored by Git.
- `devmap init` does not ask interactively for an API key yet.

## Recommended Next Steps

1. Add an interactive `devmap init` prompt for Groq API key input.
2. Add Groq provider abstraction and model routing.
3. Add prompt templates for `analyze` and `ask`.
4. Add tests with fixture projects for Next.js and Express.
5. Improve exported symbol parsing using a real TypeScript parser.
6. Add polished user-facing error handling so raw stack traces never leak.
