# devmap

> The first command you run after git clone.

AI should spend tokens solving problems, not rediscovering your codebase.

Built by [Fadil (@itsflaid)](https://github.com/itsflaid)

---

[Demo GIF placeholder — record with VHS before publishing]

---

## The Problem

You ask AI for help.

It starts exploring the repository. Again.

You switch tools. It starts again.

New session. Again.

You join a project halfway through — nobody has time to explain the architecture.

Every AI agent rebuilds context from scratch before real work begins.

---

## The Solution

DevMap analyzes your project using static analysis and AI to generate a reusable project snapshot.

The snapshot contains:

* Architecture overview
* Entry points
* Critical files
* File purpose, scope, top functions, search terms, and importance
* Routes and APIs
* External services
* Database information
* Detected features
* Minimal high-confidence feature and request flows
* Feature entry points and lightweight business flows
* Onboarding path and file-level change impact
* Index-first agent navigation policy with focused feature maps
* Project relationships

One analysis. Reusable context. Any codebase.

Without DevMap:

```txt
Repository
   ↓
AI explores files
   ↓
AI rebuilds context
   ↓
Task begins
```

With DevMap:

```txt
Repository
   ↓
devmap analyze
   ↓
snapshot.json
   ↓
Reusable context
   ↓
Task begins immediately
```

---

## How It Works

```txt
devmap init
  → configures provider
  → generates DEVMAP.md
  → prepares project

devmap analyze
  → runs static analysis (80%)
  → AI interprets structure (20%)
  → generates snapshot.json

snapshot.json
  → reusable project context
  → used by developers
  → used by AI agents
  → used by DevMap commands
```

### Generated Files

| File                    | Role                 |
| ----------------------- | -------------------- |
| `DEVMAP.md`             | DevMap instructions  |
| `AGENTS.md`             | AI agent entry point |
| `.devmap/index.json`    | Lightweight agent navigation |
| `.devmap/features/*.json` | Focused feature maps |
| `.devmap/snapshot.json` | Full project context archive |
| `ONBOARDING.md`         | Optional onboarding guide |

The snapshot is the primary output of DevMap.

Everything else builds on top of it.

Human `analyze` and `ask` responses stream progressively while preserving
readable terminal Markdown. Agent-facing `--json` output stays buffered as one
complete JSON document.

`devmap ask` behaves like a repository navigator: it extracts intent, ranks
snapshot files with a relevance threshold, uses optional retrieval-term
expansion for better recall, and reports low-confidence questions honestly
instead of inventing files.

---

## Quick Start

```bash
# Install
npm install -g devmap

# Setup
devmap init

# Generate project context
devmap analyze

# Verify your setup
devmap doctor

# Generate a reading guide from the snapshot
devmap onboarding
devmap onboarding --write
devmap onboarding --write --language id

# Ask questions about your codebase
devmap ask "explain the main architecture"
devmap ask "where is the auth logic?"
devmap ask "what external services does this use?"

# Machine-readable output for AI agents and scripts
devmap ask "where is the auth logic?" --json
devmap onboarding --json
```

---

## Example Output

```txt
PROJECT      devnote
FRAMEWORK    Next.js
LANGUAGE     TypeScript

Entry Points
→ app/layout.tsx
→ middleware.ts

Critical Files
→ lib/db.ts
→ lib/auth.ts

External Services
→ Neon
→ Google OAuth

Architecture
This is a full-stack Next.js application. Authentication is handled
server-side. Database access is centralized through the data layer.

Snapshot saved:
.devmap/snapshot.json
```

---

## For AI Agents

Agents should read `.devmap/index.json` first, open the relevant feature map,
and inspect its `sourcePriority` files. `.devmap/snapshot.json` is the full
archive for cases where the lightweight navigation layer is insufficient.

If you use Claude Code, OpenAI Codex, Gemini CLI, Cursor, Windsurf, Aider, GitHub Copilot, or Amazon Q — DevMap provides reusable project context that works across all of them.

Without DevMap:

* AI explores repositories from scratch every session
* Tokens are spent on discovery before solving problems
* Context is lost when you switch tools

With DevMap:

```txt
AI Agent
   ↓
AGENTS.md
   ↓
DEVMAP.md
   ↓
snapshot.json
   ↓
work immediately
```

One snapshot. Every tool. No repeated explanations.

Use `--json` when an agent or script calls DevMap. Human terminal output streams
AI explanations progressively, while JSON mode returns one complete parseable
document without ANSI or terminal decoration.

> Benchmark results coming — with and without DevMap, same task, measured token usage.
> See [docs/benchmarking.md](./docs/benchmarking.md) for methodology.

---

## Vision

DevMap is not an AI coding assistant.

AI coding assistants help developers write code.
DevMap helps developers understand code that already exists.

They are complementary, not competitors.

Use DevMap to understand the codebase.
Use AI coding assistants to modify it.

> DevMap is the context layer between developers, AI agents, and unfamiliar codebases.

---

## Supported Stacks

### MVP

* Next.js
* Express
* React

### Planned

* NestJS
* Laravel
* Nuxt

---

## AI Provider Setup

DevMap is free and open source.

AI features require a provider API key. DevMap uses Groq by default — analysis runs on free-tier infrastructure.

| Provider | Status  |
| -------- | ------- |
| Groq     | MVP     |
| OpenAI   | Planned |
| Gemini   | Planned |

API keys are stored locally:

```txt
~/.devmap/config.json
```

DevMap does not require a backend server.

Requests go directly from your machine to the selected provider.

---

## Installation

```bash
# npm
npm install -g devmap

# pnpm
pnpm add -g devmap

# run without installing
npx devmap analyze
```

Requirements:

```txt
Node.js 18+
```

---

## Roadmap

### MVP

* [x] `devmap init`
* [x] `devmap analyze`
* [x] `devmap ask`
* [x] `devmap onboarding`
* [x] `devmap doctor`

### Next

* [ ] `devmap features`
* [ ] `devmap flow`
* [ ] OpenAI provider
* [ ] Gemini provider

### Later

* [ ] `devmap explain`
* [ ] `devmap docs`
* [ ] Local AI mode
* [ ] VS Code Extension

See [docs/roadmap.md](./docs/roadmap.md) for details.

---

## Documentation

* [PRD.md](./PRD.md)
* [docs/commands.md](./docs/commands.md)
* [docs/architecture.md](./docs/architecture.md)
* [docs/generated-files.md](./docs/generated-files.md)
* [docs/design.md](./docs/design.md)
* [docs/benchmarking.md](./docs/benchmarking.md)
* [docs/roadmap.md](./docs/roadmap.md)
* [docs/releasing.md](./docs/releasing.md)
* [CHANGELOG.md](./CHANGELOG.md)
* [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Contributing

DevMap is open source and welcomes contributions.

```bash
git clone https://github.com/itsflaid/devmap
cd devmap

npm install
npm link

devmap analyze
```

Before contributing:

1. Read `PRD.md`
2. Read `docs/architecture.md`
3. Read `CONTRIBUTING.md`

---

## License

MIT License — use it, fork it, improve it, build on top of it.
