# Contributing to DevMap

Thanks for your interest in contributing. This document covers everything
you need to get started.

---

## Project Structure

```
devmap/
├── apps/
│   └── web/               ← landing page (post-MVP, not active yet)
├── packages/
│   └── cli/               ← core CLI — this is where you'll work
│       ├── src/
│       │   ├── commands/  ← one file per CLI command
│       │   ├── analyzers/ ← static analysis logic
│       │   ├── ai/        ← AI provider abstraction
│       │   ├── cache/     ← file hashing + snapshot
│       │   └── utils/     ← output, config, helpers
│       └── test/
│           └── fixtures/  ← dummy projects for testing
├── docs/                  ← PRD, architecture, commands, roadmap
└── README.md
```

Most contributions will be inside `packages/cli/src/`.

---

## Setup

**Requirements:** Node.js 18+, pnpm

```bash
# Clone the repo
git clone https://github.com/Mufacoderz/devmap
cd devmap

# Install dependencies
pnpm install

# Link CLI globally so you can test it like a real user
cd packages/cli
npm link

# Verify it works
devmap --version
```

---

## Development Workflow

```bash
# Run CLI in development (no build needed)
cd packages/cli
pnpm dev

# Or run a specific command directly
npx tsx src/index.ts analyze
npx tsx src/index.ts ask "how does auth work"

# Build for production
pnpm build

# Run tests
pnpm test
```

---

## Testing Your Changes

Always test against real projects, not just the fixtures.

```bash
# Go to any real project on your machine
cd ~/projects/some-nextjs-app

# Run devmap against it
devmap analyze
devmap ask "how does auth work"
devmap doctor
```

The fixture projects in `test/fixtures/` are for automated tests.
Manual testing against real projects catches things fixtures miss.

**Before submitting a PR, test against at least:**
- A Next.js project
- An Express project
- A project with many files (100+)

---

## Adding a New Command

1. Create `packages/cli/src/commands/yourcommand.ts`
2. Implement the command logic
3. Register it in `packages/cli/src/index.ts`
4. Add documentation to `docs/COMMANDS.md`
5. Add test fixtures if needed

Follow the pattern of existing commands — use `output.ts` utilities
for all terminal output, never `console.log` directly.

---

## Adding a New AI Provider

1. Create `packages/cli/src/ai/yourprovider.ts`
2. Implement the provider interface:

```ts
export async function complete(options: CompleteOptions): Promise<string>
export async function isAvailable(): Promise<boolean>
export function getModels(): string[]
```

3. Register the provider in `packages/cli/src/ai/provider.ts`
4. Add the provider to `devmap init` options in `packages/cli/src/commands/init.ts`
5. Update the provider table in `README.md`

---

## Adding Framework Support

Framework detection lives in `packages/cli/src/analyzers/frameworkDetector.ts`.

Each framework needs:
- Detection logic (from `package.json` + file patterns)
- Entry point patterns specific to that framework
- Test fixture in `test/fixtures/`

Before adding a new framework, open an issue first to discuss.
Framework support affects output quality significantly —
better to do one framework well than many frameworks poorly.

---

## Code Style

- TypeScript strict mode is enabled — no `any` without a comment explaining why
- Use `output.ts` utilities for all terminal output
- Keep command files thin — business logic belongs in `analyzers/` or `ai/`
- Prompts belong in `ai/prompts.ts`, never inline in command files
- One responsibility per file

---

## Pull Request Guidelines

**Small PRs are easier to review.** If you're adding a big feature,
open an issue first to discuss the approach before writing code.

PR checklist:
- [ ] Tested against a real Next.js project
- [ ] Tested against a real Express project
- [ ] No raw `console.log` in command files
- [ ] New commands documented in `docs/COMMANDS.md`
- [ ] `devmap doctor` still passes after your changes

---

## Reporting Bugs

Run `devmap doctor` first and include the output in your bug report.
This gives all the context needed to reproduce the issue.

Open an issue with:
1. `devmap doctor` output
2. What command you ran
3. What you expected to happen
4. What actually happened

---

## Roadmap & Feature Requests

Check `docs/ROADMAP.md` before requesting a feature —
it might already be planned.

For features not in the roadmap, open an issue with:
- The problem you're trying to solve
- Why existing commands don't solve it
- What the command/output would look like

Features that solve real problems with clear use cases
get prioritized over features that are technically interesting.

---

## License

By contributing, you agree your contributions will be licensed under MIT.