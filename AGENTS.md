# DevMap — Agent Instructions

DevMap is a CLI tool for understanding unfamiliar codebases quickly and cheaply.

## Product Goal

Help developers understand project architecture, stack, routes, APIs, database schema, features, and onboarding paths without reading every file manually.

## MVP Commands

- `devmap analyze` — detect framework, stack, package manager, routes, APIs, DB/schema, external services.
- `devmap explain` — explain folder/file purpose and architecture.
- `devmap features` — detect features such as auth, payments, AI, upload, email, notifications.
- `devmap ask` — answer questions using relevant project context.
- `devmap flow` — produce architecture/user/data flow summaries.

## Core Rules

1. Static analysis first, LLM second.
2. Never send whole projects to the LLM when a compact summary is enough.
3. Ignore heavy/generated folders: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `public/assets`, minified files, maps, locks, logs.
4. Prefer deterministic parsing over regex-only guessing.
5. If uncertain, state uncertainty and show evidence.
6. Keep functions small and focused.
7. Avoid unnecessary dependencies.
8. Preserve existing project style unless there is a clear reason to improve it.
9. Do not modify secrets or `.env` files.
10. Update docs when behavior or command output changes.

## Preferred Architecture

Use a clean CLI + analyzer architecture:

```txt
src/
  cli/
    commands/
  analyzers/
    framework/
    routes/
    api/
    database/
    features/
  core/
    scanner/
    cache/
    summary/
  llm/
  utils/
```

Suggested flow:

```txt
CLI command
  -> scanner reads project files safely
  -> analyzers produce structured JSON
  -> cache stores reusable results
  -> optional LLM summarizes compact JSON
  -> renderer prints markdown/terminal output
```

## Coding Standards

Use TypeScript with clear types. Prefer explicit return types for exported functions. Keep IO, parsing, and rendering separated. Do not mix CLI prompt logic with analyzer logic.

## Verification Process

Before marking a task done:

1. Run format/lint/typecheck if scripts exist.
2. Run tests if scripts exist.
3. For CLI changes, run at least one local command manually.
4. Check that generated output is readable and stable.
5. Mention what was verified and what was not.

## Relevant Skills

ECC skills are stored in `.agents/skills/`.

Use these when relevant:

- `coding-standards` — code quality and consistency.
- `verification-loop` — build, lint, typecheck, test, manual verification.
- `documentation-lookup` — check current library docs instead of guessing.
- `backend-patterns` — service/repository/validation patterns.
- `deep-research` — research parser/framework/library behavior.
- `security-review` — secrets, command execution, file access, user input.
- `tdd-workflow` — tests for new analyzers and bug fixes.
- `eval-harness` — benchmark DevMap output on sample repositories.
- `strategic-compact` — keep long agent sessions manageable.
- `agent-introspection-debugging` — recover when the agent loops or gets stuck.

## DevMap-Specific Test Ideas

Create fixture projects under `examples/` or `fixtures/`:

- Next.js app with App Router routes.
- Express API with controllers/services.
- Prisma schema with relations.
- Project with auth/payment/upload/AI dependencies.
- Minimal Vite/React project.

Analyzer tests should assert structured output, not only snapshots.
