# DevMap — Design System

← Back to Roadmap: ./roadmap.md

---

# Philosophy

DevMap should feel like:

* Modern developer tool
* Clean and minimal
* Professional
* Technical but approachable

Inspired by:

* Vercel CLI
* Railway CLI
* GitHub CLI
* Claude Code

Avoid:

* Hacker-style terminal noise
* Excessive animations
* Overly futuristic AI aesthetics
* Decorative art that does not help brand recognition

---

# Brand Identity

## Core Brand

DevMap is a project understanding tool.

The visual identity should communicate:

* Mapping
* Navigation
* Structure
* Context
* Discovery

Not:

* AI magic
* Chatbots
* Robot assistants
* Code generation

---

# Brand Color

Primary:

```txt
#2EE6D6
```

Terminal truecolor:

```txt
\x1b[38;2;46;230;214m
```

Usage:

* command highlights
* success highlights
* progress indicators
* important values
* DevMap wordmark on the welcome screen
* section titles and root help headings

---

# Secondary Colors

White:

* titles
* command names

Gray:

* descriptions
* hints
* metadata

Green:

* success states

Yellow:

* warnings

Red:

* errors

---

# Terminal Design

## Layout Rules

Prefer:

* clean spacing
* grouped information
* short sections

Avoid:

* wall of text
* unrelated decorative art
* unnecessary borders

---

## Command Style

Good:

```text
> devmap analyze
```

Bad:

```text
DEVMAP ANALYSIS ENGINE INITIALIZATION STARTED
```

---

## Welcome Screen

The default `devmap` command may use the large DevMap ASCII wordmark as the primary brand signal.

The wordmark should use the aqua brand color.

Everything below the wordmark should stay concise.

The welcome brand signal uses a large outlined block DevMap wordmark
without a surrounding panel or separate symbol. A small CLI label, concise
capability line, and solid aqua separator make it feel like a professional
developer tool without adding decorative terminal noise.

Narrow terminals use a compact `DEVMAP` title and shorter capability label so
the welcome header does not wrap or clip. The wide wordmark relies on Unicode
block and box-drawing glyphs; terminals without compatible fonts may use the
compact fallback or require a font configuration adjustment.

Example:

```text
devmap

Understand Any Codebase.

No project analyzed yet.

Start with:

  devmap init
  devmap analyze

Popular commands:

  devmap analyze        scan current project
  devmap onboarding     generate reading guide
```

---

## Progress Display

Preferred:

```text
OK Scanning files
OK Detecting framework
OK Building dependency graph
OK Analysis complete
```

In the actual CLI, status labels should be color-coded:

* `OK` uses green
* `WARN` uses yellow
* `ERROR` uses red
* steps and important values use aqua
* metadata and separators use gray

Avoid:

```text
Loading...
Loading...
Loading...
```

---

## Analysis Output

Use sections.

Example:

```text
Project Overview

Framework:
Next.js

Routes:
18

Dependencies:
45

Database:
PostgreSQL
```

---

## AI Responses

Always include:

* summary
* key files
* explanation

Prefer:

```text
This project uses NextAuth.

Key files:

- auth.ts
- middleware.ts
```

Avoid:

* long essay responses

---

## Terminal Personality

Tone:

* confident
* concise
* technical

Avoid:

* excessive jokes
* excessive emojis
* chat-like responses

DevMap is a professional developer tool.

---

# Landing Page Design

Use the provided landing page reference as the north star for DevMap's web UI.

---

## Theme

* Use a dark terminal-inspired interface with near-black backgrounds, subtle blue-black panels, thin borders, and glassy depth.
* The primary accent is aqua, not cyan.
* Favor `#22e4d6`, `#4efaf0`, and nearby green-blue terminal tones.
* Avoid bright cyan, purple gradients, beige palettes, and generic SaaS hero styling.
* Keep the product feeling CLI-first: terminal windows, command prompts, project trees, code stats, and developer workflow details should be visible early.

---

## Layout

* First viewport should immediately show the DevMap brand, headline, CTA, install command, and a large terminal/codebase preview.
* Use compact cards with 8px radius or less for repeated features.
* Avoid nested cards and marketing-style split illustration blocks.
* Keep sections dense, scannable, and developer-oriented.

---

## Visual Language

* Prefer monospaced text for commands, terminal labels, project trees, metrics, and code-like content.
* Use subtle grid/network details only as background texture.
* Use aqua glows sparingly around important controls or terminal accents.
* Buttons should feel like terminal actions: squared, solid aqua for primary, dark bordered for secondary.
* Hero architecture nodes should feel alive with subtle floating/orbit animation, not static decoration.
* CTA/footer sections may use moving aqua wave lines and compass/map motifs to echo the reference design.

---

## Copy Direction

* Lead with codebase understanding, project mapping, CLI speed, and asking questions about code.
* Keep visible copy practical and concise.
* Avoid explaining the interface inside the UI; show the workflow instead.

---

# Design Principles

Before adding any UI element ask:

1. Does it help developers understand a project faster?
2. Does it reinforce the DevMap identity?
3. Would removing it make the product clearer?

If not:

Remove it.

---

# Source of Truth

Product direction:

* roadmap.md

Command behavior:

* commands.md

Architecture:

* architecture.md

Roadmap:

* roadmap.md
