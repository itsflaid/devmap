# DevMap — Commands Reference

← Back to PRD: ../PRD.md

---

## Overview

DevMap MVP provides four core project commands and one configuration command:

* `devmap init`
* `devmap analyze`
* `devmap ask`
* `devmap doctor`
* `devmap config model`

No additional product commands should be added until the MVP is shipped.

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
* Detect routes
* Detect API routes
* Detect dependencies
* Detect external services
* Detect database usage
* Detect entry points
* Detect critical files
* Generate architecture overview
* Save snapshot to `.devmap/snapshot.json`

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

### Generated File

```txt
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

Next:
devmap ask "how does authentication work?"
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
* Raw provider errors must not be shown directly to users

---

## `devmap ask`

Ask questions about the current project.

### Purpose

`devmap ask` answers natural-language questions about the codebase using the existing snapshot and selected relevant files.

### Usage

```bash
devmap ask "how does authentication work?"
devmap ask "where is payment logic handled?"
devmap ask "explain the booking flow"
devmap ask "which files handle AI integration?"
devmap ask "where is a new user created?"
```

### Responsibilities

* Read `.devmap/snapshot.json`
* Run quick analysis if no snapshot exists
* Detect question language
* Extract relevant keywords
* Select relevant files
* Build compact context
* Send only relevant context to AI
* Return answer in the same language as the question

### Internal Flow

```txt
Question
  ↓
Detect Language
  ↓
Read Snapshot
  ↓
Find Relevant Files
  ↓
Build Context
  ↓
Send To AI
  ↓
Stream Answer
```

### Context Selection Rules

DevMap should select relevant files using:

* File path matching
* Keyword matching
* Import/export matching
* Dependency matching
* Known framework conventions

Example question:

```txt
how does authentication work?
```

Likely relevant files:

```txt
middleware.ts
lib/auth.ts
lib/session.ts
app/api/auth/*
```

### Hard Rules

* Never send the entire project to AI
* Prefer 3–5 most relevant files
* Include related files in output
* Keep answer readable
* Respond in the same language as the question
* Technical labels can remain in English

### Output Example

```txt
Authentication Flow

Authentication is handled using NextAuth.

Flow:

1. Request enters middleware.ts
2. Session validation occurs
3. Invalid session redirects to login
4. Valid session continues to protected routes

Key Files

→ middleware.ts
→ lib/auth.ts
→ app/api/auth/*
```

### Missing Snapshot Behavior

If no snapshot exists:

```txt
No snapshot found.

Running quick analysis first...
```

Then continue answering the question.

### Stale Snapshot Behavior

If project files changed after last analyze:

```txt
Project changed since last analyze.

Use existing snapshot or re-analyze first?

[1] Use existing snapshot
[2] Re-analyze now
```

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
  Run devmap analyze before using devmap ask.
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

* `ask` uses `llama-3.1-8b-instant`
* `analyze` uses `openai/gpt-oss-20b`
* `analyze --deep` uses `openai/gpt-oss-120b`

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
devmap ask "where is authentication handled?" --json
devmap doctor --json
devmap config model auto --json
```

Contract:

* stdout contains exactly one JSON document
* ANSI codes and terminal decoration are disabled
* progress sections and Markdown rendering are omitted
* runtime failures return a JSON object with `status`, `error`, and optional `hint`
* `init --json` never prompts and therefore requires `GROQ_API_KEY` or an
  existing API key
* package-manager wrapper warnings may appear on stderr and are not part of the
  DevMap JSON document

`analyze --json` returns the project snapshot. `ask --json` returns the answer,
selected files, model, and token usage. `doctor --json` returns diagnostics and
issues as structured fields.

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
| `devmap onboard`  | Generate onboarding guide                   |
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
