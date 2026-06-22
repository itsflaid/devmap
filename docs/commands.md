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
devmap analyze --deep
```

### Modes

| Mode     | Purpose                                |
| -------- | -------------------------------------- |
| Standard | Fast project overview                  |
| `--deep` | More detailed architecture explanation |

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


### Deep Output

When using:

```bash
devmap analyze --deep
```

DevMap adds a deeper module-level explanation.

Example:

```txt
Module Breakdown

app/
Main application routes and layouts.

app/api/
Server-side API routes.

lib/
Shared utilities, database access, authentication logic, and helpers.
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

1. What This Project Does
2. Mental Model
3. Main Concepts
4. Important Areas to Understand
5. Key Flows
6. Where to Start

### Rules

* Do not invent files that are not present in the snapshot
* Prefer snapshot-derived paths over generic advice
* Avoid placeholder wording such as `not inferred yet`; omit unavailable fields
* Explain what each important file is responsible for and why it should be read
* Avoid raw metadata dumps such as scores, import counts, and exported symbol
  lists in human onboarding output
* Keep the guide useful without requiring an AI call
* Treat `devmap flow` and full docs generation as future commands
* Include snapshot freshness and agent navigation policy in JSON output
* Keep `--json` non-interactive; never prompt in machine-readable mode
* Default generated onboarding language is English; use `--language id` for
  Bahasa Indonesia

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
* Selected model
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
```

`auto` restores command-based routing:

* `analyze` uses `openai/gpt-oss-20b`
* `analyze --deep` uses `openai/gpt-oss-120b`

For OpenRouter, `devmap init` prompts with:

```txt
OpenRouter model [openrouter/free]:
```

Press Enter for the free router, or type any free or paid OpenRouter model ID.
The typed model is stored as the primary choice and is not silently replaced.
`devmap config model auto` restores `openrouter/free` for OpenRouter.

Automatic routing also uses ordered fallback chains:

* `analyze`: `qwen/qwen3.6-27b`, `llama-3.3-70b-versatile`, then `llama-3.1-8b-instant`
* `analyze --deep`: `llama-3.3-70b-versatile`, `qwen/qwen3.6-27b`, then `openai/gpt-oss-20b`

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
devmap analyze --deep --json
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
| `devmap flow`     | Explain system flows as narrative steps     |
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
