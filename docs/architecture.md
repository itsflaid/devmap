# DevMap — Architecture

← Back to PRD: ../PRD.md

---

## Architecture Philosophy

DevMap follows this principle:

```txt
80% Static Analysis
20% AI Interpretation
```

Static analysis is the foundation.

AI is an enhancement layer.

DevMap should not rely on AI to understand an entire project from raw source files.

Instead, DevMap should first extract structured project information, then use AI to explain that information in a readable way.

---

## High-Level Flow

```txt
Project Files
  ↓
Scanner
  ↓
Static Analyzer
  ↓
Project Map
  ↓
Snapshot
  ↓
Context Builder
  ↓
AI Layer
  ↓
Terminal Output
```

### Explanation

| Layer           | Purpose                              |
| --------------- | ------------------------------------ |
| Scanner         | Finds relevant project files         |
| Static Analyzer | Extracts structure and relationships |
| Project Map     | Internal structured analysis result  |
| Snapshot        | Saved reusable project context       |
| Context Builder | Selects relevant files for questions |
| AI Layer        | Explains and answers                 |
| Terminal Output | Displays result to user              |

---

## Supported MVP Stacks

DevMap MVP focuses on:

* Next.js
* Express

Other stacks are future roadmap items.

---

## Scanner

The scanner is responsible for discovering project files.

### Responsibilities

* Traverse project directories
* Collect file metadata
* Apply ignore rules
* Return relevant source files

### Default Ignore Rules

```txt
node_modules/
.git/
.next/
dist/
build/
coverage/
.turbo/
.vercel/
out/
*.min.js
*.min.ts
*.map
*.lock
*.log
.env*
public/assets/
```

### Scanner Output

The scanner returns a list of relevant files with metadata such as:

* path
* extension
* size
* last modified time

---

## Static Analyzer

The analyzer extracts useful structure from scanned files.

### Responsibilities

* Detect framework
* Detect language
* Detect package manager
* Detect routes
* Detect API routes
* Detect imports
* Detect exports
* Detect dependencies
* Detect external services
* Detect database usage
* Detect entry points
* Detect critical files
* Detect common features

---

## Framework Detection

Framework detection should use:

* `package.json` dependencies
* project folder patterns
* framework-specific files

### Examples

| Signal                     | Detection                |
| -------------------------- | ------------------------ |
| `next` dependency          | Next.js                  |
| `app/` directory           | Next.js App Router       |
| `pages/` directory         | Next.js Pages Router     |
| `express` dependency       | Express                  |
| `server.ts` or `server.js` | Node/Express entry point |

---

## Dependency Graph

The dependency graph maps relationships between files.

### Purpose

Understand which files import other files.

### Example

```txt
app/page.tsx
  → components/Hero.tsx
  → lib/db.ts
```

### Used For

* Critical file detection
* Entry point detection
* Context expansion
* Better answers in `devmap ask`

---

## Entry Point Detection

Entry points are files where application execution or routing commonly starts.

### Next.js Examples

```txt
app/layout.tsx
app/page.tsx
middleware.ts
app/api/*/route.ts
pages/_app.tsx
pages/index.tsx
```

### Express Examples

```txt
server.ts
server.js
app.ts
app.js
index.ts
index.js
```

---

## Critical File Detection

Critical files are files that strongly affect project behavior.

### Signals

* Imported by many files
* Used by entry points
* Contains shared configuration
* Contains auth, database, API, or provider logic
* Has framework-specific importance

### Examples

```txt
lib/db.ts
lib/auth.ts
middleware.ts
prisma/schema.prisma
src/server.ts
```

---

## External Service Detection

DevMap detects external services using dependency and import patterns.

### Examples

| Dependency / Import     | Service    |
| ----------------------- | ---------- |
| `@prisma/client`        | Prisma     |
| `@supabase/supabase-js` | Supabase   |
| `next-auth`             | NextAuth   |
| `stripe`                | Stripe     |
| `midtrans-client`       | Midtrans   |
| `resend`                | Resend     |
| `cloudinary`            | Cloudinary |
| `openai`                | OpenAI     |
| `@google/generative-ai` | Gemini     |
| `groq-sdk`              | Groq       |

---

## Database Detection

DevMap should detect database usage through:

* dependencies
* schema files
* configuration files
* imports
* environment variable names

### Examples

| Signal                  | Detection           |
| ----------------------- | ------------------- |
| `prisma/schema.prisma`  | Prisma              |
| `@prisma/client`        | Prisma Client       |
| `drizzle.config.ts`     | Drizzle             |
| `mongoose`              | MongoDB / Mongoose  |
| `@supabase/supabase-js` | Supabase            |
| `DATABASE_URL`          | Database connection |

---

## Feature Detection

Feature detection identifies common application capabilities.

### MVP Feature Categories

* Authentication
* Database
* API routes
* File upload
* Payments
* Email
* AI integration
* Notifications

### Examples

| Signal                                  | Feature        |
| --------------------------------------- | -------------- |
| `next-auth`, `auth`, `session`, `login` | Authentication |
| `stripe`, `midtrans`, `payment`         | Payments       |
| `cloudinary`, `upload`, `multer`        | File Upload    |
| `resend`, `nodemailer`, `email`         | Email          |
| `openai`, `groq`, `gemini`, `ai`        | AI Integration |

---

## Snapshot

Snapshot is the reusable project context generated by DevMap.

### File

```txt
.devmap/snapshot.json
```

### Purpose

* Store current project analysis
* Act as source of truth for `devmap ask`
* Provide reusable context for AI agents
* Avoid repeated project exploration

### Snapshot Rules

* Must include schema version
* Must include generated timestamp
* Must not contain full raw project source by default
* Must be compact
* Must be deterministic
* Must be regenerated by `devmap analyze`

---

## Recommended Snapshot Shape

```ts
interface DevMapSnapshot {
  version: string;
  generatedAt: string;

  project: {
    name?: string;
    root: string;
    framework: "nextjs" | "express" | "react" | "node" | "unknown";
    language: "typescript" | "javascript" | "mixed" | "unknown";
    packageManager: "pnpm" | "npm" | "yarn" | "bun" | "unknown";
  };

  stats: {
    totalFiles: number;
    relevantFiles: number;
    totalLines?: number;
  };

  entryPoints: EntryPoint[];
  criticalFiles: CriticalFile[];
  routes: RouteInfo[];
  apiRoutes: ApiRouteInfo[];
  dependencies: DependencyInfo[];
  externalServices: ExternalServiceInfo[];
  database?: DatabaseInfo;
  features: FeatureInfo[];
  fileIndex: Record<string, FileInfo>;
}
```

---

## Context Builder

The Context Builder selects relevant context before sending anything to AI.

It is one of the most important parts of DevMap.

Poor context selection creates:

* high token usage
* irrelevant answers
* slow responses
* hallucinated explanations

Good context selection creates:

* lower token usage
* better answers
* faster responses
* repeatable project understanding

---

## Context Builder Strategy

MVP does not use embeddings or vector search.

Use pragmatic heuristics first:

* File path matching
* Keyword matching
* Import/export matching
* Dependency matching
* Known framework conventions

### Example

Question:

```txt
how does authentication work?
```

Extract keywords:

```txt
auth
authentication
login
session
token
middleware
```

Likely selected files:

```txt
middleware.ts
lib/auth.ts
lib/session.ts
app/api/auth/*
```

---

## Context Builder Limits

| Limit                | Value                     |
| -------------------- | ------------------------- |
| Preferred file count | 3–5 files                 |
| Maximum file count   | 5 files                   |
| Large file behavior  | Extract relevant sections |
| Full project source  | Never sent                |

---

## AI Layer

All AI interactions go through a provider abstraction.

Commands should not call provider APIs directly.

### MVP Provider

* Groq

### Future Providers

* OpenAI
* Gemini

### Provider Responsibilities

* Validate API key
* Check model availability where possible
* Send completion request
* Stream response
* Handle provider-specific errors
* Normalize output for commands

---

## Model Routing

MVP default model routing:

| Command          | Model                     |
| ---------------- | ------------------------- |
| `analyze`        | `qwen-2.5-coder-32b`      |
| `ask`            | `qwen-2.5-coder-32b`      |
| `analyze --deep` | `llama-3.3-70b-versatile` |
| Fallback         | `llama-3.3-70b-versatile` |

If a model is unavailable, DevMap should fall back gracefully.

Raw provider errors should not be shown directly to users.

---

## Prompt Strategy

Prompt templates should be centralized.

### Rules

* Do not inline prompts inside command logic
* Keep prompts versionable
* Keep prompts short and structured
* Prefer structured JSON input
* Ask AI to explain, not discover
* Do not ask AI to infer facts not present in the snapshot/context

---

## Token Strategy

DevMap is designed to reduce repeated AI exploration.

However, token-efficiency claims must be benchmarked before being used in public marketing.

### Token Rules

* Static analysis first
* Never send the full raw project
* Send compact snapshot data
* For `ask`, send only relevant context
* Cache and reuse snapshot

---

## Cache Strategy

MVP cache source:

```txt
.devmap/snapshot.json
```

Future cache source:

```txt
.devmap/cache.json
```

### MVP Behavior

* `devmap analyze` generates snapshot
* `devmap ask` reuses snapshot
* If no snapshot exists, `ask` may run quick analysis first
* If project changes, user may be prompted to re-analyze

### Future Optimization

Future cache may include:

* file hashes
* dependency graph
* extracted metadata
* last analysis result per file

---

## Storage

### Global Config

```txt
~/.devmap/config.json
```

Stores:

* provider
* API key
* default model
* language preference

### Project Files

```txt
.devmap/
└── snapshot.json
```

Stores:

* latest project snapshot

Future:

```txt
.devmap/
├── snapshot.json
└── cache.json
```

---

## Generated Files

DevMap may generate or update:

```txt
DEVMAP.md
AGENTS.md
.devmap/snapshot.json
```

Detailed generated file behavior is documented in:

* [generated-files.md](./generated-files.md)

---

## Language Strategy

Default language mode:

```txt
auto
```

### Rules

| Output Type     | Language                             |
| --------------- | ------------------------------------ |
| CLI labels      | English                              |
| Technical terms | English where natural                |
| AI explanation  | Same as user question                |
| Generated docs  | Config language or detected language |
| Error messages  | English                              |
| Help text       | English                              |

---

## Error Handling

Errors should be actionable.

### Rules

* Do not show raw stack traces by default
* Explain what failed
* Explain why it may have failed
* Tell user what to do next
* Use `devmap doctor` when useful

### Example

```txt
Unable to validate API key.

Possible causes:
- API key is invalid
- Internet connection failed
- Provider service is unavailable

Next:
Run devmap init again or check your provider dashboard.
```

---

## Output Strategy

CLI output should be:

* readable
* minimal
* actionable
* friendly for developers
* consistent across commands

### Output Should Include

* progress feedback
* clear success messages
* clear next step
* useful error messages

---

## Cross-Platform Strategy

DevMap should support:

* Windows
* macOS
* Linux

### Rules

* Use cross-platform path utilities
* Avoid shell-specific assumptions
* Avoid hardcoded path separators
* Test with different package managers

---

## Architecture Boundaries

### Commands

Commands orchestrate behavior.

They should not contain heavy analysis logic.

### Analyzer

Analyzer extracts project structure.

It should not call AI directly.

### Context Builder

Context Builder selects relevant project context.

It should not format terminal output.

### AI Layer

AI Layer communicates with providers.

It should not scan files directly.

### Output Layer

Output Layer formats terminal messages.

It should not contain business logic.

---

## Source of Truth

Product direction:

* `../PRD.md`

Command behavior:

* [commands.md](./commands.md)

Generated file behavior:

* [generated-files.md](./generated-files.md)

Benchmarking:

* [benchmarking.md](./benchmarking.md)

Testing:

* [testing.md](./testing.md)

Roadmap:

* [roadmap.md](./roadmap.md)
