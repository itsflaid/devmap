# DevMap — Contributor & Internals Guide

This folder explains **how DevMap actually works under the hood** — the analysis
engine, not just the CLI surface. It's written for two audiences at once:
the project's own maintainer relearning a module six weeks after writing it,
and a contributor who has never opened this repo before.

## How this is different from `docs/`

The repo already has a `docs/` folder — keep using it, this guide doesn't
replace it:

| Folder | Answers | Style |
|---|---|---|
| `docs/` | *What does DevMap do, as a product?* | User-facing: commands, flags, generated files, roadmap |
| `guide/` (this folder) | *How is it built, and why does it work that way?* | Implementation-facing: function names, algorithms, design tradeoffs |

Concretely: `docs/commands.md` tells you `devmap init` asks for a provider and
saves a config file. `guide/commands/01-init.md` tells you *which functions*
resolve the provider, *how* the API key is validated before anything is
written to disk, and *why* the interactive-vs-JSON branch exists at all.

If a fact is already well documented in `docs/`, this guide links to it
instead of repeating it.

Looking for what a specific file covers without opening it?
[`index.md`](./index.md) has one full paragraph per chapter and per
command doc.

## Scope

Everything here covers `packages/cli` — the actual DevMap engine and CLI.
`apps/web` (the Astro landing page) is out of scope; it's a marketing site,
not part of the system DevMap analyzes projects with.

## Reading order

The 15 numbered chapters follow the same order data actually flows through
`createProjectMap()` (see [`01-pipeline-orchestration.md`](./01-pipeline-orchestration.md)).
Read them in order for a first pass; use them as reference after that.

### The system, chapter by chapter

1. [Pipeline Orchestration](./01-pipeline-orchestration.md) — `createProjectMap()`, the 4-step spine, fingerprinting, the two independent scoring systems
2. [Scanning & Analysis](./02-scanning-and-analysis.md) — file discovery, ignore rules, the TsMorph → Heuristic → Fallback analyzer cascade, preprocessors
3. [Framework & Route Detection](./03-framework-and-route-detection.md) — dependency-first framework detection, per-framework route extraction (7 frameworks), database & service detection
4. [Entity Extraction](./04-entity-extraction.md) — the extractor strategy pattern (Prisma → SQL → route fallback) and the entity relation graph
5. [Signal Registry](./05-signal-registry.md) — the centralized `SignalDescriptor` system behind feature signals, service detection, and AI-provider detection
6. [Feature Detection Engine](./06-feature-detection-engine.md) — `detectFeatures()` end to end, file tiering, and the authentication semantic-role subsystem
7. [Capability Detection](./07-capability-detection.md) — behavioral signals from route shape, and why thresholds are tuned so conservatively
8. [Similarity & Merge](./08-similarity-and-merge.md) — the Jaccard/trigram matching engine and the single `mergeFeatureInto()` used everywhere two feature lists need to combine
9. [Dependency Graph & Flows](./09-dependency-graph-and-flows.md) — the file import graph, entry-point detection, bounded tree walks, and flow generation
10. [Frontend Page Features](./10-frontend-page-features.md) — turning pages and client-side routes into features for Next/Nuxt/SvelteKit/React Router/Vue Router
11. [AI Domain Inference](./11-ai-domain-inference.md) — the ownership-topology heuristics, SHA-256 caching, and the prompt safeguard against naming false positives
12. [AI Provider & Context Builder](./12-ai-provider-and-context-builder.md) — the Groq/OpenRouter clients, retry/fallback/streaming, and the retrieval engine behind `devmap explain`
13. [Agent Navigation Output](./13-agent-navigation-output.md) — what actually gets written to `.devmap/index.json` and `.devmap/features/*.json`, and the scoring behind it
14. [Snapshot, Cache & Config](./14-snapshot-cache-and-config.md) — snapshot persistence/versioning, MD5 vs SHA-256, global vs. project-local config layering
15. [Onboarding System](./15-onboarding-system.md) — the bilingual (EN/ID) project-narration engine that powers `devmap onboarding` (the command itself is documented separately, see below)

### The commands, one file each

`guide/commands/` mirrors `packages/cli/src/commands/` — one file per
registered CLI command, focused on implementation (dependency injection
pattern, JSON-mode branching, error handling), not user-facing usage:

- [`init`](./commands/01-init.md) · [`analyze`](./commands/02-analyze.md) · [`onboarding`](./commands/03-onboarding.md) · [`map`](./commands/04-map.md) · [`flow`](./commands/05-flow.md) · [`explain`](./commands/06-explain.md) · [`config`](./commands/07-config.md) · [`doctor`](./commands/08-doctor.md)

## A running theme

Two ideas show up over and over across these chapters, worth having in mind
up front:

- **Static analysis does the heavy lifting; AI is a thin, optional, cached
  layer on top.** Every chapter through 10 works with zero API key. AI only
  enters at domain inference (ch. 11), architecture/flow narration and
  `explain` (ch. 12) — and every AI call degrades gracefully to "skip it"
  rather than failing the whole analysis.
- **The same primitives get reused instead of re-implemented.** The
  authentication semantic-role detector (ch. 6) is consulted from at least
  four unrelated scoring functions. The similarity/merge engine (ch. 8) is
  the single path both AI-inferred and purely static features go through.
  When you're reading one chapter and a function looks oddly general-purpose,
  it's usually because another chapter also depends on it — the "See also"
  links point to those.

## A note on language

This guide is written in English, matching `README.md`, `CONTRIBUTING.md`,
and the rest of `docs/`. Inline code comments in the actual source are a mix
of English and Indonesian (`projectMap.ts` in particular) — that's a
source-level style choice and doesn't affect anything here.
