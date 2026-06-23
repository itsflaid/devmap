# DevMap

This repository uses DevMap to create reusable project context for developers and AI agents.

## Project Context

- Detected framework: astro
- Agent navigation index: `.devmap/index.json`
- Feature maps: `.devmap/features/*.json`
- Full analysis archive: `.devmap/snapshot.json`
- DevMap config: `~/.devmap/config.json`

## Recommended Workflow

1. Run `devmap analyze` after cloning the repository.
2. Run `devmap analyze --fresh` after major architecture changes.
3. Use `devmap ask "<question>"` before manually exploring unrelated files.
4. Treat DevMap output as an architecture overview, then verify critical behavior in source code.

## Commands

```bash
devmap analyze
devmap analyze --json
devmap ask "how does authentication work?"
devmap ask "where is authentication handled?" --json
devmap doctor
devmap doctor --json
```

## Agent Navigation Contract

This repository uses DevMap as the primary navigation source. Use the lightweight
navigation files before broad repository exploration.

Preferred reading order:

1. Read `.devmap/index.json`.
2. Pick the relevant feature using its name and keywords.
3. Open the matching `.devmap/features/*.json` map.
4. Inspect only the files listed in `sourcePriority` first.
5. Read `.devmap/snapshot.json` only when the index and feature maps are
   insufficient or full archive/debug context is required.

Do not scan the whole repository first.

Open source files only when:

- the snapshot is missing;
- the snapshot is stale;
- the snapshot does not contain enough detail;
- exact implementation is required;
- the task is edit, debug, or refactor;
- the user explicitly asks for code changes.

When source inspection is needed, inspect the smallest relevant set first.
Prefer feature entry points and flow steps over broad folder exploration.

## Required Agent Workflow

1. Read `DEVMAP.md`.
2. Read `.devmap/index.json`.
3. Open the relevant feature map.
4. Inspect at most the smallest relevant source-file set from `sourcePriority`.
5. Explain which navigation entry guided the decision when giving advice.
6. Avoid unrelated files unless the navigation data is incomplete or exact
   code verification is required.

If `.devmap/index.json` or `.devmap/snapshot.json` is missing, run
`devmap analyze` when DevMap is available and configured. If analyze fails
because DevMap is not initialized, ask the user to run `devmap init` and then
`devmap analyze`.

If the snapshot may be stale, run `devmap analyze --fresh` before relying on
it.

Use `--json` when calling DevMap programmatically so stdout remains one
parseable JSON document without ANSI or terminal decoration.

Do not edit generated files inside `.devmap/`.

## Repository Safety

- `.devmap/` is local generated state and should stay out of Git.
- Never commit API keys or provider credentials.
- DevMap helps locate relevant code; it does not replace source-level verification.
