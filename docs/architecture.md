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

### Analyzer Registry

Scanned files pass through a normalized analyzer registry before `ProjectMap`
is built:

```txt
Scanner -> TsMorphAnalyzer | HeuristicAnalyzer | FallbackAnalyzer -> FileAnalysis
```

- `.ts`, `.tsx`, `.js`, and `.jsx` use `ts-morph` with high confidence.
- Other recognized source files keep regex/heuristic extraction with medium
  confidence.
- Unknown file types receive a low-confidence fallback result.
- Existing snapshot fields remain available; AST metadata enriches imports,
  exports, symbols, and top functions for JavaScript and TypeScript.

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
  flows: FlowInfo[];
  fileIndex: Record<string, FileInfo>;
}
```

In snapshot schema v1, `totalFiles` and `relevantFiles` both count the files
returned by the filtered scanner. DevMap does not currently walk the ignored
filesystem paths to calculate a separate pre-filter total. Both fields remain
in the schema for compatibility and for a future analyzer that may collect
those counts separately.

### Tier 1 File Index

Each `fileIndex` entry stores compact navigation metadata:

| Field | Purpose |
| ----- | ------- |
| `purpose` | One-sentence description of what the file does when available |
| `scope` | Responsibility classification: API, UI, database, config, service, CLI, test, docs, or unknown |
| `topFunctions` | Compact list of important functions or exported code symbols with line numbers |
| `featureRefs` | Feature names that reference this file |
| `searchTerms` | Retrieval-focused terms used by `devmap ask` |
| `importance` | Static importance score from references, entry point status, critical-file score, and feature ownership |

The scope classifier is responsibility-based. Framework conventions may provide
supporting evidence, but no framework is required for classification.

AI enrichment may improve `purpose` and `searchTerms`, but it is batched in
chunks of at most 20 files and skipped if the provider fails. Static analysis
and snapshot generation must still complete.

### Minimal Flows

Snapshot schema includes `flows` as a foundation for future `FLOW.md`
generation. Phase 1 creates small feature flows for high-confidence features
and request/API flows from detected routes plus local dependency edges. Flow
steps may include important exported symbols, but DevMap still does not build a
full call graph or separate flow analyzer.

Feature metadata also stores a primary `entryPoint` and a short
`businessFlow` when DevMap can infer them from routes or dependencies. This
gives future generated docs a human-oriented path through the feature, not only
a list of files.

Structural feature flows describe behavior such as scanning, analyzer
selection, project-map construction, snapshot persistence, and navigation-file
generation. They must not duplicate the feature file list as a second list.

### Onboarding and Change Impact

Snapshot schema includes two lightweight navigation aids:

| Field | Purpose |
| ----- | ------- |
| `onboarding.recommendedPath` | Ordered files a new developer or AI agent should read first |
| `changeImpact` | File-level impacted features, flows, and direct dependents |

These fields are static-first and intentionally shallow. They are meant to guide
future `ONBOARDING.md`, `FLOW.md`, and safer edit planning without building a
full symbol graph.

### Agent Contract

Generated `DEVMAP.md` contains the complete agent navigation contract. It tells
agents to read `.devmap/index.json`, open the relevant feature map, and inspect
its `sourcePriority` files before broad repository exploration. The full
`.devmap/snapshot.json` is used only when the lightweight maps are insufficient.

The index separates technical framework detection from repository shape:

```txt
framework     -> nextjs | express | unknown
projectType   -> node-cli | web-app | api-service | library | unknown
workspaceType -> monorepo | single-package
```

This avoids labeling a TypeScript CLI monorepo as a fake framework while still
giving agents an immediate mental model. Project summaries are deterministic
and combine this classification with the primary package description and
detected capabilities.

Index `criticalFiles` are ranked for reading order: executable entry points
first, then command/flow owners, feature owners, and finally structural
importance. Import count remains a supporting signal rather than the primary
definition of where an agent should start.

The snapshot also stores a compact `agentInstructions` object for machine
readers. This is intentionally small: policy fields live in JSON, while the
human-readable workflow lives in `DEVMAP.md`.

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
* Retrieval-only AI query expansion when provider config is available
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

### Relevance Confidence And Query Expansion

The Context Builder records retrieval quality in `QuestionContext`:

```ts
{
  intent,
  keywords,
  expandedTerms,
  confidence,
  relevantFiles,
  topScore
}
```

Confidence is derived from the best ranked file:

| Confidence | Score |
| ---------- | ----- |
| `high`     | 70+   |
| `medium`   | 40+   |
| `low`      | < 40  |

Files below score 25 are excluded before context is read. This prevents Ask
from selecting unrelated files only because they scored slightly above other
unrelated files.

Before scoring, `devmap ask` can make a small Groq request that returns generic
retrieval terms as a JSON array. This call is not allowed to choose files or
invent project-specific paths. It only improves recall for deterministic
ranking.

Direct keyword matches score higher than expanded-term matches. If expansion
fails, returns invalid JSON, or no AI config exists, Context Builder falls back
to keyword-only behavior.

Low-confidence contexts are not sent to the answer model. Human output explains
that no strong match was found and suggests investigation paths instead.

---

## Context Builder Limits

| Limit                | Value                     |
| -------------------- | ------------------------- |
| Preferred file count | 3–5 files                 |
| Maximum file count   | 5 files                   |
| English navigation queries | 2 files, 60 lines each |
| Large file behavior  | Extract relevant sections |
| Full project source  | Never sent                |

Test files and fixtures are excluded from normal product questions. They are
eligible when an English query explicitly mentions testing terms such as
`test`, `spec`, `fixture`, or `coverage`.

Explicit English scope terms provide a ranking boost:

* `cli`, `command`, `terminal`
* `web`, `ui`, `frontend`, `component`, `page`
* `docs`, `documentation`, `readme`

Scope matching is a boost rather than a hard exclusion so cross-package
dependencies can still be selected when their direct relevance is stronger.

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

| Command          | Primary                    | Ordered fallbacks |
| ---------------- | -------------------------- | ----------------- |
| `ask`            | `llama-3.1-8b-instant`     | `qwen/qwen3.6-27b` -> `llama-3.3-70b-versatile` -> `openai/gpt-oss-20b` |
| `analyze`        | `openai/gpt-oss-20b`       | `qwen/qwen3.6-27b` -> `llama-3.3-70b-versatile` -> `llama-3.1-8b-instant` |
| `analyze --deep` | `openai/gpt-oss-120b`      | `llama-3.3-70b-versatile` -> `qwen/qwen3.6-27b` -> `openai/gpt-oss-20b` |

Each model receives up to three exponential-backoff retries for HTTP 429.
After those retries, or when a model is unavailable or returns HTTP 5xx,
DevMap advances to the next unique model. Credentials and invalid requests do
not trigger failover. The chain is resolved before streaming emits content, so
a fallback cannot duplicate a partially rendered answer.

Model IDs in this table were confirmed active through the Groq model-list API
on 2026-06-20. Recheck provider lifecycle status before publishing a release.

Users can override automatic routing with `devmap config model <model>`.
Running `devmap config model auto` restores the defaults above.

Raw provider errors should not be shown directly to users.

---

## Streaming AI Output

Groq chat completions use server-sent events for human-readable `analyze` and
`ask` output. The provider adapter reconstructs the complete response while
emitting incremental deltas to the output layer.

Terminal Markdown is buffered to paragraph boundaries before rendering. This
keeps headings, lists, tables, wrapping, and inline formatting readable while
still showing the answer before generation has fully completed.

Rules:

* streaming is an optional `AiClient` capability
* commands fall back to regular completion for clients without streaming
* the final reconstructed text is used for snapshot persistence and metadata
* rate-limit retry and ordered model fallback happen before consuming response deltas
* `--json` never streams because stdout must contain one complete JSON document

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
* lightweight agent index in `.devmap/index.json`
* focused maps in `.devmap/features/*.json`

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
.devmap/index.json
.devmap/features/*.json
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

### Agent Output

Every MVP command supports `--json`. JSON mode is implemented at the output
context layer so nested operations, such as `ask` triggering quick analysis,
do not leak human progress text into stdout.

Rules:

* emit exactly one JSON document to stdout
* suppress ANSI, Markdown rendering, bullets, and separators
* keep human output as the default
* use structured error objects and preserve non-zero exit codes for thrown failures
* keep command result schemas stable enough for agents and scripts

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
