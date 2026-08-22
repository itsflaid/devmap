# 11. AI Domain Inference

**Source:** `packages/cli/src/analyzers/inference/`

This is Step 4 of `createProjectMap` (ch. 1) — the only point in the entire
pipeline that touches the network. It's also the chapter with the clearest
example of *why* DevMap treats AI as a careful, evidence-constrained
enhancement rather than something trusted to reason freely: a naive version
of this feature gets a specific, predictable class of question wrong, and
the current implementation exists to prevent exactly that.

## The problem: entity names alone lie about domain

`inferDomain()`'s prompt sends **structured metadata only** — never raw
source code. The doc comment is explicit about why:

> Intentionally does not send raw source code — only structured metadata.
> This keeps token usage minimal (~300–500 tokens per call) and ensures the
> AI focuses on domain inference, not code analysis.

But structured metadata alone has a specific failure mode. An entity named
`Message`, related to an entity named `Room`, looks — to a model reasoning
from names alone — exactly like a chat application. It might also be a
personal journal app where "Room" means "notebook" and "Message" means
"entry." Entity *names* don't carry that distinction; entity
**relationships and ownership** do.

## Ownership topology: the structural evidence that actually distinguishes these cases

**Source:** `ownershipTopology.ts`

`classifyOwnershipTopology()` looks at the entity graph's *shape*, not its
labels, and classifies it into one of four patterns:

```ts
export type OwnershipPattern =
  | "single_user_isolated" | "shared_access" | "direct_messaging" | "unclear";
```

The signals it looks for:

- **Cross-user field names** — a hardcoded list (`participants`, `members`,
  `sharedWith`, `recipientId`, `senderId`, `collaborators`, `inviteeId`,
  ...) checked against every entity's field names, normalized to strip
  case/punctuation before comparing.
- **Many-to-many relations touching `User`** — a direct structural signal
  of shared access, independent of any field naming convention.
- **Multiple foreign keys to `User` on the same entity** — an entity with
  two or more `*Id`-suffixed fields whose name overlaps `"user"` is
  a strong hint of a relationship *between* users (one FK for "who sent
  it," one for "who received it") rather than one owner. If any of those
  FK names specifically contain `sender`/`recipient`, that pushes the
  classification toward `direct_messaging` specifically.

The resulting pattern is decided by a priority cascade: direct-messaging
evidence + cross-user fields → `direct_messaging`; any many-to-many-with-
User or cross-user field alone → `shared_access`; multiple entities with
**none** of the above → `single_user_isolated`; anything else →
`unclear`. This is exactly the kind of thing a `Message`/`Room` schema with
**no** sender/recipient split and **no** many-to-many-with-User relation
would classify as `single_user_isolated` — correctly identifying it as a
personal tool, regardless of what the entities happen to be named.

## The prompt's explicit safeguard

**Source:** `buildDomainInferencePrompt()`

This structural evidence only helps if the model is actually told to
weight it over naming. The prompt's rules section says so directly — this
is close to the literal prompt text, since the instruction itself is the
important artifact here:

> Entity names alone (e.g. `Message`, `Room`, `User`) are not reliable
> signals of application domain. The same entity name can represent a chat
> message, an activity log, a personal note, or a comment — depending on
> ownership pattern, not naming. Use `ownershipPattern` and
> `absentCapabilities` as primary evidence: `single_user_isolated` strongly
> suggests a personal/private tool, not a multi-user communication
> platform. Only conclude "chat" or "messaging" domain if `ownershipPattern`
> is `shared_access` or `direct_messaging`, or detected capabilities
> include collaboration/social/real-time.

`absentCapabilities` — the flip side of ch. 7's `CapabilityInfo` list — is
computed by diffing the full set of known capability kinds against
whichever ones were actually detected (`buildDomainInferenceInput()`).
Telling the model what *wasn't* found (no sharing routes, no real-time
transport, no collaboration endpoints) is deliberately supplied as
evidence with equal standing to what *was* found — the absence of
multi-user infrastructure is treated as a real, citable signal, not just a
gap in the input.

## Caching: SHA-256, and why it exists specifically for stability

**Source:** the cache functions at the top of `domainInference.ts`

Every call is cached to `.devmap/domain-cache.json`, keyed on a hash of
the entire `DomainInferenceInput` — entity names, relations, capabilities,
technical feature names, route count, framework, ownership pattern,
cross-user fields, and absent capabilities, all sorted before hashing so
key order never affects the result:

```ts
function hashDomainInput(input: DomainInferenceInput): string {
  const stable = JSON.stringify({ v: 2, /* ...sorted fields... */ });
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}
```

This is a **different hash algorithm** than the MD5 `hashContent()` used
for the project-wide fingerprint (ch. 1, ch. 14) — worth knowing they're
two separate mechanisms serving two separate purposes, not one shared
utility. The `v: 2` field is a schema version baked directly into the
hashed payload: if the shape of `DomainInferenceInput` ever changes, bump
that number and every existing cache entry naturally misses (different
hash for the same underlying data) rather than being read with a stale
shape.

The comment states the actual motivation plainly:

> This ensures `devmap analyze` is idempotent — feature names don't change
> on every run as long as the codebase hasn't changed.

Without this cache, re-running `devmap analyze` on an unchanged project
could produce a *differently worded* domain summary or feature list every
time (LLMs aren't deterministic even at low temperature), which would be
actively confusing — a "did something change?" signal with no real change
behind it. A cache hit skips the LLM call entirely, so an unchanged project
never re-invokes the AI at all after the first `analyze`, regardless of how
many times you run it. Cache writes are explicitly best-effort — a failed
write is swallowed silently rather than failing the analysis, since the
cache is a stability optimization, not a correctness requirement.

## Failure is always a `null`, never a thrown error upward

`inferDomain()` wraps the entire call in a `try/catch` that returns `null`
on any failure — malformed AI response, network error, unparseable JSON.
The doc comment: *"AI inference is an enhancement, not a blocker. If it
fails, return null — the caller still has static features."* This is the
same graceful-degradation posture ch. 1 described at the pipeline level,
implemented concretely here: `createProjectMap`'s Step 4 just checks
`if (result)` before doing anything with it.

`parseDomainInferenceResponse()` is deliberately defensive on the way in
too — it strips markdown code fences the model might wrap the JSON in
despite being told not to, and every field access is optional-chained with
a fallback, so a partially-malformed response degrades to `null` rather
than throwing partway through parsing.

## Feeding results back into the feature list

`domainFeaturesToFeatureInfo()` converts each AI-suggested feature into a
`FeatureInfo` with one deliberate detail: `searchTerms` includes the
AI-provided `relatedEntities`, lowercased. The comment explains exactly
why this field is populated the way it is — it's what lets ch. 8's
similarity engine actually recognize an overlap:

```ts
// AI returns relatedEntities: ["Plan", "Subscription"]
// Static feature "Plan Management" has searchTerms: ["plan", "subscription", ...]
// → entityOverlap / termOverlap high → merged, not duplicated.
```

AI-inferred features are always assigned `confidence: "medium"` —
never `"high"` — regardless of how confident the model's own `confidence`
field claims to be; that field is parsed and clamped into
`DomainInferenceResult.confidence` but isn't what determines the merged
feature's confidence level.

## See also

- Ch. 1 for exactly where Step 4 sits in `createProjectMap`'s sequence
- Ch. 7 for `CapabilityInfo`/`CapabilityKind`, the source of
  `absentCapabilities`
- Ch. 8 for `mergeDomainFeatures`, which consumes this chapter's output
- Ch. 14 for the MD5 vs SHA-256 distinction across the codebase's various
  caches
