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

- What the architecture looks like
- Where the entry points are
- Which files are critical
- What external services are used
- How specific features work — just ask

One command. Under 10 minutes. Any codebase.

---

## Quick Start

```bash
# Install
npm install -g devmap

# Setup (one time)
devmap init

# Understand your project
devmap analyze

# Ask anything
devmap ask "how does authentication work"
```

---

## Commands

### `devmap init`

Setup your AI provider and API key. Run once per machine.

```bash
devmap init
```

```
Select provider:
  [1] Groq (free tier — recommended)
  [2] OpenAI
  [3] Gemini

✓ Provider: Groq
✓ API key validated
✓ Ready. Run: devmap analyze
```

---

### `devmap analyze`

Analyze project structure and generate architecture overview.

```bash
devmap analyze              # standard overview
devmap analyze --deep       # detailed per-module explanation
devmap analyze --fresh      # ignore cache, full re-analyze
devmap analyze ./src        # analyze specific folder
```

**Example output:**

```
─────────────────────────────────────────
  PROJECT   devnote
  STACK     Next.js 15 · Prisma · Neon
  SIZE      67 files · 12,400 lines
─────────────────────────────────────────

  Entry Points
  → app/layout.tsx         root layout
  → app/page.tsx           home page
  → middleware.ts          auth guard

  Critical Files
  → lib/db.ts              referenced by 23 files
  → lib/auth.ts            referenced by 14 files
  → types/index.ts         referenced by 31 files

  External Services
  → Neon PostgreSQL        via Prisma
  → Google OAuth           via NextAuth v5

  Architecture
  Full-stack Next.js app. Auth is handled server-side via NextAuth
  with Google OAuth, enforced globally by middleware.ts. Data layer
  uses Prisma ORM connected to Neon PostgreSQL. Client state managed
  with Zustand.

  Snapshot saved → .devmap/snapshot.json
```

---

### `devmap ask`

Ask anything about the codebase. Uses cached snapshot — no re-scan.

```bash
devmap ask "how does authentication work"
devmap ask "where is payment logic handled"
devmap ask "explain the booking flow"
devmap ask "which files handle AI integration"
devmap ask "where is a new user created"
```

**Example output:**

```
$ devmap ask "how does authentication work"

  Relevant files → middleware.ts, lib/auth.ts, lib/session.ts

  Auth is handled by NextAuth v5 configured in lib/auth.ts.
  All requests pass through middleware.ts which calls getSession().
  No session → redirect to /login.
  Valid session → user attached to request context.

  Key files:
  → middleware.ts    route protection rules
  → lib/auth.ts      NextAuth config + callbacks
  → lib/session.ts   session helper functions
```

---

### `devmap doctor`

Diagnose issues. Copy output when filing a bug report.

```bash
devmap doctor
```

```
  DevMap version    1.0.0              ✓
  Node.js version   20.11.0            ✓
  Provider          Groq               ✓
  API key           valid              ✓
  Model             qwen-2.5-coder-32b ✓
  Snapshot          exists (2h ago)    ✓

  No issues found.
```

---

## Installation

```bash
# npm
npm install -g devmap

# pnpm
pnpm add -g devmap

# without installing
npx devmap analyze
```

**Requirements:** Node.js 18+

---

## AI Provider Setup

DevMap is free and open source.
AI features require an API key from your preferred provider:

| Provider | Free Tier | Notes |
|---|---|---|
| [Groq](https://console.groq.com/keys) | ✓ 500k tokens/day | Recommended to start |
| [OpenAI](https://platform.openai.com/api-keys) | ✗ Pay-as-you-go | ~$0.001 per analyze |
| Gemini | Coming soon | — |

**Estimated cost for active daily use: $0–2/month**

DevMap uses your API key directly. Your key is stored locally at
`~/.devmap/config.json` and never sent to any DevMap server.
DevMap has no servers. Everything runs on your machine.

---

## How Token Usage Is Kept Low

DevMap does not send raw code to AI.

```
Your files
    ↓
Static analysis (zero tokens)
    ↓
Compact JSON summary
    ↓
AI interprets summary
    ↓
Output
```

For `devmap ask`, only the 3–5 most relevant files are sent — not the whole project.
Results are cached per file. Second and subsequent analyzes cost nearly nothing.

**Typical usage:**

| Command | First run | Cached |
|---|---|---|
| `devmap analyze` | ~5,000 tokens | ~200 tokens |
| `devmap ask` | ~1,000 tokens | ~1,000 tokens |

---

## Supported Stacks

**MVP (stable):**
- Next.js
- Express

**Coming soon:**
- NestJS
- Laravel
- Vue / Nuxt

---

## Roadmap

**Now (v1.0)**
- [x] `devmap init`
- [x] `devmap analyze`
- [x] `devmap ask`
- [x] `devmap doctor`

**Next (v2.0)**
- [ ] `devmap docs` — generate project documentation
- [ ] `devmap onboard` — generate onboarding guide for new team members

**Later**
- [ ] `devmap deadcode` — find unused files and exports
- [ ] `devmap flow` — explain system flows as narrative steps
- [ ] OpenAI + Gemini support
- [ ] VS Code Extension

---

## Vision

DevMap is not an AI coding assistant.

AI coding assistants help you **write** code.
DevMap helps you **understand** code that already exists.

They're not competitors. They're complementary.
Use DevMap to understand the codebase. Use Cursor or Copilot to edit it.

---

## Contributing

DevMap is open source and welcomes contributions.

```bash
git clone https://github.com/itsflaid/devmap
cd devmap
npm install
npm link
devmap analyze  # test on any project
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how DevMap works internally.
See [ROADMAP.md](./ROADMAP.md) for what's planned.

---

## License

MIT — use it, fork it, build on it.

---

*Built by [@itsflaid](https://github.com/itsflaid)*
