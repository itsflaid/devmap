# devmap

This project appears to be a personal search tool, allowing a single user to search and manage their own data.
`Typescript · Groq · OpenRouter`

---

## What this is

### Overview
The provided DevMap static analysis snapshot describes a TypeScript-based Node.js CLI project named "devmap". The project is part of a monorepo workspace and is designed to analyze, map, and explain codebases using AI.

### Main Entry Points
The project has multiple entry points, including:
* `src/analyzers/analysis/extractors/index.ts`
* `src/analyzers/analysis/index.ts`
* `src/analyzers/analysis/preprocessors/index.ts`
* `src/analyzers/detectors/index.ts`
* `src/analyzers/features/index.ts`
* `src/analyzers/graph/index.ts`
* `src/analyzers/inference/index.ts`
* `src/analyzers/pipeline/index.ts`
* `src/index.ts`

### Important Relationships
The project has several critical files that are highly referenced and play a crucial role in the project's functionality:
* `src/analyzers/pipeline/projectMap.ts`: Core execution responsibility and semantic feature anchor.
* `src/analyzers/analysis/index.ts`: Application entry point and framework convention.
* `src/analyzers/features/index.ts`: Application entry point, semantic feature anchor, and framework convention.
* `src/ai/types.ts`: Semantic feature anchor and imported by multiple files.

### File Paths
Relevant file paths include:
* `src/analyzers/`: Contains various analyzers, detectors, and features.
* `src/ai/`: Contains AI-related functionality, including context builders and types.
* `src/utils/`: Contains utility functions, including error handling and output rendering.
* `src/index.ts`: The main entry point of the project.

### Features
The project has several features, including:
* **Authentication**: Manages user login and session management.
* **Caching**: Improves performance by storing frequently accessed data.
* **CLI Commands**: Handles command-line interface interactions.
* **Documentation**: Provides user guides and reference materials.
* **Personal Data Indexing**: Manages indexing of personal user data (confidence: medium).
* **Search**: Enables searching and querying of data.

### Dependencies
The project depends on the following packages:
* `commander`
* `ts-morph`
* `@types/node` (dev dependency)
* `tsx` (dev dependency)
* `typescript` (dev dependency)

### External Services
The project uses the following external services:
* Groq
* OpenRouter Integrates with Groq, OpenRouter.

## How it works

1. User runs a command from the terminal.
2. The CLI reads configuration and determines the required process.
3. Available commands include: CLI Commands.
4. Results are saved or displayed based on the given flags.

## What's inside

| Feature | What it does |
|---------|-------------|
| Authentication | Manages user login and session management.. Entry: `src/ai/contextBuilder.ts` |
| Caching | Improves performance by storing frequently accessed data.. Entry: `src/cache/agentNavigation.ts` |
| CLI Commands | Handles command-line interface interactions.. Entry: `src/index.ts` |
| Documentation | Provides user guides and reference materials.. Entry: `README.md` |
| Personal Data Indexing | Manages indexing of personal user data.. |
| Search | Enables searching and querying of data.. Entry: `src/analyzers/analysis/extractors/index.ts` |

## Start here

| # | File | Why read this |
|---|------|---------------|
| 1 | `src/ai/contextBuilder.ts` | Understand who can access what before reading anything else |
| 2 | `test/fixtures/nextjs-project/prisma/schema.prisma` | Understand the data model and entity relationships |
| 3 | `src/analyzers/analysis/extractors/index.ts` | Execution entry point — see available commands or routes |
| 4 | `src/analyzers/analysis/index.ts` | Execution entry point — see available commands or routes |
| 5 | `src/cache/agentNavigation.ts` | Entry point for caching |
| 6 | `src/index.ts` | Entry point for cli commands |
| 7 | `src/analyzers/pipeline/projectMap.ts` | This file runs first when the project starts |
| 8 | `src/analyzers/features/index.ts` | Important file based on the project dependency structure |
| 9 | `src/ai/types.ts` | Imported by 8 other files — highly central |
| 10 | `README.md` | Important file for understanding project context |
| 11 | `package.json` | Important file for understanding project context |
| 12 | `src/analyzers/analysis/preprocessors/index.ts` | Important file for understanding project context |
| 13 | `src/analyzers/detectors/index.ts` | Important file for understanding project context |
| 14 | `src/analyzers/graph/index.ts` | Important file for understanding project context |
| 15 | `src/analyzers/inference/index.ts` | Important file for understanding project context |
| 16 | `src/analyzers/pipeline/index.ts` | Important file for understanding project context |

## Key flows

### Authentication flow

`src/ai/contextBuilder.ts`
  ├─ Configure auth provider in test/fixtures/nextjs-project/lib/auth.ts.
  └─ Expose session context in src/ai/provider.ts.

### CLI Commands flow

`src/index.ts`
  ├─ Parse and dispatch command in src/analyzers/analysis/extractors/index.ts.
  ├─ Execute command handler in src/commands/analyze.ts.
  └─ Render output in src/utils/output.ts.

## Go deeper

- `devmap analyze <target>` — analyze project structure and generate a static map
- `devmap doctor` — diagnose DevMap setup issues
- `devmap config model <model>` — set a model override or restore automatic routing
- `devmap init` — initialize DevMap configuration

---
*Generated by DevMap · Run `devmap analyze` to refresh*
