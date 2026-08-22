# 14. Snapshot, Cache & Config

**Source:** `packages/cli/src/cache/`, `packages/cli/src/utils/config.ts`

The last few structural pieces: how `snapshot.json` gets written, read
back, and safely migrated across schema changes; the two different hash
algorithms in play across the codebase and why they're different; and how
DevMap resolves its own configuration across two files.

## MD5 vs SHA-256 — two hashes, two purposes, not interchangeable

You'll run into both across this guide, and it's worth having the
distinction settled in one place:

| | `hashContent()` (`cache/fileHash.ts`) | domain-inference cache key (ch. 11) |
|---|---|---|
| Algorithm | MD5 | SHA-256 |
| Input | one file's raw content | the entire serialized `DomainInferenceInput` |
| Used for | per-file content fingerprint (`fileIndex[path].hash`), and — concatenated across all files — the whole-project `fingerprint` (ch. 1) | cache key for whether an AI domain-inference call can be skipped |
| Why this algorithm | speed, non-cryptographic use — this runs once per file on every scan | still not a security boundary, but paired with an explicit `v: 2` schema-version field baked into the hashed payload, so a future shape change can deliberately invalidate every existing cache entry |

Neither is used for anything security-sensitive — both are pure content-
identity fingerprints. The reason they're not unified into one shared
utility is that they solve genuinely different problems: one needs to be
fast and run per-file at scan time across potentially thousands of files,
the other runs once per `analyze` call against a small structured payload
and benefits from an explicit version field to control invalidation.

## Snapshot persistence: `cache/snapshot.ts`

`saveSnapshot()`/`readSnapshot()` are the read/write pair around
`.devmap/snapshot.json`. The interesting part is `inspectSnapshot()` — the
full validation path, returning a tagged union rather than throwing
directly, so every caller can decide for itself how to react to each
outcome:

```ts
type SnapshotStatus =
  | { status: "missing" }
  | { status: "valid"; snapshot: ProjectMap }
  | { status: "corrupt"; error: string }
  | { status: "unsupported"; version: string };
```

Validation is layered, cheapest checks first: is it valid JSON and an
object at all → does `parsed.version` match the current
`SNAPSHOT_SCHEMA_VERSION` exactly (a **mismatch returns `"unsupported"`,
not an attempt to auto-upgrade** — more on this below) → do the required
top-level fields exist with the right container types → does every entry
in `fileIndex` pass a lightweight structural check (`isFileIndexEntry` —
four required fields, not a full schema validator). Only after all of that
passes does `normalizeSnapshotDefaults()` run.

### Two different kinds of "old snapshot," handled two different ways

It's worth being precise about a distinction the code itself draws:

- **A `version` field that doesn't match `SNAPSHOT_SCHEMA_VERSION` at
  all** → `"unsupported"`. `readSnapshotOrThrow()` turns this into an
  error telling the person to run `devmap analyze --fresh`. DevMap does
  not attempt to migrate across an incompatible major schema change.
- **A snapshot at the *current* schema version, but missing fields added
  in a later minor change** (new optional fields introduced without a
  version bump) → handled entirely inside `normalizeSnapshotDefaults()`,
  which patches in sensible defaults for anything missing: an empty
  `flows` array, an empty `onboarding.recommendedPath`, an empty
  `changeImpact` map, `"medium"` confidence for any feature missing one,
  and so on.

The `projectTypes` migration inside that function is the most involved
shim, and its comment explicitly cross-references the code it has to stay
in sync with:

```ts
// Migration shim for snapshots that predate `projectTypes`. The canonical
// field is now an array so a single project can be both a CLI and a web
// app (mixed workspaces). Mirrors the framework-first classification in
// detectProjectTypes() (analyzers/pipeline/projectMetadata.ts) — keep
// the two in sync.
```

A snapshot written before multi-type support existed only has a singular
`project.projectType` string (or, older still, nothing at all — inferred
from `framework` via the same frontend/backend set lookup ch. 3's
framework lists provide). This shim exists specifically so an old
`snapshot.json` doesn't have to be regenerated just because a newer
DevMap version reads a field that didn't used to exist — but it means the
shim's fallback logic and `projectMetadata.ts`'s actual detection logic
are two separate implementations of "how do we guess a project's type,"
one live and one frozen-in-amber for backward compatibility. If
`detectProjectTypes()`'s logic changes meaningfully, this shim's inference
doesn't automatically follow — that's the "keep the two in sync" the
comment is asking of anyone editing either side.

A similar smaller rename lives right above it: an older
`agentInstructions.navigationPolicy` value of `"snapshot-first"` is
rewritten to today's `"index-first"` — a direct trace of the project's own
navigation philosophy having changed at some point (snapshot.json used to
be the primary agent-facing artifact; ch. 13's `index.json` + feature maps
took over that role later).

`isSnapshotStale()` is a small, separate helper — re-scan the project,
recompute the fingerprint, compare against the stored one. This is the
same fingerprint mechanism from ch. 1, just invoked standalone (used by
`devmap doctor` and anywhere else that needs a stale/fresh check without
running a full `analyze`).

## Config: two files, one merge direction

**Source:** `utils/config.ts`

Two separate config files, deliberately scoped differently:

- **Global** (`~/.devmap/config.json`) — `{ provider, apiKey?, model }`.
  This is the only place an API key is ever read from.
- **Local** (`<project>/.devmap/config.local.json`) — `{ model? }` only.

`resolveEffectiveConfig()` reads global first (if it's missing, there's no
config at all — return `null` immediately, no point reading local), then
overlays local **only if it specifies a model**:

```ts
return local?.model ? { ...global, model: local.model } : global;
```

This lets one project pin a specific model (say, a larger one for a big
monorepo) without duplicating — or risking accidentally committing — an
API key into per-project, potentially-version-controlled config.
`readLocalConfig()` actively guards this boundary: if `apiKey` or
`provider` ever show up in `config.local.json`, they're silently ignored
and a warning is printed (`output.warning`, ch. commands 7's `config`
command territory) rather than either erroring out or — worse — being
silently honored. `normalizeConfig()` similarly validates the *global*
file defensively: an invalid `provider` value or non-string `model`/`apiKey`
causes the whole config to be treated as absent (`null`) rather than
partially trusted.

## See also

- Ch. 1 for `createProjectFingerprint`/`SNAPSHOT_SCHEMA_VERSION` and where
  they're produced
- Ch. 3 for `FRONTEND_FRAMEWORK_SET`/`BACKEND_FRAMEWORK_SET`, reused
  directly by the `projectTypes` migration shim
- Ch. 11 for the SHA-256 domain-inference cache, the other half of the
  hash-algorithm comparison above
- Ch. 13 for `index.json`/feature maps, the artifacts that made
  `navigationPolicy` shift away from `"snapshot-first"`
