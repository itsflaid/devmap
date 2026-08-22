# `devmap explain`

**Source:** `packages/cli/src/commands/explain.ts`

The thinnest command file in the CLI, but it's the one that ties ch. 12's
context builder directly to a user-facing answer. `resolveExplainTarget()`
is the interesting part — it's a **three-way** resolver, one more mode
than `devmap map`'s two.

## Three target modes, in a specific fallback order

```ts
export type ResolvedExplainTarget =
  | { mode: "file"; value: string }
  | { mode: "feature"; value: string }
  | { mode: "function"; value: string; file: string; line: number };
```

1. **Feature** — case-insensitive exact name match, same as `map.ts`.
2. **File** — via the shared `resolveFileTarget()` (`utils/targetResolver.ts`).
3. **Function** — a name search across **every file's** `topFunctions`
   (ch. 2's `FileAnalysis`), case-insensitive exact match on the function
   name. Zero matches falls through to the final error. Exactly one match
   resolves to `{ mode: "function", file, line }`. More than one match —
   the same function name defined in multiple files — throws, listing up
   to 5 `file:line` locations and asking the person to be more specific.
   Unlike `flow.ts`'s target resolution, there's no partial/substring
   matching attempted for functions — only an exact name match counts.

If none of the three resolve, the error message lists known feature names
and points at file-path or function-name usage, mirroring `map.ts`'s
error shape.

### There's currently no free-text question path

Worth knowing if you're expecting `devmap explain "how does auth work"` to
work as an open-ended question: it doesn't, today. `target` is always run
through `resolveExplainTarget()` first, and that function has no fallback
for "treat this as a natural-language question" — every target has to
resolve to an actual file, feature, or function name, or the command
errors out. This is a real contrast with ch. 12's `contextBuilder.ts`,
which is built with substantial machinery specifically for classifying
open-ended questions (intent detection, bilingual stop words, query
scopes) — that machinery is exercised here only indirectly, via
`targetLabel` (the resolved file/feature/function name) being passed to
`buildQuestionContext()` *as if* it were the question. The full
free-text-question capability `contextBuilder.ts` clearly supports isn't
currently reachable through this command's CLI surface.

## Requires AI — no static-only fallback

```ts
if (!config?.apiKey) {
  throw new DevmapError(
    "devmap explain requires an AI provider, but none is configured.",
    "Run devmap init to set up Groq or OpenRouter, then try again."
  );
}
```

This is a deliberate contrast with `analyze.ts`/`flow.ts`, both of which
degrade gracefully to a static-only result when no API key is configured
(ch. 1, ch. 11). `explain` has no equivalent static fallback — its entire
output *is* an AI-generated answer, so there's nothing meaningful left to
return without one, and it fails fast with a clear next step instead of
returning an empty or degraded result.

## Answer printing relies on streaming having actually run

Non-JSON output only explicitly prints two things — a `Context files:`
note and, if `--write` was used, a success line for the written path:

```ts
output.note(`Context files: ${result.contextFiles.join(", ")}`);
if (result.writtenPath) output.success(`Wrote ${result.writtenPath}`);
```

There's no explicit `output.markdown(result.answer)` fallback anywhere in
this file the way `analyze.ts`'s `printOrGenerateInterpretation()` has one
for its non-streamed case. The answer reaching the terminal at all depends
on `completeWithOptionalStreaming` (ch. 12) actually streaming it live via
the `onStreamStart` callback passed in (`() => output.section("Answer")`)
— which in practice it does, since both `GroqClient` and `OpenRouterClient`
implement `.stream()`. Worth knowing if you're ever debugging a silent
`devmap explain` run in a context where streaming didn't fire: the answer
is still present in `result.answer` (and in the `--json` payload
regardless), just not printed by a fallback path.

## `--write` output is intentionally minimal

```ts
await writeFile(join(explainDir, `${slug}.md`), `# ${targetLabel}\n\n${execution.result.content}\n`, "utf8");
```

Just a title and the raw AI prose — no sections, no metadata, unlike
`devmap map`/`devmap flow`'s multi-section Markdown output. `explain`'s
value is the answer itself; there's no structural map data to render
alongside it.

## See also

- Ch. 12 for `buildQuestionContext`, `buildExplainMessages`, and the
  intent/scope classification this command only exercises through a
  resolved-target label
- [`04-map.md`](./04-map.md) for the sibling two-mode target resolver
  this command's three-mode version extends
