# DevMap — Commands Reference

← Back to PRD: ../PRD.md

---

## Overview

DevMap MVP provides five core project commands and one configuration command:

* `devmap init`
* `devmap analyze`
* `devmap onboarding`
* `devmap doctor`
* `devmap config model`

Additional product commands should wait until the MVP is shipped unless the PRD
explicitly promotes them into the `0.1.0` scope.

Future commands are documented in:

* [roadmap.md](./roadmap.md)

---

## `devmap init`

Initialize DevMap configuration and prepare the current project.

### Purpose

`devmap init` sets up DevMap for local usage.

It should be run once per machine/project, or again when changing provider credentials.

### Usage

```bash
devmap init
```

### Responsibilities

* Confirm AI provider
* Input API key or read environment variable
* Validate API key
* Ask for a Groq model from the provider model list
* Ask for an OpenRouter model; Enter defaults to `openrouter/free`
* Save global configuration to `~/.devmap/config.json`
* Detect current project framework
* Create `.devmap/`
* Add `.devmap/` to `.gitignore`
* Generate `DEVMAP.md`
* Handle `AGENTS.md` safely

### Flow

```txt
Start
  ↓
Select Provider
  ↓
Input API Key
  ↓
Validate API Key
  ↓
Save Global Config
  ↓
Detect Project
  ↓
Create .devmap/
  ↓
Update .gitignore
  ↓
Generate DEVMAP.md
  ↓
Handle AGENTS.md
  ↓
Done
```

### Output Example

```txt
DevMap Setup

Provider:   ✓ Groq
API Key:    ✓ Valid
Project:    ✓ Next.js detected

Config saved: ~/.devmap/config.json
Generated: DEVMAP.md
Updated: .gitignore

Run: devmap analyze
```

### Error Cases

```txt
✗ Invalid API key

✗ Network connection failed

✗ API key missing

✗ Unable to write configuration file

✗ Unable to update .gitignore
```

---

## `devmap analyze`

Analyze the current project and generate a reusable project snapshot.

### Purpose

`devmap analyze` scans the project, detects its structure, identifies important files, and generates `.devmap/snapshot.json`.

### Usage

```bash
devmap analyze
```

`devmap analyze` uses the model stored in `~/.devmap/config.json`. Change the
stored model with `devmap config model <model-id>`.

### Responsibilities

* Scan project files
* Apply ignore rules
* Detect framework
* Detect package manager
* Detect language
* Classify project type and workspace shape separately from framework
* Detect routes
* Detect API routes
* Detect dependencies
* Detect external services
* Detect database usage
* Detect entry points
* Detect critical files
* Analyze JS/TS imports, exports, symbols, and functions with `ts-morph`
* Keep heuristic and fallback analysis for other file types
* Build a compact file index with purpose, scope, top functions/code symbols,
  search terms, feature references, and importance
* Generate minimal high-confidence feature and request/API flows
* Infer feature entry points and short business flows where possible
* Build a lightweight onboarding path and file-level change impact map
* Generate architecture overview
* Generate `.devmap/index.json` and `.devmap/features/*.json` for agents
* Save snapshot to `.devmap/snapshot.json`

The lightweight index gives agents a concise project summary and a
start-here-oriented `criticalFiles` list. Each feature map provides
`sourcePriority` for reading order and behavioral `flow` steps when enough
static evidence exists.

### Internal Flow

```txt
Project Files
  ↓
Scanner
  ↓
Static Analyzer
  ↓
Project Map
  ↓
AI Interpretation
  ↓
Snapshot
  ↓
Terminal Output
```

### Generated Files

```txt
.devmap/index.json
.devmap/features/*.json
.devmap/snapshot.json
```

### Output Example

```txt
PROJECT      devnote
FRAMEWORK    Next.js
LANGUAGE     TypeScript

Entry Points
→ app/layout.tsx
→ app/page.tsx
→ middleware.ts

Critical Files
→ lib/db.ts
→ lib/auth.ts
→ types/index.ts

External Services
→ Neon
→ Google OAuth

Architecture
This is a full-stack Next.js application. Authentication is handled
server-side. Database access is centralized through the data layer.

Snapshot saved:
.devmap/snapshot.json

```

### Rules

* Static analysis must run before AI interpretation
* Do not send the entire project source to AI
* Snapshot must be regenerated after analyze
* Snapshot must remain compact and deterministic
* Agent index must remain small and must not duplicate full change-impact or
  dependency data
* AI metadata enrichment must be batched and optional
* Analyze must continue if purpose or search-term enrichment fails
* Raw provider errors must not be shown directly to users
* New AI interpretation streams progressively in human-readable mode
* Cached interpretation is rendered immediately without a provider request

---

## `devmap onboarding`

Generate a project onboarding guide from the current snapshot.

Alias: `devmap onboard`

### Purpose

`devmap onboarding` turns `.devmap/snapshot.json` into a practical reading
guide for humans and AI agents. It should help answer:

> Where should I start reading this project?

### Usage

```bash
devmap onboarding
devmap onboarding --write
devmap onboarding --write --language id
devmap onboarding --json
```

### Responsibilities

* Read `.devmap/snapshot.json`
* Use `project`, `onboarding.recommendedPath`, `features`, `flows`,
  `criticalFiles`, and `changeImpact`
* Include a concise project narrative from snapshot facts, with a trimmed
  architecture note when useful
* Surface entry points, external services, and critical files before the
  reading path
* Print a readable terminal guide by default
* Show a follow-up hint explaining that `--write` creates `ONBOARDING.md`
* Write `ONBOARDING.md` when `--write` is passed
* Ask for Indonesian or English when writing from an interactive terminal and
  no language is provided
* Use `--language en` or `--language id` to skip the prompt
* Emit one structured JSON document when `--json` is passed
* Warn when the snapshot is stale

### Output Sections

1. What this is (tagline + prose)
2. How it works
3. What's inside (features)
4. Start here (ordered reading path)
5. Key flows
6. Go deeper (available commands)

### Rules

* Do not invent files that are not present in the snapshot
* Prefer snapshot-derived paths over generic advice
* Avoid placeholder wording such as `not inferred yet`; omit unavailable fields
* Explain what each important file is responsible for and why it should be read
* Avoid raw metadata dumps such as scores, import counts, and exported symbol
  lists in human onboarding output
* Keep the guide useful without requiring an AI call
* Treat full docs generation as a future command
* Include snapshot freshness and agent navigation policy in JSON output
* Keep `--json` non-interactive; never prompt in machine-readable mode
* Default generated onboarding language is English; use `--language id` for
  Bahasa Indonesia

---

## `devmap map`

Generate a dependency map: full project, one feature, or one file.

### Purpose

`devmap map` turns `.devmap/snapshot.json`'s already-computed dependency
graph and feature list into a navigable map. It should help answer:

> This file/feature — what does it connect to, and how?

Unlike `devmap onboarding`, this never calls AI — it's a pure traversal of
data `devmap analyze` already produced.

### Usage

```bash
devmap map                    # curated, feature-clustered project view
devmap map authentication     # one feature (match is case-insensitive)
devmap map src/lib/auth.ts    # one file (exact path or unambiguous suffix)
devmap map auth.ts            # suffix match — resolves if only one file matches
devmap map --json
```

### Responsibilities

* Read `.devmap/snapshot.json`
* Resolve the target as a feature name, then an exact file path, then an
  unambiguous filename suffix, in that order
* File mode: show what the file uses (2 hops) and what uses it (1 hop),
  both directions, cycle-safe
* Feature mode: show internal structure rooted at the feature's entry
  point (restricted to the feature's own files), plus what it depends on
  and is depended on by outside itself
* Project mode (no target): cluster by feature, show cross-feature
  dependencies and a file-coverage note — not a raw full-file dump
* Print a text tree plus a Mermaid diagram in the terminal
* Write `.devmap/maps/[name].md` and `.devmap/maps/[name].mermaid`
* Warn when the snapshot is stale
* Emit one structured JSON document when `--json` is passed

### Rules

* Never expand a cycle in the tree — mark it `(cycle)` instead of recursing
* An ambiguous suffix match is an error with the candidate list, not a guess
* Project mode stays curated by default; it does not attempt a full
  file-level dump of large projects

---

## `devmap flow`

Trace how a feature or API route works end to end.

### Purpose

`devmap flow` renders the temporal view of a codebase — the ordered
"what happens in what order" — complementing `devmap map`'s spatial view.
It should help answer:

> How does this feature work from start to finish?

### Usage

```bash
devmap flow                    # curated top flows from the snapshot
devmap flow --all              # uncapped: also medium-confidence features and non-API routes
devmap flow authentication     # one specific flow (match is case-insensitive)
devmap flow --json
```

### Responsibilities

* Read `.devmap/snapshot.json`
* Default (no `--all`): render `snapshot.flows` exactly as computed by
  `devmap analyze` — no re-ranking, no re-scan of disk
* `--all`: rebuild the flow set from the snapshot's `features`, `routes`,
  `fileIndex`, and `fileGraph` with lower-confidence features and non-API
  routes included and no caps — still no re-scan and no re-run of `analyze`
* Resolve the target against flow names (exact, then a unique partial
  match; ambiguous or unknown targets are errors with a hint)
* Per flow, write `.devmap/flows/[name].md` and
  `.devmap/flows/[name].mermaid`
* Optional AI narration: when a provider API key is configured, turn the
  already-verified step list into one short flowing paragraph per flow.
  Falls back to the plain step list for that flow only if the call fails
* Print a short index of flows written (name + purpose) when no target and
  more than one flow is written
* Warn when the snapshot is stale
* Emit one structured JSON document when `--json` is passed

### Rules

* Default view stays curated — `snapshot.flows` is already the capped set;
  `--all` is the only way to reveal the larger pool
* Narration never re-reads source files — it only sends the structured
  step list, so the AI call stays small
* A failed narration on one flow never aborts the whole command
* Never call AI when no API key is configured — print a single note instead

---

## `devmap doctor`

Run diagnostics for DevMap setup.

### Purpose

`devmap doctor` helps users debug setup issues and provides copy-pasteable diagnostic output for bug reports.

### Usage

```bash
devmap doctor
```

### Checks

* DevMap version
* Node.js version
* Package manager
* Provider configuration
* API key status
* Selected model, annotated with its source: `(project override)` when a
  `.devmap/config.local.json` model is active, `(global)` otherwise
* Snapshot status
* Project detection
* OS/platform
* Permission issues

### Output — No Issues

```txt
DevMap Doctor

DevMap version     0.1.0        ✓
Node.js version    20.11.0      ✓
Provider           Groq         ✓
API key            valid        ✓
Model              configured   ✓
Snapshot           exists       ✓
Project            Next.js      ✓
Platform           Windows      ✓

No issues found.
```

### Output — Issues Found

```txt
DevMap Doctor

DevMap version     0.1.0        ✓
Node.js version    20.11.0      ✓
Provider           Groq         ✓
API key            invalid      ✗
Snapshot           missing      ⚠

Issues found:

✗ API key is invalid
  Run devmap init again and enter a valid API key.

⚠ Snapshot is missing
  Run devmap analyze before using devmap onboarding.
```

### Rules

* Output must be readable
* Errors must be actionable
* Do not expose raw stack traces
* Mention what command the user should run next

---

## `devmap config model`

Set a global model override for AI-powered commands.

### Usage

```bash
devmap config model llama-3.1-8b-instant
devmap config model openai/gpt-oss-120b
devmap config model auto
devmap config model llama-3.1-8b-instant --local
```

`auto` restores command-based routing:

* `analyze` uses `openai/gpt-oss-20b`

`--local` writes `.devmap/config.local.json` in the current project instead of
the global `~/.devmap/config.json`. Only `model` can be set locally: provider
and API key always stay global and are never read from the project config.
Existing local model overrides are used by `analyze`, `flow`, and reported by
`doctor` as `(project override)`. Without a local override, commands use the
global model (reported as `(global)`). `.devmap/` is gitignored, so local
overrides are never committed.

For Groq, `devmap init` lists available models after API-key validation. Pick a
model with the arrow keys and press Enter. The selected model is stored in the
global config.

For OpenRouter, `devmap init` prompts with:

```txt
OpenRouter model [openrouter/free]:
```

Press Enter for the free router, or type any free or paid OpenRouter model ID.
The typed model is stored as the primary choice and is not silently replaced.
`devmap config model auto` restores `openrouter/free` for OpenRouter.

Automatic routing also uses ordered fallback chains:

* `analyze`: `qwen/qwen3.6-27b`, `llama-3.3-70b-versatile`, then `llama-3.1-8b-instant`

DevMap advances after model-unavailable and transient provider responses. For
rate limits, it first retries the current model three times with exponential
backoff. Invalid API keys stop immediately instead of wasting requests on the
rest of the chain.

The command preserves the configured provider and API key. DevMap must be
initialized before changing the model.

---

## Global Flags

Available globally:

```bash
devmap --version
devmap --help
devmap [command] --help
```

Available for supported commands:

```bash
devmap [command] --json
devmap [command] --no-color
```

### Flag Purpose

| Flag         | Purpose                         |
| ------------ | ------------------------------- |
| `--version`  | Print DevMap version            |
| `--help`     | Print help                      |
| `--json`     | Output machine-readable JSON    |
| `--no-color` | Disable colored terminal output |

### JSON Contract

Use `--json` when DevMap is called by an AI agent, script, CI job, or editor
integration.

```bash
devmap init --json
devmap analyze --json
devmap onboarding --json
devmap doctor --json
devmap config model auto --json
```

Contract:

* stdout contains exactly one JSON document
* ANSI codes and terminal decoration are disabled
* progress sections and Markdown rendering are omitted
* AI responses are buffered instead of streamed
* runtime failures return a JSON object with `status`, `error`, and optional `hint`
* `init --json` never prompts and therefore requires `GROQ_API_KEY`,
  `OPENROUTER_API_KEY`, or an existing API key
* package-manager wrapper warnings may appear on stderr and are not part of the
  DevMap JSON document

`analyze --json` returns the project snapshot. `onboarding --json` returns guide
metadata and Markdown. `doctor --json` returns diagnostics and issues as
structured fields.

---

## Future Commands

The following commands are planned after MVP.

They are not part of the current MVP command scope.

| Command           | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `devmap features` | Detect implemented project features         |
| `devmap explain`  | Explain folders, modules, and architecture  |
| `devmap docs`     | Generate project documentation              |
| `devmap deadcode` | Detect unused files, exports, and functions |
| `devmap report`   | Generate project health report              |
| `devmap watch`    | Auto-update snapshot on file changes        |
| `devmap visual`   | Generate architecture diagram               |

See:

* [roadmap.md](./roadmap.md)

---

## Source of Truth

Product direction belongs in:

* `../PRD.md`

Command behavior belongs in:

* `docs/commands.md`

Implementation details belong in:

* `docs/architecture.md`

If documentation conflicts, `PRD.md` takes precedence for product direction.
