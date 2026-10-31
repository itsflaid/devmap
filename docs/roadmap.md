# Roadmap

What has shipped, what is likely next, and what is deliberately deferred. This is a
direction, not a promise: items move as real projects show what matters. The full
history of released changes is in [CHANGELOG.md](../CHANGELOG.md).

## Principles

- **Static analysis first.** Files, graph, routes, features and flows are
  deterministic. AI is an optional layer on top and never blocks `devmap analyze`.
- **JS/TS depth before breadth.** Other languages stay at their current level until
  the JS/TS ecosystem is mature.
- **Read-only by default.** The MCP server only writes inside `.devmap/`, and only
  when asked (`devmap_analyze`, `--auto-refresh`).

## Shipped

**0.9.0: `devmap mcp`.** DevMap runs as an MCP server over stdio, so an agent asks
the project map questions with tool calls instead of reading a dumped context file.

- Tools: `devmap_overview`, `devmap_map`, `devmap_flow`, `devmap_routes`,
  `devmap_impact`, `devmap_find`, `devmap_analyze`, and `devmap_explain` with
  `--allow-ai`
- Resources and prompts, stale-snapshot reporting on every answer, and opt-in
  `--auto-refresh`
- Listed in the MCP Registry as `io.github.itsflaid/devmap`
- Guide: [mcp.md](./mcp.md)

## Likely next

Ideas that follow directly from what exists. None is scheduled.

- **MCP setup help.** A `devmap doctor` check for the MCP setup, and `devmap init`
  offering the `.mcp.json` snippet.
- **Cheaper staleness checks.** The MCP server re-scans project files (cached for
  10 seconds) to decide whether the snapshot is stale. That is not free on very large
  repositories.
- **Import resolution for more languages.** Go, Java, C# and PHP (PSR-4) imports
  are read today but produce no dependency-graph edges. This waits until JS/TS is
  mature.
- **Public benchmark results.** The method is in [benchmarking.md](./benchmarking.md);
  results will be published once recorded, and claims stay at "designed to reduce
  repeated exploration" until then.

## Future commands

Commands listed in [commands.md](./commands.md#future-commands) (`features`, `docs`,
`deadcode`, `report`, `watch`, `visual`) are not part of the current scope.

## Deferred

Left out until evidence justifies the cost:

- Public analyzer plugins
- Tree-sitter adapters beyond the planned language work
- Persisted graph storage and multi-project aggregation
- Fine-grained incremental computation (the graph is rebuilt on every analyze)
- MCP: a remote (HTTP) transport, serving several projects from one server, and
  watching files instead of checking staleness per request

Design reasons for each are in [architecture.md](./architecture.md).
