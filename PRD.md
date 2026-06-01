# DevMap — Product Requirements Document

> Single source of truth for DevMap development.
> Before adding any feature or changing any priority — read this first.

---

## Product Name

DevMap

## Tagline

Understand any codebase in minutes, not days.

---

## Problem

Modern AI tools generate code faster than developers can understand it.
Developers frequently encounter unfamiliar codebases, missing documentation,
long onboarding time, and AI-generated projects with no clear structure.

Reading every file manually is slow and inefficient.

---

## Vision

DevMap becomes the first tool developers run after cloning a repository.
Not a nice-to-have — a default step in every developer's workflow.

---

## Target Users

**Primary — Individual Developers**
- Vibe coders who use AI heavily and lose track of project architecture
- Freelancers working on unfamiliar client codebases
- IT students onboarding to team projects mid-way

**Secondary — Small Teams**
- Teams that need documentation without maintaining it manually
- Teams onboarding new members frequently

**Not for**
Enterprise teams with dedicated DevOps, or developers who work
on a single codebase for years.

---

## MVP Goal

A developer who has never seen a 200-file Next.js codebase
can understand its main structure in under 10 minutes using DevMap.

---

## Core Commands — MVP

Three commands. No more, no less.
Nothing removed. Nothing added during this holiday.

### `devmap init`
Setup wizard. Ask for API key, save to `~/.devmap/config.json`,
auto-detect project stack. Done in under 30 seconds.

### `devmap analyze`
Run static analysis, feed compact JSON summary to AI,
output a readable architecture overview with AI interpretation.
Save snapshot to `.devmap/snapshot.json` for use by other commands.
Supported stacks for MVP: **Next.js and Express only.**

Use `--deep` flag for detailed per-module explanation:
```bash
devmap analyze         # standard overview
devmap analyze --deep  # detailed explanation per module
```

### `devmap ask "[question]"`
Answer questions about the codebase. Uses existing snapshot,
finds relevant files by keyword search, sends only those files to AI.
Does not re-analyze. If no snapshot exists, runs quick analyze first.

### `devmap doctor`
Diagnostics: check API key validity, model availability, snapshot status.
Output is copy-pasteable when filing a bug report.

---

## Not In MVP

Final decisions. Do not touch during this holiday.

| Feature | Status |
|---|---|
| `devmap docs` | Phase 3 |
| `devmap onboard` | Phase 3 |
| `devmap flow` with visual diagram | Phase 4 |
| `devmap deadcode` | Phase 4 |
| `devmap report` | Phase 4 |
| `devmap watch` | Future |
| `devmap visual` | Future |
| OpenAI support | Phase 5 |
| Gemini support | Phase 5 |
| Local AI / Ollama | Future Ideas |
| Hybrid AI Mode | Future Ideas |
| Team / cloud features | Future Ideas |
| VS Code Extension | Future Ideas |

---

## AI Strategy

**MVP:** Groq only.
Provider abstraction layer built from day one so adding providers
later requires no major refactor.

**Model Routing:**

| Command | Model | Reason |
|---|---|---|
| `analyze`, `ask` | qwen-2.5-coder-32b | Large context, code-focused |
| `analyze --deep` | llama-3.3-70b-versatile | Better reasoning for explanations |
| Fallback (all) | llama-3.3-70b-versatile | When primary model unavailable |

**Future Providers:** OpenAI → Gemini (in that order, post-MVP)

---

## Success Metrics

### Launch — Month 1
- 10+ developers besides myself install and run `devmap analyze`
- 3+ unprompted feedback saying "this is useful"
- Zero crashes on the happy path

### Early Traction — Month 3
- 100+ GitHub stars
- Someone shares DevMap on Twitter or Reddit without being asked
- At least 1 bug report from a real user (not myself)

### Validation — Month 6
- A developer depends on DevMap for their daily workflow
- At least 1 person requests a specific feature
- Someone contributes a PR or opens a meaningful issue

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Static analysis inaccurate on unconventional projects | Limit MVP to Next.js + Express only |
| User frustrated by API key setup | `devmap init` wizard is fully guided |
| AI output misleading | Frame output as "overview", not "ground truth" |
| Windows / Mac / Linux inconsistency | Test on minimum two environments before publish |
| Scope creep during development | This document. Re-read before adding anything new |

---

## Launch Checklist

DevMap is ready to publish when all of these are true:

- [ ] `devmap init`, `analyze`, `ask`, `doctor` run without crashing on Next.js project
- [ ] Tested on at least 3 different real projects
- [ ] All error scenarios handled — no raw stack traces exposed to user
- [ ] Caching works — second analyze of same project uses significantly fewer tokens
- [ ] README written with demo GIF
- [ ] `npm pack` and install from packed file succeeds
- [ ] `npx devmap` works without global install
- [ ] `.devmap/` automatically added to `.gitignore` on init
- [ ] At least one person besides me has tried it and given feedback

---

> Every time a new idea comes up — write it down somewhere else, then return to this document.
> Every time priority feels unclear — re-read the MVP section.
> Every time tempted to add a feature before launching — re-read Not In MVP.
> Ship first. Expand later.