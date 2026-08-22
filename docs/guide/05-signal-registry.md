# 5. Signal Registry

**Source:** `packages/cli/src/analyzers/registry/`

Three unrelated-looking consumers — feature detection (ch. 6), external
service detection (ch. 3), and AI-provider detection (ch. 12's context
around Groq/OpenRouter) — all read from the **same** underlying data. That
data lives here, as one `SignalDescriptor` per topic, split into
per-domain files (`auth.ts`, `payments.ts`, `search.ts`, `ai-providers.ts`,
17 files total) and combined by `index.ts`.

This chapter is short on purpose — it's mostly a map of the shape, since
adding or editing a signal is one of the most common small contributions
this codebase invites.

## One descriptor shape, three categories

```ts
export type SignalCategory = "feature" | "provider" | "ai-provider";

export type SignalDescriptor = {
  name: string;
  category: SignalCategory;
  purpose?: string;
  genericTerms?: string[];        // keywords used for feature matching
  importNames?: string[];         // exact package names, e.g. "stripe"
  importPrefixes?: string[];      // package name prefixes, e.g. "@langchain/"
  contentSignals?: string[];      // string literals to grep for in file content
  hosts?: string[];               // hostnames, e.g. "api.groq.com"
  importOnly?: true;              // see below
  minimumDistinctFiles?: number;  // see below
};
```

A single domain often declares **two** descriptors: one `category:
"feature"` entry (broad, keyword-based — "this project does payments
somehow") and one or more `category: "provider"`/`"ai-provider"` entries
(narrow, package-identity-based — "specifically Stripe"). `payments.ts` is
a clean example:

```ts
export const DESCRIPTORS: SignalDescriptor[] = [
  { name: "Payments", category: "feature", genericTerms: [
      "stripe", "midtrans", "xendit", "paypal", "braintree", "razorpay",
      "payment", "checkout", "billing", "subscription", "invoice",
    ], purpose: "Handles payment providers, billing, and transaction workflows." },
  { name: "Stripe", category: "provider", importNames: ["stripe"] },
  { name: "Midtrans", category: "provider", importNames: ["midtrans"] },
];
```

## Two flags worth understanding before you add a signal

**`importOnly: true`** — used on `AI Integration`. This tells the feature
engine (ch. 6) that keyword matches in prose (comments, strings, markdown)
don't count as evidence for this feature; only an actual package import
does. Without it, a `# AI Integration roadmap` heading in a README would be
treated the same as an actual `import OpenAI from "openai"` — `importOnly`
exists specifically to prevent that class of false positive for topics
people write *about* far more often than they import.

**`minimumDistinctFiles`** — used on `Search` (`minimumDistinctFiles: 2`).
Requires evidence to appear in at least N different files before the
feature is considered detected at all. `Search` needs this because the word
"search" is common enough in ordinary UI copy (a single `<input
placeholder="Search...">`) that one match is weak evidence; two or more
files independently referencing search-related terms is a meaningfully
stronger signal. This is a coarser, earlier-stage relative of the
confidence *thresholds* capability detection uses (ch. 7) — same underlying
worry (one incidental match ≠ a real capability), different subsystem.

## `index.ts` — one list, four derived views

`REGISTRY_DESCRIPTORS` is the flat concatenation of every domain file's
`DESCRIPTORS` export. Everything else in `index.ts` is a **derived view**
computed once at module load:

- **`FEATURE_SIGNALS`** — every `category: "feature"` descriptor, reshaped
  into the `FeatureSignal` type the feature engine actually consumes
  (`{ name, terms, purpose, importOnly?, minimumDistinctFiles? }`). This is
  the entire input to keyword-based feature matching in ch. 6 — there's no
  separate feature-signal list maintained elsewhere.
- **`SERVICES`** — for each name in a hardcoded `SERVICE_NAMES` list
  (`Prisma`, `Supabase`, `Stripe`, `NextAuth`, `Midtrans`, `Resend`,
  `Cloudinary`, `Firebase`, `OpenAI`, `Groq`, `OpenRouter`), look up its
  `provider`/`ai-provider` descriptor and pull `importNames`. Consumed by
  `serviceDetector.ts` (ch. 3) as `Array<[needleList, serviceName]>`. Note
  `requireProviderDescriptor()` **throws** if a name in `SERVICE_NAMES`
  doesn't resolve to a descriptor with `importNames` — this is intentional
  fail-fast: it means adding a name to `SERVICE_NAMES` without also giving
  that provider an `importNames` array breaks the build immediately, rather
  than silently detecting nothing at runtime.
- **`SOURCE_SERVICE_SIGNALS`** — same `SERVICE_NAMES` list, but pulling
  `contentSignals` instead of `importNames`, for services detected by
  scanning file *content* (e.g. a hardcoded `api.groq.com` string) rather
  than declared dependencies. Only providers that actually declared
  `contentSignals` show up here — `flatMap` with an empty-array short
  circuit skips the rest.
- **`isAiProviderImport()` / `hasAiProviderUrl()`** — built from every
  `category: "ai-provider"` descriptor's `importNames`/`importPrefixes`/
  `hosts`, deduplicated into flat sets. These two functions are what let
  the feature engine (ch. 6) and capability detection ask "is this
  specifically an AI provider integration?" without either of them owning
  a duplicate provider list.

## Adding a new signal

Given the pattern above, adding support for a new payment provider, say, is
almost always a two-line change in one existing file — no new files, no
changes to `index.ts`, no changes to any detector:

```ts
// payments.ts
{ name: "LemonSqueezy", category: "provider", importNames: ["@lemonsqueezy/lemonsqueezy.js"] },
```

...plus adding the provider's keyword to the sibling `"Payments"` feature
descriptor's `genericTerms` if you want prose/comment mentions to count
toward the broader "this project has payments" feature signal too.

A genuinely new *domain* (not a new provider within an existing domain) is
the only case that needs a new file: create `my-domain.ts` following the
same `DESCRIPTORS: SignalDescriptor[]` export shape, then add one import
and one spread line to `REGISTRY_DESCRIPTORS` in `index.ts`.

## See also

- Ch. 6 for exactly how `FEATURE_SIGNALS` gets matched against files
- Ch. 3 for how `SERVICES` / `SOURCE_SERVICE_SIGNALS` feed
  `detectExternalServices()`
- Ch. 7 for capability detection's own (separate) threshold-tuning pattern
