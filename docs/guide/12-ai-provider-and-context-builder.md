# 12. AI Provider & Context Builder

**Source:** `packages/cli/src/ai/`

Three concerns live in this folder: talking to Groq/OpenRouter reliably
over an unreliable network, deciding *which* files are relevant to a
natural-language question, and using both together to power
`devmap explain`.

## `AiClient` — one interface, two implementations

```ts
export interface AiClient {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  stream?(request: AiCompletionRequest, onDelta: AiDeltaHandler): Promise<AiCompletionResult>;
}
```

`GroqClient` and `OpenRouterClient` both implement this. `provider.ts`'s
`createAiClient(config)` is the only place that picks between them — every
other AI-facing module (`domainInference.ts`, `snapshotEnrichment.ts`,
`commands/explain.ts`) is written against `AiClient` and never imports
either concrete class. Switching providers never touches call sites.

### `resolveAiRouting()` — where "auto" resolves to a real model

```ts
export function resolveAiRouting(config: DevmapConfig, task: AiTask) {
  if (config.model !== "auto") return { model: config.model, fallbackModels: [] };
  if (config.provider === "openrouter") return { model: OPENROUTER_FREE_MODEL, fallbackModels: [] };
  return { model: DEFAULT_AI_MODELS[task], fallbackModels: DEFAULT_AI_FALLBACKS[task] };
}
```

Only Groq gets a fallback *chain* per task (`analyze`/`flowNarration`/
`explain`, each with its own primary + fallbacks — see below).
OpenRouter's `"auto"` path resolves to a single free model with no chain —
there's no equivalent curated fallback list for OpenRouter today.

## `GroqClient` — the more defensive of the two

Groq gets meaningfully more resilience code than OpenRouter, for a
concrete reason: Groq's hosted model catalog changes over time (models get
deprecated/decommissioned), so the client has to defend against both
transient failures *and* a configured model simply no longer existing.

**Model chain, not single retry.** `resolveModelChain()` builds an ordered,
deduplicated list — `[request.model, ...fallbackModels, ...legacy
fallbackModel]` — and `complete()`/`stream()` walk it in order, stopping at
the first success:

```ts
for (const model of resolveModelChain(request)) {
  const result = await this.requestModel(request, model);
  if (result.ok) return result.result;
  lastError = result.error;
  if (!result.canFallback) throw result.error;
}
```

**`shouldTryFallback()` decides which failures are worth burning a fallback
model on:**

```ts
return status === 429
  || status >= 500
  || status === 404
  || (status === 400 && /model|decommissioned|not available|not found|permission/i.test(message));
```

Rate limits and server errors always fall through to the next model. A 400
only triggers fallback if the *message text* itself indicates a model
problem — an invalid-key or malformed-request 400 shouldn't burn through
every fallback model just to fail identically on each one; those errors
throw immediately instead (`canFallback: false`).

**Exponential backoff specifically for 429s**, separate from the
model-fallback chain:

```ts
const delay = Math.min(readRetryDelay(response) * (2 ** retryAttempt), MAX_RATE_LIMIT_DELAY_MS);
```

Up to 3 retries *on the same model* before that model is considered
exhausted and the chain moves to the next one. `readRetryDelay()` honors
the server's `retry-after` header when present, falling back to a 1s base.

**`EXCLUDED_MODEL_PATTERNS`** — when listing available models (used by the
interactive model picker in `devmap init`/`devmap config model`, ch.
commands 1/7), ten regexes filter out anything that isn't a plain chat
model: Whisper (speech-to-text), prompt-guard/safety classifiers, the
`compound-beta` orchestration models, TTS, vision-only and LLaVA models,
embeddings, speculative-decoding variants, and rerankers. Without this
filter, the picker would list models that return HTTP errors the instant
you send them a normal chat completion request. `PREFERRED_MODELS` then
sorts three known-good models to the top of whatever remains.

## `OpenRouterClient` — simpler, by design

No retry/backoff loop, no model-exclusion filtering, no curated fallback
list — OpenRouter's own routing (`models: [...]` array in the request
body, used when `resolveModels()` produces more than one candidate) is
allowed to do that job itself rather than DevMap reimplementing it
client-side. The two clients intentionally aren't symmetric; Groq's extra
code exists because Groq specifically needs it, not because of an
inconsistency worth fixing.

## Streaming: parsed twice, nearly identically

Both clients implement SSE stream parsing — buffer incoming chunks, split
on blank-line-delimited events, extract `data:` lines, accumulate `delta`
content while forwarding it live via `onDelta`, stop at a literal `[DONE]`
sentinel. This is genuinely duplicated (not shared via a common helper)
because the two providers' payload shapes differ enough
(`payload.usage` vs. Groq's `payload.usage ?? payload.x_groq?.usage`) that
a shared implementation would need provider-specific hooks anyway.
`completion.ts`'s `completeWithOptionalStreaming()` is the one place that
doesn't care which client it's holding — it checks `client.stream`
existing at all before deciding whether to stream, and renders whatever
comes through via `output.markdownStream()`.

## Prompts: three call sites, one shared discipline

**Source:** `prompts.ts`

`buildAnalyzeMessages`, `buildFlowNarrationMessages`, and
`buildExplainMessages` each build a `system` + `user` message pair. Every
one of the three system prompts repeats the same constraint in different
words — *"only restate what's in the supplied data, do not invent
modules/files/behavior."* This mirrors ch. 11's domain-inference prompt
discipline: across every AI call in the codebase, the model is explicitly
scoped to elaborate on static-analysis facts, never to reason freely about
the codebase from general knowledge. `buildExplainMessages` in particular
sends the *actual file content* (`context.files[].content`, capped by
`contextBuilder.ts`) — the one AI call in the system that does, unlike
domain inference's metadata-only approach (ch. 11) — because explaining a
specific file's behavior genuinely requires reading it.

## The context builder — retrieval for `devmap explain`

**Source:** `contextBuilder.ts` (~925 lines, the second-largest file in
`src/`)

`buildQuestionContext()` turns a free-text question into a ranked,
size-bounded set of file excerpts to hand the model. This is the file's
own miniature information-retrieval pipeline: tokenize → classify intent
→ rank every file in the snapshot → expand via graph neighbors → truncate.

### Bilingual from the ground up

`STOP_WORDS` and `CONCEPT_ALIASES` mix English and Indonesian
deliberately — not as an afterthought:

```ts
const STOP_WORDS = new Set(["about", "adalah", "apa", "bagaimana", "bekerja",
  "dalam", "dimana", "dengan", "mana", "untuk", "where", "yang", /* ...more... */]);

const CONCEPT_ALIASES = {
  auth: ["auth", "authentication", "autentikasi", "login", "session", "sesi", "nextauth"],
  payment: ["payment", "payments", "pembayaran", "stripe", "midtrans", "checkout"],
  upload: ["upload", "unggah", "file", "multer", "cloudinary"],
  // ...
};
```

`RUNTIME_DATA_QUERY_TERMS` even includes `"koneksi"` (Indonesian for
"connection") alongside `"connect"`/`"connection"`/`"init"`. A question
asked entirely in Indonesian (`"gimana cara kerja autentikasi di project
ini?"`) tokenizes and scores meaningfully, not just questions in English.

### Intent classification drives file/line budgets, not just labeling

```ts
const INTENT_TERMS = {
  add_feature: ["add", "build", "create", "implement", "make", "support"],
  change: ["change", "modify", "refactor", "update"],
  debug: ["bug", "debug", "error", "fail", "fails", "fix", "issue", "wrong"],
  explain: ["explain", "how", "what", "why"],
  navigate: ["find", "start", "where"]
};
```

The detected intent picks between three budget tiers —
`DEFAULT_MAX_FILES = 5` / `200` lines each for general questions,
`NAVIGATION_MAX_FILES = 2` / `60` lines for "where do I start" questions,
and the same tight `2` / `60` for `add_feature`/`change` intents
(`usesFocusedContext()`). The reasoning: a debugging or explanation
question benefits from breadth (more files, more context per file), while
a "where should I add X" or "where is Y" question benefits from a small,
precise answer — dumping 5 files at 200 lines each would bury the one
relevant entry point the person actually needs.

### Scoring: many small signals, summed

`rankContextFiles()` computes one score per file by summing roughly eight
independent signals, each contributing a small `reasons[]` string so a
file's score is explainable, not a black box:

| Signal | Weight (direct keyword match) | Weight (expanded/alias term) |
|---|---|---|
| Path term match (word-boundary) | 30 | 14 |
| Path substring | 6 | 4 |
| Export/symbol term match | 26 | 12 |
| Export substring | 8 | 4 |
| Import/dependency match | 3 | 2 |
| Snapshot `searchTerms` match | 30 | — |
| Feature evidence (file is evidence for a matched feature) | 10–30 | — |
| Route evidence (file handles a matching route) | 30 | — |
| Entry-point match (only for entry-point-flavored queries) | 40 | — |

Direct keyword matches are weighted roughly 2x their alias-expanded
counterparts throughout — an alias-expanded term (e.g. `"autentikasi"`
matching because the question said `"auth"`) is treated as real but
somewhat weaker evidence than the literal terms extracted from the
question itself. `STRUCTURAL_NAVIGATION_FEATURES` (`"CLI Commands"`,
`"Documentation"`, `"Web Landing"`, etc. — the ch. 6 role-based features)
are explicitly excluded from feature-evidence scoring *unless* the
question's own keywords directly name them — otherwise nearly every file
in a CLI project would get a baseline "evidence for CLI Commands" bump
regardless of what was actually asked.

Two small bonuses only apply to files that already scored **above zero**
from actual term matches — `criticalFiles` membership and snapshot
`importance` both add a capped bonus (≤15, ≤10) on top, but never enough
alone to surface a file with zero real relevance.

### Graph expansion — one more hop, at a discount

`expandGraphNeighbors()` runs only when the query profile calls for it
(`includeRelatedFiles`, essentially "not a navigation/focused-intent
query") — for each of the top directly-matched files, both its imports and
whatever imports *it* get added as related files, scored at roughly 1/4 to
1/5 of the originating match's score (`Math.floor(match.score / 4)`, floor
`MIN_RELEVANCE_SCORE = 25`). This is one hop only, not a recursive
expansion — a file three imports removed from a direct match never enters
the ranking.

### Confidence and final assembly

`getRelevanceConfidence(topScore)` buckets the top-scoring file's score
into `high` (≥70) / `medium` (≥40) / `low` — this is the confidence
`commands/explain.ts` (ch. commands 6) checks before deciding whether to
answer directly or tell the user it isn't confident it found the right
files. File content itself is read fresh from disk (`readFile`, `realpath`
to guard against symlink escapes outside `projectRoot`) and truncated to
the intent-appropriate line budget at assembly time — the ranking step
itself never touches file content, only `fileIndex` metadata, so scoring
5,000 files is cheap regardless of how large any individual file is.

## Snapshot enrichment — the other AI pass, and why it's separate from domain inference

**Source:** `snapshotEnrichment.ts`

This runs (also optionally, also gracefully-degrading) during
`devmap analyze` to upgrade `purpose`/`searchTerms` fields from their
auto-generated static defaults to AI-written, more specific ones — for
**files**, batched 20 at a time (`FILE_BATCH_SIZE`) to keep each request
small, and separately for **features**, one request covering all of them.
This is a different concern from ch. 11's domain inference: domain
inference *adds new features* by reasoning about the whole project;
enrichment only *rewords existing fields* the static pipeline already
populated, and only for files that clear an eligibility bar
(`selectEligibleFiles`) — critical files, `importance >= 20`, files with
feature references, or files matching `isSemanticEnrichmentCandidate()` (a
narrower, purpose-built regex check for auth/session-shaped files
specifically, independent of ch. 6's `detectAuthenticationSemanticRole` —
yet another instance of a concept implemented more than once across the
codebase, this time deliberately: enrichment eligibility is a cheaper,
narrower check than the full semantic-role classifier since it only needs
to decide "is this worth an AI rewrite," not classify a role).

Every AI-written value is still passed through the same normalization the
static pipeline would apply — `normalizeSearchTerms()` rejects vague terms
(`"data"`, `"logic"`, `"handler"`, ...) via the same kind of vague-term
blocklist `contextBuilder.ts`'s `VAGUE_EXPANSION_TERMS` uses for a related
purpose — the AI is allowed to improve wording, never allowed to
reintroduce the generic filler the static pass was designed to avoid in
the first place.

## See also

- Ch. 11 for the sibling AI pass (domain inference) and why its prompt
  discipline mirrors this chapter's
- Ch. 6 for `detectAuthenticationSemanticRole`, the broader relative of
  `isSemanticEnrichmentCandidate`
- Commands ch. 6 for how `devmap explain` consumes `QuestionContext`
  end to end
- Ch. 14 for `DevmapConfig`, the input to `createAiClient`/
  `resolveAiRouting`
