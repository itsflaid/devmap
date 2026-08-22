# `devmap flow`

**Source:** `packages/cli/src/commands/flow.ts`

Renders one or more flows (ch. 9) to Markdown + Mermaid, optionally adding
a short AI-narrated "How it works" paragraph per flow. The interesting
parts of this command are how `--all` genuinely changes what data gets
generated (not just how much is shown), and how narration failure is
scoped per-flow rather than all-or-nothing.

## Default vs. `--all` isn't a display filter — it's a different generation call

```ts
const flows = options.all ? buildAllFlows(snapshot) : snapshot.flows;
```

Without `--all`, this reads `snapshot.flows` directly — the small,
pre-generated set ch. 1's `generateMinimalFlows` already baked into the
snapshot at `analyze` time (3 high-confidence feature flows, 5 API-only
request flows). `--all` doesn't filter that list down or up — it calls
`generateFeatureFlows`/`generateRequestFlows` (ch. 9) **again, fresh**,
with deliberately loosened parameters:

```ts
generateFeatureFlows(snapshot.features, snapshot.fileIndex, { limit: Infinity, minConfidence: "medium" })
generateRequestFlows(snapshot.routes, snapshot.fileIndex, snapshot.fileGraph, { limit: Infinity, includeAllRouteKinds: true })
```

`minConfidence: "medium"` (vs. the snapshot default of `"high"`) and
`includeAllRouteKinds: true` (vs. API-routes-only) mean `--all` surfaces
genuinely different flows, not just more of the same ones — a
medium-confidence feature flow that never made it into
`snapshot.flows` at all becomes visible here.

## Target resolution: exact, then unambiguous partial, then a real error

```ts
const exact = flows.filter(f => f.name.toLowerCase() === target.toLowerCase());
if (exact.length > 0) return exact;
const partial = flows.filter(f => f.name.toLowerCase().includes(target.toLowerCase()));
if (partial.length === 1) return partial;
if (partial.length > 1) throw new DevmapError(`"${target}" matches multiple flows.`, /* lists them */);
```

A partial match is only auto-accepted if it's **unambiguous** — matching
exactly one flow. Two or more partial matches is treated as an error
asking the person to be more specific, listing the candidates, rather than
silently picking the first one. No target at all means every flow in the
current list (`snapshot.flows`, or the full regenerated set under
`--all`) gets rendered.

## Narration is optional, and fails one flow at a time

```ts
for (const flow of resolved) {
  const narration = client && routing
    ? await narrateFlow(client, routing.model, routing.fallbackModels, flow, options.json ?? false)
    : undefined;
  // ...continues to build markdown with or without narration
}
```

Each flow in the resolved list is narrated **independently**, inside the
loop — `narrateFlow()` catches its own `DevmapError` internally and
returns `undefined` on failure rather than throwing back up into the
loop:

```ts
} catch (error) {
  if (!(error instanceof DevmapError)) throw error;
  output.warning(error.message);
  return undefined;
}
```

This means a transient rate limit or model hiccup on flow 2 of 5 doesn't
abort flows 3–5 — each one gets its own attempt, and each falls back
independently to a narration-less "Purpose" + "Steps" rendering if its
own AI call fails. `narrateFlow` uses `buildFlowNarrationMessages` (ch.
12) with a small `maxCompletionTokens: 400` — it's explicitly asking for
one short paragraph, not an essay, per flow.

## Output structure, and where the Mermaid diagram actually comes from

Each rendered flow file has three possible sections — Purpose (always,
static text from `flow.purpose`), How it works (only if narration
succeeded), Steps (always, a numbered list with each step's file path in
backticks where available). The Mermaid diagram uses whichever is
available first:

```ts
mermaid: flow.mermaid ?? renderMermaidFlow(flow.steps)
```

If the `FlowInfo` object already carries a pre-rendered `mermaid` string
(ch. 9), it's reused as-is; otherwise `renderMermaidFlow()` (also ch. 9 —
the linear-chain Mermaid renderer, distinct from `mapRenderer.ts`'s
arbitrary-graph one used by `devmap map`) generates it fresh from the
step list. Every resolved flow gets its own `.md` + `.mermaid` pair
written to `.devmap/flows/<slug>/`, unconditionally, the same
always-persist-to-disk behavior `devmap map` has.

## See also

- Ch. 9 for `generateFeatureFlows`/`generateRequestFlows`/`renderMermaidFlow`
  and how the *default* minimal flow set gets chosen at `analyze` time
- Ch. 12 for `buildFlowNarrationMessages`, `completeWithOptionalStreaming`
- [`04-map.md`](./04-map.md) for the sibling command sharing the
  always-write-to-disk and slug-naming conventions
