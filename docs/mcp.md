# DevMap as an MCP Server

`devmap mcp` runs DevMap as a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio. An AI agent can ask the project map questions with tool calls
instead of reading a dumped context file or exploring the repository from scratch.

```txt
Agent  ──tool call──▶  devmap mcp  ──reads──▶  .devmap/snapshot.json
        ◀─structured JSON─
```

The CLI and the MCP server share one analyzer and one snapshot. The server is a
thin layer: it never has its own copy of the analysis.

## When to use which

| | CLI + generated files | MCP server |
|---|---|---|
| Who calls it | You, or an agent through the shell | The agent, directly |
| Context | `DEVMAP.md` / `AGENTS.md` read at the start | Specific questions answered when needed (fewer tokens) |
| Output | Text, Markdown, files | Structured JSON |
| Freshness | Stale until you run `devmap analyze` | Every answer says whether it is stale; can refresh |
| Works with | Any agent that can read files | Clients that support MCP |

They complement each other. Keep `devmap init` for the files, add the MCP server
for live queries.

---

## Quick start

**1. Analyze the project once**

```bash
cd your-project
npx @flaid/devmap analyze
```

This writes `.devmap/snapshot.json`. (The MCP server can also build it for you, see
[Freshness](#freshness-and-the-snapshot).)

**2. Register the server in your client** (see [Client setup](#client-setup))

```bash
claude mcp add devmap -- npx -y @flaid/devmap mcp
```

**3. Ask the agent**

> "Use DevMap to explain how authentication works, then tell me what I would break by changing `lib/session.ts`."

The agent starts with `devmap_overview`, traces flows with `devmap_flow`, and
checks `devmap_impact` before touching a shared file.

---

## Client setup

Every client launches the same command: `npx -y @flaid/devmap mcp`. Most clients
start the server in the folder you opened. If yours does not, add
`--root /absolute/path/to/project`.

> **Tip: install globally for faster starts.** `npx` downloads the package the
> first time, which can exceed a client's startup timeout. After
> `npm install -g @flaid/devmap`, use `devmap` as the command with `mcp` as the
> argument. The same applies if your client cannot launch `npx` on Windows.

### Claude Code

```bash
# only you, this project
claude mcp add devmap -- npx -y @flaid/devmap mcp

# shared with the team through .mcp.json (checked into the repo)
claude mcp add --scope project devmap -- npx -y @flaid/devmap mcp
```

The project file looks like this:

```json
{
  "mcpServers": {
    "devmap": {
      "command": "npx",
      "args": ["-y", "@flaid/devmap", "mcp"]
    }
  }
}
```

Use `/mcp` inside Claude Code to check that the server is connected.

### Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "devmap": {
      "command": "npx",
      "args": ["-y", "@flaid/devmap", "mcp", "--root", "${workspaceFolder}"]
    }
  }
}
```

### opencode

`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "devmap": {
      "type": "local",
      "command": ["npx", "-y", "@flaid/devmap", "mcp"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

`timeout` is how long opencode waits for the tool list. Its default is 5 seconds,
which is too short for the first `npx` download.

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.devmap]
command = "npx"
args = ["-y", "@flaid/devmap", "mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 180
```

Codex's default tool timeout is 60 seconds. `devmap_analyze` can take longer on a
large project, so raise `tool_timeout_sec` or have the agent pass a smaller
`timeoutSeconds` (see [`devmap_analyze`](#devmap_analyze)).

### Any other MCP client

Configure a **stdio** server with command `npx` and arguments
`-y @flaid/devmap mcp`.

---

## Command

```bash
devmap mcp [--root <path>] [--auto-refresh] [--allow-ai]
```

| Flag | Default | Effect |
|---|---|---|
| `--root <path>` | current folder | Project root that contains `.devmap/snapshot.json` |
| `--auto-refresh` | off | Re-analyze automatically when the snapshot is stale or missing, before answering |
| `--allow-ai` | off | Let analysis use your configured AI provider, and expose `devmap_explain` |

stdout carries the JSON-RPC stream only. Logs go to stderr.

---

## Tools

All tools return one JSON document. Every result that comes from the snapshot
includes `snapshot: { generatedAt, stale }`.

| Tool | Purpose | Writes? |
|---|---|---|
| [`devmap_overview`](#devmap_overview) | Start here: framework, entry points, critical files, features, flows | No |
| [`devmap_map`](#devmap_map) | Dependency map of the project, one feature, or one file | No |
| [`devmap_flow`](#devmap_flow) | Trace a feature or API request end to end | No |
| [`devmap_routes`](#devmap_routes) | List page and API routes | No |
| [`devmap_impact`](#devmap_impact) | What is affected if a file changes | No |
| [`devmap_find`](#devmap_find) | Find features, files and routes by keyword | No |
| [`devmap_analyze`](#devmap_analyze) | Re-analyze and refresh the snapshot | `.devmap/` only |
| [`devmap_explain`](#devmap_explain) | AI explanation of a file, feature or function | No (needs `--allow-ai`) |

### `devmap_overview`

No input. Returns `project`, `stats`, `entryPoints`, `criticalFiles`, `features`
(name, purpose, confidence, entry point, file count), `flows`, `routeCounts`,
`database`, `externalServices`, `recommendedPath` and `nextSteps`.

### `devmap_map`

| Input | Type | Notes |
|---|---|---|
| `target` | string, optional | A feature name or a project-relative file path. Omit for the whole project |
| `depth` | 1–6, optional | Traversal depth for file and feature maps |
| `includeMermaid` | boolean, optional | Also return the Mermaid source (default false) |

Returns `mode` (`project`, `feature` or `file`), `target`, `markdown`, `truncated`.

### `devmap_flow`

| Input | Type | Notes |
|---|---|---|
| `target` | string, optional | Flow name; case-insensitive, partial match allowed when unique. Omit for the curated top flows |
| `all` | boolean, optional | Include lower-confidence features and non-API routes |

Static analysis only: no AI narration, nothing written. Returns `total`,
`truncated` and up to 20 `flows`, each with `name`, `type`, `purpose` and `markdown`.

### `devmap_routes`

| Input | Type | Notes |
|---|---|---|
| `kind` | `page` \| `api` \| `all` | Default `all` |
| `prefix` | string | Only paths that start with this, e.g. `/api/users` |
| `method` | string | HTTP method, e.g. `POST` |
| `limit` | 1–100 | Default 50 |

Returns `total`, `returned`, `truncated` and `routes` (`path`, `file`, `kind`, `methods`).

### `devmap_impact`

Call this before editing a shared file.

| Input | Type | Notes |
|---|---|---|
| `file` | string | Project-relative path. A unique path suffix also works |
| `depth` | 1–5 | Import hops to follow for dependents. Default 1 |
| `limit` | 1–100 | Max entries per list. Default 50 |

Returns, among others:

| Field | Meaning |
|---|---|
| `dependents`, `dependentCount` | Files that import this file directly |
| `transitive` | Everything that reaches the file within `depth` hops (`count`, `files` with their hop distance) |
| `criticalDependents` | Critical files among the transitive dependents |
| `affectedFeatures` | Features that contain the file or any dependent |
| `isCritical`, `criticalReasons` | Whether the file itself is ranked as critical |
| `impacts` | Areas DevMap expects to be affected |
| `imports` | Local files this file imports |

Import cycles are handled.

### `devmap_find`

| Input | Type | Notes |
|---|---|---|
| `query` | string | One or more keywords, e.g. `auth login` or `InvoiceService` |
| `limit` | 1–100 | Default 15 |

Searches paths, exported symbols, function names, search terms and purposes. Hits
are ranked and typed (`feature`, `file`, `route`).

### `devmap_analyze`

Re-analyzes the project and rewrites `.devmap/snapshot.json` and the navigation
files. It writes only inside `.devmap/`.

| Input | Type | Notes |
|---|---|---|
| `fresh` | boolean | Ignore the cache and rebuild from scratch |
| `timeoutSeconds` | 1–600 | How long to wait. Default 120 |

| `status` | Meaning |
|---|---|
| `unchanged` | No file changed; nothing was re-analyzed (unless `fresh: true`) |
| `refreshed` | A new snapshot was written |
| `running` | Still going after `timeoutSeconds`. It continues in the background; call again to wait for it |

Other fields: `generatedAt`, `durationMs`, `stats`, `mode` (`static` or
`ai-enabled`) and `aiDataDropped`. Concurrent calls share one analysis, and
clients that ask for progress receive notifications while it runs.

### `devmap_explain`

Only available when the server runs with `--allow-ai`. See
[AI and privacy](#ai-and-privacy).

| Input | Type | Notes |
|---|---|---|
| `target` | string | A project-relative file path, a feature name, or a top-level function name |

Returns `mode`, `target`, `answer`, `model`, `contextFiles` and `truncated`. It
writes nothing to disk.

---

## Resources and prompts

**Resources**

| URI | Content |
|---|---|
| `devmap://snapshot` | The full `.devmap/snapshot.json`. Large; prefer the tools |
| `devmap://devmap-md` | The project's `DEVMAP.md` |
| `devmap://feature/{id}` | Per-feature navigation data from `.devmap/features/{id}.json` |

**Prompts** (ready-made workflows; how a client shows them varies)

| Prompt | Input | What it asks the agent to do |
|---|---|---|
| `devmap_onboard` | `focus` (optional) | Build an onboarding guide using overview, flows and feature maps before opening files |
| `devmap_plan_change` | `change` | Find the right files, check `devmap_impact` for each, and propose a plan without editing code |

---

## Freshness and the snapshot

Tools answer from `.devmap/snapshot.json`. DevMap compares the project's files
with the snapshot to decide whether it is **stale** (the check is cached for
10 seconds). When it is, every result says so:

```json
"snapshot": {
  "generatedAt": "2026-10-30T02:11:09.000Z",
  "stale": true,
  "note": "The code changed after this snapshot was generated. Results may be outdated; call devmap_analyze to refresh."
}
```

There are three ways to refresh, from most to least hands-on:

1. **Run `devmap analyze --fresh`** yourself. This is the only way to keep
   AI-derived data (see below).
2. **The agent calls `devmap_analyze`** when it sees `stale: true`.
3. **`--auto-refresh`** rebuilds before answering, without the agent asking.
   Results then carry `refreshed: true`. If the rebuild fails, the older snapshot
   is served with `refreshError`, and DevMap waits 30 seconds before trying again.

Without `--auto-refresh`, a question never writes to disk.

Analysis takes a lock (`.devmap/analyze.lock`) so two servers or editor windows
cannot write the snapshot at once. A lock left by a dead process, or older than
15 minutes, is taken over. If another analysis is running, `devmap_analyze`
returns an error telling the agent to retry.

---

## AI and privacy

The MCP server is **static by default**: no AI provider is contacted, even when
you configured an API key with `devmap init`. The reason is that an agent, not
you, decides when to call a tool, so it should not be able to spend your AI quota
or send project metadata to a provider on its own.

| | Without `--allow-ai` (default) | With `--allow-ai` |
|---|---|---|
| `devmap_analyze` | Static analysis only | May use your provider for domain inference and file purposes |
| `devmap_explain` | Not registered | Registered; sends source excerpts to your provider |
| Provider config | Never read | Read from `devmap init` (BYOK) |

When a static rebuild replaces a snapshot that had AI-derived data (`domain`,
architecture), the result reports `aiDataDropped: true`. Run `devmap analyze` in a
terminal, or start the server with `--allow-ai`, to get it back. If nothing
changed, the existing snapshot is reused and its AI data stays.

`devmap_explain` only reads files that are in the snapshot's index and inside the
project root. The scan skips `.env*` files and anything your `.gitignore` ignores,
so those are not indexed and cannot be sent. DevMap does **not** inspect file
contents for secrets: if a source file contains a hard-coded key, an excerpt of
that file can be sent to your provider.

---

## Responses and errors

- **Staleness**: see above. `snapshot.stale` is always present.
- **Truncation**: large text is capped (30,000 characters, 8,000 per flow) and the
  result says `truncated: true`. Lists have a `limit` and report `truncated` too.
- **Errors** use the protocol's error flag and a structured body:

```json
{
  "error": "No DevMap snapshot was found.",
  "hint": "Run devmap analyze first."
}
```

  Missing, corrupt and unsupported snapshots, unknown files or features, and a
  held analysis lock return an `error`, and a `hint` when there is a next step.

## Safety model

- Every tool except `devmap_analyze` is read-only and annotated as such.
  `devmap_analyze` is not destructive and is idempotent; it only writes inside `.devmap/`.
- `devmap_explain` is marked as reaching outside the machine (it contacts your AI provider).
- Feature resource ids are validated, so `devmap://feature/…` cannot read
  outside `.devmap/features/`.
- File arguments are looked up in the snapshot's file index; they are not used as
  filesystem paths.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Client shows the server as failed or times out at startup | Install globally (`npm i -g @flaid/devmap`) and use `devmap mcp`, or raise the client's startup timeout |
| `No DevMap snapshot was found` | Run `devmap analyze`, or have the agent call `devmap_analyze`, or start with `--auto-refresh` |
| Results keep saying `stale: true` | Call `devmap_analyze`; check that a build step is not rewriting tracked files constantly |
| `devmap_analyze` times out in the client | Raise the client's tool timeout, or pass a smaller `timeoutSeconds` and call again; the analysis keeps running |
| `Another DevMap analysis is already running` | Wait and retry. If no analysis is running, delete `.devmap/analyze.lock` |
| `devmap_explain` is missing | Start the server with `--allow-ai` and make sure `devmap init` configured a provider |
| The server cannot find the project | Pass `--root /absolute/path/to/project` |

## Limits

- Analysis depth follows the rest of DevMap: JS/TS ecosystems first. Other languages
  have fewer graph edges, so `devmap_impact` is less complete for them.
- The stale check re-scans the project's files, so on a very large repository it is
  not free (hence the 10 second cache).
- The server serves one project (`--root`). Register one server per project.
- Only the stdio transport exists; there is no remote (HTTP) mode yet.

See also: [commands.md](./commands.md), [generated-files.md](./generated-files.md),
[architecture.md](./architecture.md).
