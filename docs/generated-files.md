# Generated Files

## DEVMAP.md

Generated during:

devmap init

Purpose:

- Human instructions
- AI instructions
- Explain DevMap workflow

---

## AGENTS.md

Generated or updated during:

devmap init

Purpose:

Direct AI agents to DevMap.

Generated `DEVMAP.md` tells AI agents to use command-level `--json` output
instead of parsing decorated terminal text. This applies to `analyze`, `ask`,
and `doctor`, while `init --json` is intended for non-interactive setup with an
environment API key.

Rules:

- Never overwrite existing file
- Create a basic file when `AGENTS.md` does not exist
- Ask before appending to an existing regular file
- Append only the small DevMap instruction block
- Skip an existing file in non-interactive mode
- Do not append the block more than once
- Refuse to update a symlinked `AGENTS.md`

Confirmation:

```text
AGENTS.md exists. Append DevMap instructions? [y/N]:
```

Only `y` or `yes` appends the block. Any other answer preserves the existing
file unchanged.

---

## .devmap/snapshot.json

Generated during:

devmap analyze

Purpose:

- Project snapshot
- Source of truth for ask
- Reusable AI context

Regenerated when project files change or when `devmap analyze --fresh` is used.
An unchanged project reuses the existing snapshot.

### Schema Version 1

The snapshot contains:

- `version` and `generatedAt`
- `fingerprint` for stale snapshot detection
- project name, root, framework, language, and package manager
- file and line statistics
- entry points and scored critical files with reasons
- page routes and API routes
- dependencies and external services
- database and feature evidence
- compact per-file hashes, imports, exports, and line counts

The snapshot does not store full source file content.

If the schema is unsupported or corrupt, DevMap asks the user to regenerate it
with `devmap analyze --fresh`.
