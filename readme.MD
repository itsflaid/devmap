# devmap

> Understand any codebase in minutes, not days.

---

[Demo GIF placeholder — record with terminalizer before publishing]

---

## The Problem

Modern AI tools generate code faster than developers can understand it.

You clone a repo — 200 files stare back at you.
You join a team mid-project — nobody has time to explain the architecture.
You open an AI-generated codebase — even the person who built it isn't sure how it works.

Reading every file manually isn't the answer.

---

## The Solution

DevMap analyzes your project using static analysis + AI, then tells you:

* What the architecture looks like
* Where the entry points are
* Which files are critical
* What external services are used
* How specific features work — just ask

One command. Under 10 minutes. Any codebase.

---

## How It Works

DevMap works in three stages — init once, analyze when needed, ask anytime.

```txt
devmap init
  → saves your AI provider config
  → generates DEVMAP.md
  → generates AGENTS.md

devmap analyze
  → runs static analysis
  → builds compact project map
  → generates snapshot.json

devmap ask "how does auth work?"
  → reads snapshot
  → selects relevant files
  → answers your question
```

Three files DevMap generates:

| File                    | Purpose                                   | Regenerated   |
| ----------------------- | ----------------------------------------- | ------------- |
| `DEVMAP.md`             | Instructions for developers and AI agents | Once at init  |
| `AGENTS.md`             | Tells AI agents to read DEVMAP.md first   | Once at init  |
| `.devmap/snapshot.json` | Project snapshot generated from analysis  | Every analyze |

---

## Quick Start

```bash
# Install
npm install -g devmap

# Setup (one time)
devmap init

# Analyze project
devmap analyze

# Ask anything
devmap ask "how does authentication work"
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

Snapshot saved:
.devmap/snapshot.json
```

---

## For AI Agents

If you use Claude Code, Codex, Gemini CLI, Cursor, Aider, Windsurf, Copilot, or other AI agents — DevMap provides reusable project context.

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

One snapshot. Every tool. No repeated explanations.

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

For detailed documentation:

* [PRD.md](./PRD.md)
* [docs/commands.md](./docs/commands.md)
* [docs/architecture.md](./docs/architecture.md)
* [docs/generated-files.md](./docs/generated-files.md)
* [docs/benchmarking.md](./docs/benchmarking.md)
* [docs/testing.md](./docs/testing.md)
* [docs/roadmap.md](./docs/roadmap.md)
* [docs/contributing.md](./docs/contributing.md)

---

## Roadmap

### Now (MVP)

* [x] `devmap init`
* [x] `devmap analyze`
* [x] `devmap ask`
* [x] `devmap doctor`

### Next

* [ ] `devmap features`
* [ ] OpenAI provider
* [ ] Gemini provider

### Later

* [ ] `devmap explain`
* [ ] `devmap flow`
* [ ] `devmap docs`
* [ ] `devmap onboard`
* [ ] Local AI mode
* [ ] VS Code Extension

See [docs/roadmap.md](./docs/roadmap.md) for details.

---

## Vision

DevMap is not an AI coding assistant.

AI coding assistants help you write code.

DevMap helps you understand code that already exists.

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

Requests go directly from your machine to the selected AI provider.

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

Use it, fork it, improve it, build on top of it.

---

Built by [@itsflaid](https://github.com/itsflaid)
