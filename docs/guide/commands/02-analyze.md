# `devmap analyze`

**Source:** `packages/cli/src/commands/analyze.ts`

The command every other piece of DevMap output depends on — it's the only
place `createProjectMap()` (ch. 1) actually gets called and its result
persisted. Everything from `.devmap/snapshot.json` to `.devmap/index.json`
to the `Architecture` prose you see in the terminal originates here.

## The flow, phase by phase

```
buildCallAI()                          — optional AI wrapper for domain inference (ch. 11)
  → createProjectMap(projectRoot, callAI)   — ALWAYS runs, static analysis is never skipped
  → compare fingerprint (ch. 1) against previous snapshot
      unchanged → rewrite agent nav files from the OLD snapshot, stop here
      changed   → enrichSnapshot()      — AI file/feature purpose rewrite (ch. 12)
                → saveSnapshot()
                → writeAgentNavigationFiles()  (ch. 13)
  → printOrGenerateInterpretation()     — the "Architecture" prose block
```

Static analysis (`createProjectMap`) runs on **every invocation**,
unconditionally — there's no shortcut that skips scanning the filesystem.
What the fingerprint comparison skips is everything *after* that: AI
enrichment, the snapshot write, and (implicitly) the domain-inference cache
lookup inside `createProjectMap` itself likely resolving as a cache hit
(ch. 11) even when the fingerprint check downstream doesn't get that far.

### The "unchanged" fast path still rewrites agent navigation output

This is easy to miss on a skim: even when the fingerprint matches and
`analyze` decides to reuse the previous snapshot wholesale, it still calls
`writeAgentNavigationFiles(projectRoot, previous.snapshot)` before
returning. `.devmap/index.json` and `.devmap/features/*.json` (ch. 13) get
regenerated from the *existing* snapshot data every single run, regardless
of whether anything changed — only `snapshot.json` itself and any AI
enrichment are actually skipped on a cache hit.

### `buildCallAI` — the decoupling point ch. 1 described, from the caller's side

```ts
async function buildCallAI(projectRoot, dependencies) {
  const config = await loadConfig();
  if (!config?.apiKey) return undefined;
  const client = createAiClient(config);
  const routing = resolveAiRouting(config, "analyze");
  return async (prompt) => {
    const result = await client.complete({
      messages: [{ role: "user", content: prompt }],
      model: routing.model,
      fallbackModels: routing.fallbackModels,
      maxCompletionTokens: 600,
      temperature: 0.1  // low — domain inference wants consistent JSON, not variety
    });
    return result.content;
  };
}
```

This is exactly the `(prompt: string) => Promise<string>` shape ch. 1
described `createProjectMap` accepting — built here, entirely outside the
pipeline, using whichever provider/model the project's config resolves to.
If no API key is configured, this returns `undefined` and the pipeline
proceeds with zero AI calls, exactly as ch. 1 and ch. 11 describe.

## Three independent caches, easy to conflate

Running `devmap analyze` twice in a row touches (up to) three separate
caching mechanisms, each skippable independently:

| Cache | Keyed on | Skips |
|---|---|---|
| Snapshot fingerprint (this file, ch. 1) | MD5 of all file contents | AI enrichment + snapshot write entirely |
| Domain-inference cache (ch. 11) | SHA-256 of structured entity/capability input | One `inferDomain()` network call |
| `snapshot.ai` presence (this file) | Simply "is `snapshot.ai` already set" | Re-generating the `Architecture` prose block |

The third one is enforced right here in `printOrGenerateInterpretation()`:

```ts
if (snapshot.ai && !options.fresh) {
  output.markdown(snapshot.ai.architecture);
  return snapshot;  // no AI call at all
}
```

`--fresh` bypasses **all three** — it skips the fingerprint comparison
outright (`previous` is treated as `{ status: "missing" }`), which in turn
means the domain-inference cache check and the architecture-prose cache
check are both reached fresh rather than short-circuited.

## Streaming is disabled under `--json`, not just suppressed in output

```ts
const execution = await completeWithOptionalStreaming(
  client, { /* ... */ }, !options.json, () => output.section("Architecture")
);
```

The `enabled` flag passed to `completeWithOptionalStreaming` (ch. 12) is
literally `!options.json` — under `--json`, the architecture interpretation
is requested as one blocking call rather than a stream, because streaming
markdown chunks into what's supposed to be a single parseable JSON payload
would corrupt it. This isn't a UI choice made in the output layer; it's
decided at the point the request is built.

## Failure handling: expected vs. unexpected errors are treated differently

```ts
} catch (error) {
  if (!(error instanceof DevmapError)) throw error;
  output.warning(error.message);
  output.note("Static analysis and snapshot were still completed successfully.");
  return snapshot;
}
```

Only `DevmapError` — the codebase's own typed error class, thrown for
known failure modes like an invalid key or a rate limit (ch. 12) — is
caught here and downgraded to a warning. Anything else propagates and
crashes the command. This is deliberate: a `DevmapError` represents an
anticipated, named failure category with its own hint text; anything
else is, by construction, a bug or an unhandled case that should be loud
rather than silently swallowed into "static analysis still worked."
Either way, static analysis and the snapshot write already happened by
this point in the flow — only the AI prose is at risk.

## See also

- Ch. 1 for `createProjectMap`, `createProjectFingerprint`
- Ch. 11 for the domain-inference cache this command's `callAI` wrapper feeds
- Ch. 12 for `enrichSnapshotWithAi`, `completeWithOptionalStreaming`,
  `buildAnalyzeMessages`
- Ch. 13 for `writeAgentNavigationFiles`
