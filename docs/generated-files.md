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

Its navigation contract uses this order:

1. `.devmap/index.json`
2. the relevant `.devmap/features/*.json` map
3. files listed in `sourcePriority`
4. `.devmap/snapshot.json` only when the lightweight maps are insufficient

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

## .devmap/index.json

Generated during `devmap analyze`.

This is the primary machine-readable entry point for AI coding agents. It
contains project identity, entry points, a short critical-file list, and compact
feature descriptors that link to focused feature maps. It intentionally omits
full dependency and change-impact data.

Its critical-file list prioritizes executable entry points, feature entry
points, and one behavioral support file per feature before falling back to
global importance scores. Type-only hubs are not promoted solely because many
files import them.

---

## .devmap/features/*.json

Generated during `devmap analyze`, one file per detected feature. Stale
generated feature maps are removed on the next analysis.

Each map contains a summary, entry points, related files with roles, optional
behavior flow, keywords, confidence, and `sourcePriority`. These maps bridge
the compact index and the source code.

---

## .devmap/snapshot.json

Generated during:

devmap analyze

Purpose:

- Project snapshot
- Source of truth for ask
- Full reusable AI context archive and debugging data

Regenerated when project files change or when `devmap analyze --fresh` is used.
An unchanged project reuses the existing snapshot.

### Schema Version 1

The snapshot contains:

- `version` and `generatedAt`
- `fingerprint` for stale snapshot detection
- project name, root, framework, project/workspace type, language, and package manager
- file and line statistics
- entry points and scored critical files with reasons
- page routes and API routes
- dependencies and external services
- database and feature evidence
- compact per-file hashes, imports, exports, and line counts
- normalized analyzer id, confidence, symbols, and top-function metadata

The snapshot does not store full source file content.

If the schema is unsupported or corrupt, DevMap asks the user to regenerate it
with `devmap analyze --fresh`.
