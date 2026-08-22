# `devmap doctor`

**Source:** `packages/cli/src/commands/doctor.ts`

A diagnostic command with one design choice worth understanding up front:
it deliberately **doesn't trust the cached snapshot** for the facts it
reports about the project's current state — it re-derives them fresh,
specifically so a stale snapshot becomes something `doctor` can detect
rather than something it unknowingly relies on.

## Four independent checks, gathered in parallel

```ts
const [config, localConfig, snapshotResult, files] = await Promise.all([
  loadConfig(),
  loadLocalConfig(projectRoot),
  inspectSnapshot(projectRoot),
  scanFiles(projectRoot)
]);
const framework = detectFramework(files);
const frameworks = detectFrameworks(files);
const project = detectProjectMetadata(projectRoot, framework, files, frameworks);
```

The last three lines are the important detail: `doctor` runs its own
independent `scanFiles` + `detectFramework`/`detectFrameworks` +
`detectProjectMetadata` (ch. 2, ch. 3) **from scratch**, rather than
reading `project`/`framework` off whatever's in `.devmap/snapshot.json`.
This means the `Project`/`Framework`/`Workspace Frameworks` lines in
`doctor`'s output always reflect the actual current filesystem — and the
separate `Snapshot: <status>` line reflects the *cached* snapshot's own
state. If those two disagree (a project's framework changed since the
snapshot was last generated), that disagreement is visible rather than
papered over — which is exactly the kind of thing a diagnostic command
should surface, not hide.

## Config layering, surfaced for inspection

```ts
const modelSource = config && localConfig?.model ? "project override" : "global";
const effectiveConfig = config && localConfig?.model ? { ...config, model: localConfig.model } : config;
```

This is ch. 14's global/local config merge, reimplemented inline here
specifically so `doctor` can report **which** config layer the active
model actually came from (`describeModel()` appends `(project override)`
or `(global)` to the displayed model name) — a plain read via
`resolveEffectiveConfig()` wouldn't expose that provenance, only the
final merged value.

## API key status has three distinct outcomes, only one of which touches the network

1. **No config at all** → `"not configured"` for both API key and model,
   issue: run `devmap init`.
2. **Config exists, but no `apiKey` or no resolvable model** → `"missing"`,
   issue: run `devmap init` again.
3. **Config and apiKey both present** → an actual **live network call**
   via `inspectAiProvider()` (ch. 12's `inspectGroqProvider`/
   `inspectOpenRouterProvider`) to confirm the key still authenticates
   *and* the selected model is still available right now:

```ts
const provider = await inspectProvider(config.apiKey, selectedModel, config.provider);
apiKeyStatus = provider.reachable ? "valid" : "unreachable";
modelStatus = provider.modelAvailable
  ? describeModel(selectedModel, modelSource)
  : describeModel(`unavailable: ${selectedModel}`, modelSource);
```

This is the check that catches a key that validated fine at `init` time
but has since been revoked, or — directly connecting to ch. 12's note
about Groq's model catalog changing over time — a previously-valid model
that's since been decommissioned. A thrown error here (network failure,
invalid key) is caught and reported as an issue rather than crashing
`doctor` itself; a diagnostic tool failing because the thing it's
diagnosing is broken would defeat the purpose.

## What ends up in `issues[]`

Beyond the provider check, two more conditions append to the same
`issues` array: Node.js below `MINIMUM_NODE_MAJOR = 18`
(`readNodeMajor()` parses the major version out of `process.version` via
a simple regex), and a snapshot status of `"corrupt"` or `"unsupported"`
(ch. 14's `SnapshotStatus` union) — both suggest concrete next commands
(`devmap analyze --fresh`, an engine upgrade) rather than just naming the
problem. An empty `issues` array is the only condition that prints
`"No issues found"`; every other combination lists each issue as a
`output.warning()` line, and the same list appears verbatim in the
`--json` payload's `issues` field.

## See also

- Ch. 2/3 for `scanFiles`/`detectFramework`/`detectFrameworks`, re-run
  here independently of the cached snapshot
- Ch. 12 for `inspectAiProvider` and why Groq specifically needs this kind
  of live check
- Ch. 14 for `SnapshotStatus` and the global/local config merge this
  command re-derives for display purposes
