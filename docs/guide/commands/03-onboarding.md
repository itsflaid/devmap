# `devmap onboarding`

**Source:** `packages/cli/src/commands/onboarding.ts`

This file is the **rendering and CLI layer** on top of ch. 15's
`buildOnboardingModel()` — it owns turning an `OnboardingModel` into
Markdown, language resolution, staleness warnings, and the `--write` file
output. If you're looking for where the narrative content itself gets
decided (taglines, "how it works" steps, start-here ordering), that's ch.
15, not here; this file only formats what that model already decided.

## Reads a snapshot, never triggers analysis

```ts
const snapshot = await readSnapshotOrThrow(projectRoot);
const stale = await isSnapshotStale(projectRoot, snapshot);
```

`onboarding` never calls `createProjectMap` itself — it's strictly
downstream of `devmap analyze` having already run at least once.
`readSnapshotOrThrow` (ch. 14) surfaces a clear error if no snapshot
exists yet; `isSnapshotStale` (also ch. 14, the standalone fingerprint
re-check) determines whether to show a staleness warning. Staleness
**never blocks generation** — the guide is still built and shown, just
with a `> ⚠ Snapshot is stale...` callout at the top telling the person to
re-run `devmap analyze --fresh` first if they want current data.

## Language resolution: explicit flag, then interactive, then a quiet default

```ts
const explicitLanguage = normalizeOnboardingLanguage(options.language);
if (explicitLanguage) return explicitLanguage;
if (options.json || (!options.prompt && !process.stdin.isTTY)) return "en";
// otherwise: interactive prompt, "en" if left blank
```

`normalizeOnboardingLanguage()` is generous about matching intent —
`--language id`/`ind`/`indo`/`indonesia`/`indonesian`/`"bahasa indonesia"`
all resolve to `"id"`; `en`/`eng`/`english`/`inggris` all resolve to
`"en"`. Non-interactive contexts (`--json`, piped stdin, no prompt
injected) default straight to English without asking — the same
"never block a non-interactive caller on a question it can't answer"
principle `init.ts` follows for provider/API-key resolution.

## The six-section Markdown structure

`buildOnboardingMarkdown()` assembles, in order: title + tagline + stack
line → optional stale warning → **What this is** (`model.whatThisIs`,
prose) → **How it works** (`model.howItWorks`, rendered as a numbered
list) → **What's inside** (a Markdown table from `model.features`, one row
per feature) → **Start here** (a Markdown table from `model.startHere`,
`# | File | Why read this`) → **Key flows** (see below) → a static
**Go deeper** command reference. Every section header, table header, and
footer line branches on `lang` independently — this file has its own
complete Indonesian/English text, parallel to (but separate from) ch. 15's
own bilingual branching in the model-building step.

### Key flows: rendered directly from the snapshot, not rebuilt

```ts
const topFlows = flows.filter((f) => f.steps.length > 1).slice(0, 3);
```

This reads `snapshot.flows` — ch. 9's `generateMinimalFlows` output —
directly, formatting each as a small box-drawing tree (`├─`/`└─` prefixes)
rather than deriving anything new. Flows with only a single step are
filtered out here specifically because a one-step "flow" reads as noise in
a guide meant to orient a newcomer, even though a single-step entry might
still be technically valid data from ch. 9.

### `Go deeper`: a hardcoded list that needs manual upkeep

```ts
const AVAILABLE_COMMANDS = new Set([
  "init", "analyze", "onboarding", "config", "doctor", "map", "flow", "explain",
]);
```

`GO_DEEPER_ENTRIES` (with bilingual descriptions per command) is filtered
through this set before rendering. **This set is not derived from
`index.ts`'s actual Commander.js registration** — it's a separately
maintained list that happens to describe the same commands. If a new
command is ever added to the CLI without also adding it here, it simply
won't appear in the onboarding guide's "go deeper" section — no error,
no warning, just a silent gap. The comment directly above the constant
says as much: *"Add entries here when new commands ship."* Worth checking
first if you're ever debugging "why doesn't the onboarding guide mention
command X."

## `--write` and the JSON payload shape

Without `--write`, the guide is only printed to the terminal (or returned
as part of the `--json` payload) with a note suggesting the flag. With
`--write`, the same Markdown is saved to `ONBOARDING.md` at the project
root — always that exact filename, not configurable. The `--json` payload
(`OnboardingGuide`) exposes both the **structured** `OnboardingModel`
fields individually (`tagline`, `howItWorks`, `features`, `startHere`,
...) *and* the fully rendered `markdown` string in the same response — a
caller can consume whichever shape it needs without re-deriving one from
the other.

## See also

- Ch. 15 for `buildOnboardingModel` and everything that decides the
  narrative content this file only formats
- Ch. 14 for `readSnapshotOrThrow`/`isSnapshotStale`
- Ch. 9 for `snapshot.flows`, rendered directly by `renderKeyFlows`
