# devmap

> Understand any codebase in minutes, not days.

---

[Demo GIF placeholder — record with VHS before publishing]

---

## The Problem

Modern AI tools generate code faster than developers can understand it.

You clone a repository — hundreds of files stare back at you.

You join a project halfway through development — nobody has time to explain the architecture.

You return to an old project after months — and spend hours remembering how everything fits together.

You ask AI for help — and the AI starts exploring the repository from scratch again.

Reading every file manually does not scale.

---

## The Solution

DevMap analyzes your project using static analysis and AI to generate a reusable project snapshot.

The snapshot contains:

* Architecture overview
* Entry points
* Critical files
* Routes and APIs
* External services
* Database information
* Detected features
* Project relationships

Instead of repeatedly exploring the codebase, developers and AI tools can start with a shared understanding of the project.

One analysis.

Reusable context.

Any codebase.

---

## How It Works

DevMap works in three stages.

```txt
devmap init
  → configures provider
  → generates DEVMAP.md
  → prepares project

devmap analyze
  → runs static analysis
  → discovers architecture
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
| `.devmap/snapshot.json` | Core project context |

The snapshot is the primary output of DevMap.

Everything else builds on top of it.

---

## Quick Start

```bash
# Install
npm install -g devmap

# Setup
devmap init

# Generate project context
devmap analyze
```

DevMap generates:

```txt
.devmap/snapshot.json
```

This snapshot becomes a reusable source of project context for:

* Developers
* AI agents
* Future DevMap commands

### What comes next?

```bash
# Generate reusable project context
devmap analyze

# Verify your setup
devmap doctor

# Explore the architecture
devmap ask "explain the main architecture"

# Future: generate onboarding guide
devmap onboard
```


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

Ready for:
→ AI agents
→ DevMap commands
→ Future onboarding generation
```

---

## Why DevMap Exists

Most AI tools rebuild project understanding every session.

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
DevMap Analysis
   ↓
snapshot.json
   ↓
Reusable Context
   ↓
Task begins
```

The goal is not to replace AI.

The goal is to eliminate repeated project exploration.

---

## For AI Agents

If you use:

* Claude Code
* OpenAI Codex
* Gemini CLI
* Cursor
* Windsurf
* Aider
* GitHub Copilot
* Amazon Q

DevMap provides reusable project context.

Without DevMap:

* AI explores repositories from scratch
* Context is rebuilt every session
* Tokens are spent on discovery before solving problems

With DevMap:

* AI reads `AGENTS.md`
* AI is directed to `DEVMAP.md`
* AI loads `.devmap/snapshot.json`
* AI starts with project context already available

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

One snapshot.

Every tool.

No repeated explanations.

---

## Supported Stacks

### MVP

* Next.js
* Express

### Planned

* React
* NestJS
* Laravel
* Nuxt

---

## Documentation

Detailed documentation:

* [PRD.md](./PRD.md)
* [docs/commands.md](./docs/commands.md)
* [docs/architecture.md](./docs/architecture.md)
* [docs/generated-files.md](./docs/generated-files.md)
* [docs/design.md](./docs/design.md)
* [docs/benchmarking.md](./docs/benchmarking.md)
* [docs/development-testing.md](./docs/development-testing.md)
* [docs/roadmap.md](./docs/roadmap.md)
* [docs/contributing.md](./docs/contributing.md)

---

## Roadmap

### MVP

* [x] `devmap init`
* [x] `devmap analyze`
* [x] `devmap ask`
* [x] `devmap doctor`

### Next

* [ ] `devmap onboard`
* [ ] `devmap features`
* [ ] OpenAI provider
* [ ] Gemini provider

### Later

* [ ] `devmap explain`
* [ ] `devmap flow`
* [ ] `devmap docs`
* [ ] Local AI mode
* [ ] VS Code Extension

See:

```txt
docs/roadmap.md
```

for details.

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

## AI Provider Setup

DevMap is free and open source.

AI features require a provider API key.

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
3. Read `docs/contributing.md`

---

## License

MIT License

Use it, fork it, improve it, and build on top of it.

---

Built by [@itsflaid](https://github.com/itsflaid)
