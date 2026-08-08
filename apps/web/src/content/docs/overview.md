---
title: "Devmap Docs"
---

# Devmap Docs

## Quick Start

```bash
npm install -g devmap
# or
pnpm add -g devmap
# or run without installing
npx devmap analyze
```

Requirements: Node.js 18+

```bash
devmap init
devmap analyze
```

---

## Supported frameworks

DevMap detects your stack from `package.json` first (highest confidence),
and falls back to file-structure heuristics only when that's missing or
incomplete.

**Full support** — framework detection *and* route mapping:
- Next.js (App Router and Pages Router)
- Express
- Fastify
- Nest

**Detected, no route mapping yet** — DevMap recognizes the framework and
indexes files/dependencies, but doesn't map routes for it:
- React (Create React App, Vite)
- Astro
- Vue
- Svelte

**Databases & ORMs** — detected via dependency + schema/config file:
- Prisma, Drizzle, Mongoose, Supabase
- Raw SQL: PostgreSQL (`pg`), MySQL (`mysql2`), SQLite (`better-sqlite3`)

**Anything else** (Laravel, Django, Go, ...): DevMap still
scans your files, dependencies, and import graph — you just won't get
framework-specific route detection. `analyze` will report the framework
as `unknown` rather than guessing wrong.

Don't see your framework? [Open an issue](https://github.com/itsflaid/devmap/issues) —
route detectors are the easiest part of the codebase to extend.

## Privacy & data

**Without an API key configured:** DevMap runs 100% locally. Zero network
calls. `init`, `map`, and `doctor` never send project data — `map` never
touches the network; `init` only validates your key against the provider's
API, `doctor` only checks connectivity.

**With an API key configured**, here's exactly what leaves your machine,
command by command:

| Command | Sends to your AI provider | Sends raw source code? |
|---|---|---|
| `analyze` | File paths, export/import names, feature references — structural metadata only | No |
| `flow` | The traced step list (files + purpose labels), for narration | No |
| `explain <target>` | The specific file or feature you asked about | Yes — just that one target |
| `onboarding` | Nothing — pure static analysis (reads the snapshot locally) | No |
| `init`, `map`, `doctor` | Nothing project-related | No |

Your whole codebase is never bulk-uploaded to generate the snapshot —
only `explain` sends actual file contents, and only for the single
file or feature you named in the command.

---

## 1. Setup — `devmap init`

Run once per machine/project.

- Choose provider: **Groq** (free-tier, default) or **OpenRouter**
- Enter API key — or set `GROQ_API_KEY` / `OPENROUTER_API_KEY` as an env var to skip the prompt entirely
  - Groq keys: console.groq.com/keys
  - OpenRouter keys: openrouter.ai/keys
- Pick a model — Groq shows a live model list to choose from; OpenRouter defaults to `openrouter/free`, or type any model ID
- Saves config to `~/.devmap/config.json`
- Creates `.devmap/`, adds it to `.gitignore`
- Generates `DEVMAP.md`, offers to update `AGENTS.md` (never overwrites — asks before appending)

---

## 2. Analyze your project — `devmap analyze [target]`

The core command. Scans the project and builds `.devmap/snapshot.json` — detects framework, routes, API routes, entry points, critical files, dependencies, external services, and generates feature-level navigation.

```bash
devmap analyze
devmap analyze --fresh     # ignore cache, re-run from scratch
devmap analyze --json      # machine-readable output
```

Generates:

| File | Purpose |
|---|---|
| `.devmap/index.json` | Compact entry point for AI agents |
| `.devmap/features/*.json` | One file per detected feature |
| `.devmap/snapshot.json` | Full project intelligence — source of truth |

---

## 3. Using DevMap with AI agents

This is the core value prop: instead of an agent exploring the repo cold every session, it reads structured context DevMap already computed.

Recommended reading order for agents (also written into `DEVMAP.md` / `AGENTS.md`):

```
.devmap/index.json → feature map → relevant source files → snapshot.json (last resort)
```

Works with Claude Code, OpenAI Codex, Gemini CLI, Cursor, GitHub Copilot, and any agent that can read files or consume `--json` output.

---

## Why not just point my AI agent at the repo?

Fair question — most coding agents can already read your repo directly.
A few reasons teams still run `devmap analyze` first:

- **Reusable across sessions and tools.** The snapshot is a file on disk.
  Every new agent session — or a teammate's session, or a different
  agent entirely — starts from it instead of re-exploring the repo cold.
- **Provider-agnostic.** The snapshot isn't tied to one vendor's
  indexing. Switch agents or providers and the context comes with you.
- **Deterministic.** Static analysis produces the same structural map
  every time. An agent re-exploring a repo from scratch can come back
  with a slightly different picture session to session.
- **Works without AI at all.** `devmap map` and `devmap analyze` (no key
  configured) are pure static analysis — useful on their own, with or
  without an agent in the loop.
- **Cheaper cold starts.** An agent exploring a large repo blind burns
  tokens just finding its footing. DevMap computes that once; every
  session after reads the answer instead of re-deriving it.

None of this replaces your agent — DevMap hands it a map instead of a
blank page.

---

## 4. Command reference

### `devmap onboarding` (alias: `devmap onboard`)

Turns the snapshot into a "where do I start reading this project?" guide.

```bash
devmap onboarding
devmap onboarding --write                # writes ONBOARDING.md
devmap onboarding --write --language id  # en | id
devmap onboarding --json
```

### `devmap map [feature|file]`

Dependency map — spatial view. No AI call, pure traversal of the already-computed snapshot graph.

```bash
devmap map                    # curated, feature-clustered project map
devmap map authentication     # one feature
devmap map src/lib/auth.ts    # one file — what it uses / what uses it
devmap map --all              # untruncated
devmap map --depth <n>        # override traversal depth
```

### `devmap flow [target]`

Execution trace — temporal view, complements `map`.

```bash
devmap flow                   # curated top flows
devmap flow authentication
devmap flow --all             # include lower-confidence features + non-API routes
```

With a configured API key, each flow's verified step list also gets a short AI-narrated paragraph.

### `devmap explain <file|feature|function>`

Targeted, in-depth explanation of one thing — not a whole-codebase dump.

```bash
devmap explain src/lib/auth.ts
devmap explain "authentication feature"
devmap explain createWorkspace
devmap explain src/lib/auth.ts --write   # also saves to .devmap/explain/<slug>.md
```

Explains what the target does, what it imports, what imports it, and why it's critical. Uses AI, but scoped to just that one target — so it stays fast and cheap even on large codebases. Without `--write`, the answer only prints to the terminal.

### `devmap doctor`

Diagnostics for a broken setup. Checks DevMap version, Node version, provider/API key/model status, snapshot state, OS/platform. Always points to the next command to run.

```bash
devmap doctor
```

### `devmap config model <model-id|auto>`

Override the model used for AI-powered commands, or restore automatic routing.

```bash
devmap config model llama-3.1-8b-instant
devmap config model auto
devmap config model llama-3.1-8b-instant --local
```

`--local` writes to `.devmap/config.local.json` in the current project instead of the global `~/.devmap/config.json`. Only `model` can be set locally, provider and API key always stay global.

---

## 5. Generated files reference

| File | Purpose |
|---|---|
| `DEVMAP.md` | Human + AI instructions for using DevMap in this repo |
| `AGENTS.md` | Points AI agents to DevMap's navigation contract |
| `.devmap/index.json` | AI agent entry point |
| `.devmap/features/*.json` | Feature-level navigation |
| `.devmap/snapshot.json` | Full project intelligence, source of truth |
| `.devmap/maps/*` | `devmap map` output (`.md` + `.mermaid`) |
| `.devmap/flows/*` | `devmap flow` output (`.md` + `.mermaid`) |
| `.devmap/config.local.json` | Optional per-project model override, not committed (`.devmap/` is gitignored) |
| `ONBOARDING.md` | `devmap onboarding --write` output |

---

## 6. Scripting & CI — `--json`

Every command supports `--json`: exactly one JSON document on stdout, no ANSI/decoration, no streaming. Runtime failures return `{ status, error, hint }` instead of a thrown error — safe to parse in agents, scripts, or CI jobs.

---

## 7. Troubleshooting

Straight from `devmap doctor`'s real checks:

- **API key invalid or missing** → run `devmap init` again, or set `GROQ_API_KEY` / `OPENROUTER_API_KEY`
- **Snapshot missing or corrupt** → `devmap analyze --fresh`
- **Model unavailable** → `devmap init` or `devmap config model <model-id>`
- **Node version unsupported** → upgrade to Node 18+

---

## See it in action

A small Next.js + Prisma app — a todos API route, a page, one component:

```
$ devmap analyze

DevMap Analyze
────────────────────────────────────────────────────────
◆ Scanning ~/sample-todo-app
Project              sample-todo-app
Framework            nextjs
Language             typescript
Files                9
Lines                117

Entry Points
────────────────────────────────────────────────────────
◆ app/api/todos/route.ts
◆ app/layout.tsx
◆ app/page.tsx
◆ app/todos/page.tsx

Routes
────────────────────────────────────────────────────────
◆ / -> app/page.tsx
◆ /api/todos -> app/api/todos/route.ts
◆ /todos -> app/todos/page.tsx

Database
────────────────────────────────────────────────────────
◆ Prisma

Features
────────────────────────────────────────────────────────
◆ Todo
◆ Todo Management

◆ Snapshot saved to .devmap/snapshot.json
◆ Agent navigation saved to .devmap/index.json and .devmap/features/
AI architecture interpretation is not configured. Run devmap init to enable it.
```

That produces a 15 KB `snapshot.json`. The routes and database sections
are pulled straight from it:

```json
{
  "framework": "nextjs",
  "routes": [
    { "path": "/", "file": "app/page.tsx", "kind": "page" },
    {
      "path": "/api/todos",
      "file": "app/api/todos/route.ts",
      "kind": "api",
      "methods": ["GET", "POST"]
    },
    { "path": "/todos", "file": "app/todos/page.tsx", "kind": "page" }
  ],
  "database": {
    "provider": "Prisma",
    "files": ["prisma/schema.prisma"]
  },
  "features": [
    {
      "name": "Todo Management",
      "purpose": "Handles create, read, update, and delete operations for Todo.",
      "files": ["app/api/todos/route.ts"],
      "confidence": "high"
    }
  ]
}
```

No API key was set for this run — everything above is pure static
analysis. [Browse the full snapshot and try it yourself](https://github.com/itsflaid/devmap/tree/main/examples/todo-app).
