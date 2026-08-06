---
title: "DevMap Docs"
---

# DevMap Docs

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
