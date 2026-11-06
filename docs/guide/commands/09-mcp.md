# `devmap mcp`

**Source:** `packages/cli/src/commands/mcp.ts` (entry) and `packages/cli/src/mcp/`
(the server). For usage, see [`docs/mcp.md`](../../mcp.md).

Every other command is a one-shot: it runs, prints, exits. `devmap mcp` is the
first long-lived front-end, which changes three things that the rest of the CLI
never had to care about: **stdout is a protocol**, **state outlives a single
call**, and **the caller is not a person**. Most of the design follows from those.

## Layout

| File | Role |
|---|---|
| `commands/mcp.ts` | Process wiring: redirect `console.*` to stderr, create the server, connect stdio, shut down on SIGINT/SIGTERM/stdin end |
| `mcp/server.ts` | `createDevmapServer()`: registers tools, resources and prompts |
| `mcp/queries.ts` | Pure functions over a `ProjectMap` (`buildOverview`, `queryRoutes`, `queryImpact`, `queryFind`); no I/O |
| `mcp/snapshotProvider.ts` | Cached snapshot + staleness, optional auto-refresh |
| `mcp/refresh.ts` | `createRefresher()` (single-flight analysis) and the cross-process lock |
| `mcp/prompts.ts` | `devmap_onboard`, `devmap_plan_change` |

`createDevmapServer()` takes `provider`, `refresher`, `analyze` and
`explainDependencies` as options. That is the same "every command takes a
Dependencies object" rule from `CLAUDE.md`, and it is what lets the tests run the
whole server in memory with a fake analyzer and a fake AI client.

## Reuse, not a second analyzer

`map`, `flow`, `analyze` and `explain` each export a `run*` function
(`runMap`, `runFlow`, `runAnalyze`, `runExplain`) that the CLI command wraps. The
MCP tools call the same functions with options that make them safe for a server:

| Option | Where | Effect |
|---|---|---|
| `write: false` | `runMap`, `runFlow` | Compute the result without writing `.devmap/maps` or `.devmap/flows` |
| `narrate: false` | `runFlow` | Skip AI narration and do not even load the config |
| `offline: true` | `runAnalyze` | No domain inference, no snapshot enrichment, no architecture interpretation |
| `loaded` | `runMap`, `runFlow`, `runExplain` | Use a snapshot the caller already holds instead of re-reading and re-scanning |

`offline` is the guarantee behind "static by default": with it set,
`buildCallAI` is never called, so the AI config is never read. A test installs an
AI client that throws when created, with an API key configured, and asserts it
stays untouched.

## stdout is the protocol

The stdio transport reads JSON-RPC from stdin and writes it to stdout. Anything
else printed to stdout corrupts the stream, and the client reports a parse error
or drops the connection.

Two mechanisms keep it clean:

1. `mcpCommand()` replaces `console.log`, `console.info` and `console.debug` with
   `console.error` before the server starts.
2. Every call into a `run*` function is wrapped in `withJsonOutput()`
   (`AsyncLocalStorage` set to `"json"`), which turns `output.section`,
   `output.note`, `output.spinner` and the rest into no-ops. This is the same switch
   `--json` uses, so no command needed a new "quiet" mode.

The stdio tests start a real child process and fail on any non-JSON-RPC line,
because the SDK's transport reports them through `onerror`.

## The snapshot provider

A tool call must be cheap, but the CLI's `loadSnapshot()` reads and parses
`snapshot.json` and re-scans the project to compute staleness. `createSnapshotProvider()`
adds two caches:

- The parsed snapshot is kept until the **mtime** of `snapshot.json` changes. A
  snapshot rewritten by `devmap analyze` in another terminal is picked up on the
  next call.
- The staleness result is kept for `staleTtlMs` (10 s), and dropped whenever the
  snapshot is reloaded.

With `autoRefresh` set, `get()` rebuilds when the snapshot is missing or stale
and then reloads. If the rebuild throws and a snapshot exists, the old one is
returned with `refreshError`, and further attempts are suppressed for
`retryCooldownMs` (30 s) so a persistent failure does not turn every query into a
slow failed analysis. If there is no snapshot at all, the failure is the real
error and is thrown.

`queryImpact()` also memoizes a reverse import graph per snapshot in a
`WeakMap<ProjectMap, …>`, so the cache disappears with the snapshot object.

## Refreshing: single flight plus a lock

`createRefresher().run()` has two layers of exclusion:

- **In-process**: concurrent calls get the same promise (`inflight`). Two agent
  tool calls cause one analysis.
- **Cross-process**: `acquireLock()` creates `.devmap/analyze.lock` with
  `open(path, "wx")` (atomic create-or-fail) and writes `{ pid, startedAt }`.
  If the file exists, the lock is taken over when the pid is no longer alive
  (`process.kill(pid, 0)`; `EPERM` counts as alive) or when it is older than
  `LOCK_STALE_MS` (15 min); otherwise it throws a `DevmapError` with a retry hint.

Before taking the lock, `run()` checks staleness. When nothing changed it returns
`unchanged` without touching the lock or the analyzer, so a call that has nothing
to do is also never blocked by another process's analysis.

`devmap analyze` in the terminal takes the same lock (`analyzeCommand` wraps
`runAnalyze`). `runAnalyze` itself does not, because the refresher already holds
the lock when it calls it. If a terminal analysis is running, `devmap_analyze`
returns the "already running" error, and `devmap analyze` fails the same way
while the server is refreshing.

### `aiDataDropped`

A static rebuild produces a snapshot without `domain` or `ai`. The refresher
compares the previous snapshot with the new one and reports `aiDataDropped` when
the old one had them and the new one does not, so a rebuild never silently
discards what `devmap analyze` paid an AI provider for. If `analyze` decides the
project is unchanged, it reuses the previous snapshot (and its AI data); the
refresher detects that by `generatedAt` and reports `unchanged`.

## `devmap_analyze` and time

Clients have their own tool timeouts, so the tool does not hold the request open
indefinitely:

- `waitFor(run, timeoutSeconds)` races the shared analysis against a timer. On
  timeout the tool answers `status: "running"` and the analysis **keeps going**; the
  next call joins it through `inflight`.
- While waiting, a heartbeat sends `notifications/progress` every 5 s, but only if
  the request carried a `progressToken`.
- When the run settles, `provider.invalidate()` drops the cached snapshot, even
  if the request that started it already stopped waiting.

## Tool results

`ok()` and `fail()` wrap everything. `fail()` turns a `DevmapError` into
`{ error, hint }` with `isError: true`, so an agent gets the same actionable text a
person would see in the terminal ("Run devmap analyze first."). Unexpected errors
get a plain `{ error }`.

Sizes are bounded in `server.ts`: `truncateText()` caps text at 30,000
characters (8,000 per flow, 20 flows), and list queries clamp `limit` through
`clampLimit()` (1–100). The result says `truncated` instead of silently cutting.

## `devmap_explain` is registered conditionally

It is added only `if (options.allowAi)`. An unregistered tool does not exist for
the client: calling it returns "Tool devmap_explain not found". This is a
stronger guarantee than checking a flag inside the handler, because the agent is
not even told the tool exists. `runExplain` still requires a configured provider,
so a missing key is the same `devmap init` error as on the command line.

## Resources

`devmap://feature/{id}` is a `ResourceTemplate` whose `list` reads
`.devmap/features/`. The `id` is checked against `^[a-z0-9][a-z0-9-]*$` before it
is joined into a path, which rules out `..` and path separators.

## Testing

| File | Covers |
|---|---|
| `test/core-api.test.ts` | `runMap`/`runFlow`/`runAnalyze` options: silent, write-free, offline |
| `test/mcp-server.test.ts` | Tools, resources, stale and missing snapshots, provider caching, stdio process |
| `test/mcp-freshness.test.ts` | `devmap_analyze`, auto-refresh and back-off, lock, transitive impact, prompts, stdio with a real analysis |
| `test/mcp-explain.test.ts` | `devmap_explain` gating, errors, truncation, registry metadata |
| `test/mcp-smoke.mjs` | The compiled `dist/` as a stdio server; run by CI and before `npm publish` |
| `test/package-e2e.mjs` | The packed tarball starts as an MCP server in a fresh project |

Fixtures are copied to a temp directory and analyzed **there**. Analyzing the
fixture in place and saving the snapshot elsewhere makes the fingerprint differ
and every result report `stale: true`.
