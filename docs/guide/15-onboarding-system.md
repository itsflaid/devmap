# 15. Onboarding System

**Source:** `packages/cli/src/onboarding/`

This is the last system chapter, and it's a different kind of module than
the previous fourteen: **zero AI calls, zero new analysis** — everything
here operates on an already-complete `ProjectMap` and turns it into a
human-readable project narrative, bilingually. The `devmap onboarding`
*command* that exposes this is documented separately in
[`commands/03-onboarding.md`](./commands/03-onboarding.md) — this chapter
is only the model-building logic underneath it.

## `model.ts` is a pure shape, nothing else

```ts
export interface OnboardingModel {
  language: OnboardingLanguage;   // "en" | "id"
  projectName: string;
  tagline: string;
  stackLine: string;
  whatThisIs: string;
  howItWorks: ConceptualStep[];
  features: FeatureSummary[];
  startHere: StartHereItem[];
  generatedAt: string;
  isStale: boolean;
}
```

No functions live in this file — it exists purely so `modelBuilder.ts` and
`commands/onboarding.ts` share one contract without either owning it.

## `buildOnboardingModel()` — the single entry point

Everything else in `modelBuilder.ts` is a private helper feeding into this
one function, each field built independently from a different slice of the
snapshot:

```ts
export function buildOnboardingModel(snapshot: ProjectMap, language: OnboardingLanguage): OnboardingModel {
  return {
    language,
    projectName: snapshot.project.name || "project",
    tagline: buildTagline(snapshot, language),
    stackLine: buildStackLine(snapshot),
    whatThisIs: buildWhatThisIs(snapshot, language),
    howItWorks: buildHowItWorks(snapshot, language),
    features: buildFeatureSummaries(snapshot, language),
    startHere: buildStartHere(snapshot, language),
    generatedAt: snapshot.generatedAt,
    isStale: false,
  };
}
```

Every one of the `build*` helpers below branches on `language` internally
— this isn't a translation layer bolted on afterward; the Indonesian and
English narratives are constructed as two genuinely separate template
trees within the same function, sentence by sentence.

## `resolveOwnershipHint()` — ch. 11's safeguard, reused for narrative rather than inference

`buildTagline()` leans on `snapshot.domain.ownershipPattern` — the exact
same field ch. 11's domain inference computed structural evidence for —
but for a different purpose here: not steering an AI prompt away from a
wrong conclusion, but directly picking which of three tagline templates
("Personal app…", "Direct messaging platform…", "Collaborative app…") to
render. The same `single_user_isolated` classification that stops the AI
from over-calling something "chat" in ch. 11 is what makes the onboarding
tagline correctly say **"Personal app"** instead of guessing from entity
names.

## `buildWhatThisIs()` — a second, independent line of defense against the same false positive

This is worth reading closely because it's a genuinely elegant callback to
ch. 11's flagship example, applied at a different layer:

```ts
const hasMisleadingChat = entityNames.includes("Message") && domainPattern === "single_user_isolated";
if (hasMisleadingChat) {
  const roomEntity = entityNames.find((e) => e === "Room" || e === "Channel" || e === "Thread");
  if (roomEntity) {
    sentences.push(
      language === "id"
        ? `"${roomEntity}" adalah wadah (seperti folder), dan "Message" adalah isinya — bukan komunikasi antar user.`
        : `"${roomEntity}" acts as a container (like a folder), and "Message" is its content — not inter-user communication.`
    );
  }
}
```

Even *after* domain inference has already correctly avoided calling this
project "chat" (ch. 11), a human reading `Message`/`Room` in the entity
list could still form the wrong impression on their own. This code adds an
explicit clarifying sentence specifically for that reader — the same
underlying worry (entity names implying multi-user communication that
isn't actually there) is handled twice, once to keep the AI from
mis-stating it, once to keep a human from mis-reading it.

## `buildHowItWorks()` — four narrative templates, not one filled-in blank

Rather than one generic "how it works" paragraph, this dispatches to one
of four **entirely separate** step sequences based on project shape:

```ts
if (isCli) return buildCliFlow(...);
if (hasAuth && hasRoutes) return buildAuthWebAppFlow(...);
if (hasRoutes) return buildPublicWebAppFlow(...);
return buildGenericFlow(...);
```

`buildAuthWebAppFlow` is the most detailed — it further branches on
`ownershipPattern` for one of its steps ("all data belongs to the logged-
in user" vs. "data can be shared across users") and names actual entities
(excluding infra ones — `User`, `Session`, `Account`,
`VerificationToken`) pulled from `entityGraph`. A CLI project never sees
"user logs in" language; a routeless library-shaped project falls through
to the generic four-step template. This is a real decision tree matched to
project shape, not string interpolation into one fixed paragraph.

## `isBoilerplatePurpose()` — yet another "is this text generic" check

```ts
function isBoilerplatePurpose(purpose: string): boolean {
  return /\b(exposes|contains project code|identifies .* capability|detected as)\b/i.test(purpose);
}
```

`buildFeatureWhat()` uses this to decide whether a feature's existing
`purpose` string is worth quoting directly in the onboarding narrative, or
whether it should fall back to a generated `"Handles X for the project."`
sentence instead. This is conceptually the same problem ch. 8's
`isGenericPurpose()` solves for feature-merge decisions — **but it's a
separate function with a separate regex**, not a shared import. If a new
kind of auto-generated boilerplate purpose gets introduced elsewhere in
the pipeline, both of these checks would need updating independently for
the "don't quote generic text as if it were specific" behavior to stay
consistent everywhere it matters.

## `buildStartHere()` — a third independent "what to read first" ranking

This is the detail most worth internalizing from this chapter, because
it's easy to assume there's one canonical "critical files" list in DevMap
when there are actually **three**, each answering a related but distinct
question:

| Ranking | Lives in | Answers | Output |
|---|---|---|---|
| `rankCriticalFiles()` | ch. 1 | "What are this project's 10 most structurally important files?" | `snapshot.criticalFiles`, shown in CLI output |
| `selectIndexCriticalFiles()` | ch. 13 | "In what order should an AI agent open files, globally?" | `index.json`'s `sourcePriority` |
| `buildStartHere()` | this chapter | "What's a good **narrated, reasoned** reading order for a human just joining this project?" | `onboarding.startHere`, each entry with a **prose reason**, not just a score |

`buildStartHere()` seeds its list from a deliberately curated, ordered
sequence rather than a single scoring formula: the `Authentication`
feature's entry point first (if one exists — "understand who can access
what before reading anything else"), then a Prisma schema file if present,
then the first two global entry points, then one entry point per
high/medium-confidence feature (excluding Authentication, already added),
then remaining `criticalFiles` with a reason derived from their
**`REASON_TAGS`** (ch. 1's `CORE_EXECUTION_RESPONSIBILITY`/
`CORE_PROJECT_CONCERN` tags, reused directly here via
`buildCriticalFileReason()`), then finally anything left in
`onboarding.recommendedPath` (ch. 9) not already included. A `Map` keyed
by path dedupes across all of these sources, first-added-wins.

If you're ever asked to change "what file should a newcomer read first,"
the honest answer is: figure out which of these three functions actually
produces the output you're looking at, because fixing one won't affect the
other two.

## `isReadableSourceFile()` — a fourth exclusion filter, narrowly scoped

One more small independent implementation worth flagging on the same
theme as ch. 6's `classifyFileTier`: `isReadableSourceFile()` excludes
migrations, `.sql` files, generated code, lockfiles, and images from ever
appearing in `startHere` — conceptually the same exclusion `classifyFileTier`
applies via its `"excluded"` tier, but implemented as its own regex list
here rather than calling into that function. Onboarding output only needs
a yes/no filter, not the four-way tier classification the feature engine
needs, so a lighter-weight duplicate was written instead of importing the
heavier one.

## See also

- Ch. 11 for `ownershipPattern` and the original chat/personal-app
  ambiguity this chapter's `hasMisleadingChat` check echoes
- Ch. 1 for `REASON_TAGS` and `rankCriticalFiles`, the first of the three
  "start here" rankings
- Ch. 13 for `selectIndexCriticalFiles`, the second
- Ch. 8 for `isGenericPurpose`, the sibling of this chapter's
  `isBoilerplatePurpose`
- [`commands/03-onboarding.md`](./commands/03-onboarding.md) for how this
  model actually gets rendered and written to disk by the CLI command
