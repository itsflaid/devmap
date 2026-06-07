# DevMap — Commands Reference

---

## `devmap init`

Initialize DevMap configuration.

### Purpose
Validate the Groq API key, save global configuration, and prepare the current
project. Run once per machine and again when changing credentials.

### Usage
```bash
devmap init
```

### Flow
```
→ Confirm Groq provider
→ Input API key or read GROQ_API_KEY
→ Validate key against the Groq API
→ Save to ~/.devmap/config.json
→ Detect the current project framework
→ Create .devmap/
→ Add .devmap/ to .gitignore (current project)
→ Generate DEVMAP.md without overwriting an existing file
```

### Output
```
✓ Provider: Groq
✓ API key validated
✓ Config saved to ~/.devmap/config.json
✓ Added .devmap/ to .gitignore
✓ Created DEVMAP.md

Ready. Run: devmap analyze
```

### Error Cases
```
✗ Invalid API key — check your key at console.groq.com/keys

✗ Network error — check your internet connection and try again

✗ API key missing — run interactively or set GROQ_API_KEY
```

---

## `devmap analyze`

Analyze current project structure and generate architecture overview.

### Usage
```bash
devmap analyze              # standard overview
devmap analyze --deep       # detailed per-module explanation
devmap analyze --fresh      # ignore cache, full re-analyze
devmap analyze ./subfolder  # analyze specific directory
```

### Internal Flow
```
1. Scan filesystem → filter ignored paths
2. Detect framework from package.json + file patterns
3. Parse all imports → build dependency graph
4. Detect entry points from graph topology
5. Detect external services from imports
6. Build compact project-map JSON (zero tokens so far)
7. Send project-map to AI → get architecture overview
8. Save snapshot to .devmap/snapshot.json
9. Stream output to terminal
```

### Standard Output
```
─────────────────────────────────────────
  PROJECT   devnote
  STACK     Next.js 15 · Prisma · Neon
  SIZE      67 files · 12,400 lines
─────────────────────────────────────────

  Entry Points
  → app/layout.tsx         root layout
  → app/page.tsx           home page
  → middleware.ts          auth guard (runs on all routes)
  → app/api/               8 API route handlers

  Critical Files
  → lib/db.ts              referenced by 23 files
  → lib/auth.ts            referenced by 14 files
  → types/index.ts         referenced by 31 files

  External Services
  → Neon PostgreSQL        via Prisma
  → Google OAuth           via NextAuth v5
  → Cloudinary             file uploads

  Architecture
  This is a full-stack Next.js app. Auth is handled server-side
  via NextAuth with Google OAuth, enforced globally by middleware.ts.
  Data layer uses Prisma ORM connected to Neon PostgreSQL.
  Client state managed with Zustand. Snippets support public/private
  visibility with shareable links via /s/[shareId].

  Snapshot saved → .devmap/snapshot.json
  Next: devmap ask "anything about this project"
```

### Deep Output (`--deep` flag)
Same as standard, plus per-module breakdown:
```
  Module Breakdown

  ── app/api/ ───────────────────────────
  8 REST endpoints. Auth endpoints delegate to NextAuth.
  Snippet CRUD routes validate ownership before mutation.
  All routes use shared error handling from lib/api.ts.

  ── lib/auth.ts ────────────────────────
  Central auth configuration. Exports getSession() used across
  server components and API routes. Integrates with lib/db.ts
  for user lookup on OAuth callback.

  [continues for each major module...]
```

### Cache Behavior
```
First run:   full analysis    ~5,000 tokens
Second run:  uses cache       ~200 tokens  (if project unchanged)
After edits: re-analyzes only changed files
```

---

## `devmap ask`

Ask any question about the codebase.

### Usage
```bash
devmap ask "how does authentication work"
devmap ask "where is payment logic handled"
devmap ask "explain the booking flow"
devmap ask "where is user created"
devmap ask "which files handle AI integration"
devmap ask "what happens when a snippet is made public"
```

### Internal Flow
```
1. Check if snapshot exists
   → No snapshot: run quick analyze first, then continue
   → Snapshot exists but stale (files changed): notify user, offer options

2. Extract keywords from question

3. Search snapshot fileIndex for relevant files:
   → Match file paths containing keywords
   → Match exported symbols containing keywords
   → Expand one level via import graph

4. Rank by relevance, take top 5 files max

5. For files > 200 lines: extract relevant sections only

6. Build prompt: question + selected file contents

7. Stream answer to terminal
```

### Output
```
$ devmap ask "how does authentication work"

  Searching relevant files...
  → middleware.ts, lib/auth.ts, app/api/auth/[...nextauth]/route.ts,
    lib/session.ts

  Authentication Flow ──────────────────────────────

  Auth is handled by NextAuth v5 configured in lib/auth.ts.

  Flow:
  1. All requests pass through middleware.ts
  2. Middleware calls getSession() from lib/session.ts
  3. No session → redirect to /login
  4. Valid session → attach user to request context
  5. API routes get user via getServerSession() directly

  Google OAuth is the only configured provider. On first login,
  a new user record is created in the database via the signIn callback
  in lib/auth.ts (line 34).

  Key files:
  → middleware.ts       route protection rules
  → lib/auth.ts         NextAuth config + callbacks
  → lib/session.ts      session helper functions
```

### Stale Snapshot Handling
```
$ devmap ask "..."

  ⚠ Project has changed since last analyze (4 files modified)

  [1] Use existing snapshot (faster, may be slightly outdated)
  [2] Re-analyze changed files only (~600 tokens)
  [3] Full re-analyze (~5,000 tokens)

  Choose [1]:
```

---

## `devmap doctor`

Run diagnostics. Use before filing a bug report.

### Usage
```bash
devmap doctor
```

### Output — All Good
```
  DevMap Doctor ────────────────────────

  DevMap version    1.0.0         ✓
  Node.js version   20.11.0       ✓
  Provider          Groq          ✓
  API key           valid         ✓
  Model             qwen-2.5-coder-32b  ✓
  Model available   yes           ✓
  Snapshot          exists        ✓
  Snapshot age      2 hours ago   ✓
  Cache             healthy       ✓
  Daily tokens      12,400 used   ✓

  No issues found.
  If you're experiencing problems, copy this output when reporting.
```

### Output — Issues Found
```
  DevMap Doctor ────────────────────────

  DevMap version    1.0.0         ✓
  Node.js version   20.11.0       ✓
  Provider          Groq          ✓
  API key           valid         ✓
  Model             qwen-2.5-coder-32b  ✗  (unavailable)
  Fallback model    llama-3.3-70b       ✓

  1 issue found:

  ✗ Primary model unavailable
    DevMap will use fallback model automatically.
    Results may vary slightly from normal.
    This is a Groq service issue, not a DevMap bug.
    Status: https://status.groq.com
```

---

## Global Flags

Available on all commands:

```bash
devmap --version        print version
devmap --help           print help
devmap [cmd] --help     print command-specific help
devmap [cmd] --json     output as JSON (for piping to other tools)
devmap [cmd] --no-color disable color output
```

---

## Future Commands (Post-MVP)

| Command | Phase | Purpose |
|---|---|---|
| `devmap docs` | 3 | Generate markdown documentation |
| `devmap onboard` | 3 | Generate onboarding guide for new team members |
| `devmap flow [module]` | 4 | Explain system flow as narrative steps |
| `devmap deadcode` | 4 | Find unused files, exports, and functions |
| `devmap report` | 4 | Project health report with scores |
| `devmap watch` | Future | Auto-update snapshot on file changes |
| `devmap visual` | Future | Generate architecture diagram |
