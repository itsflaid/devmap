# DevMap Terminal Design System

## Philosophy

DevMap should feel like:

- Modern developer tool
- Clean and minimal
- Professional
- Technical but approachable

Inspired by:

- Vercel CLI
- Railway CLI
- GitHub CLI
- Claude Code

Avoid:

- Hacker-style terminal noise
- Excessive animations
- Overly futuristic AI aesthetics
- Decorative art that does not help brand recognition

## Brand Color

Primary:

Aqua / Cyan

Hex:

`#2EE6D6`

Terminal truecolor:

`\x1b[38;2;46;230;214m`

Usage:

- command highlights
- success highlights
- progress indicators
- important values
- DevMap wordmark on the welcome screen
- section titles and root help headings

## Secondary Colors

White:

- titles
- command names

Gray:

- descriptions
- hints
- metadata

Green:

- success states

Yellow:

- warnings

Red:

- errors

## Layout Rules

Prefer:

- clean spacing
- grouped information
- short sections

Avoid:

- wall of text
- unrelated decorative art
- unnecessary borders

## Command Style

Good:

```text
> devmap analyze
```

Bad:

```text
DEVMAP ANALYSIS ENGINE INITIALIZATION STARTED
```

## Welcome Screen

The default `devmap` command may use the large DevMap ASCII wordmark as the
primary brand signal. The wordmark should use the aqua brand color.

Everything below the wordmark should stay concise.

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
  devmap ask "..."      ask your codebase
```

## Progress Display

Preferred:

```text
OK Scanning files
OK Detecting framework
OK Building dependency graph
OK Analysis complete
```

In the actual CLI, status labels should be color-coded:

- `OK` uses green
- `WARN` uses yellow
- `ERROR` uses red
- steps and important values use aqua
- metadata and separators use gray

Avoid:

```text
Loading...
Loading...
Loading...
```

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

## AI Responses

Always include:

- summary
- key files
- explanation

Prefer:

```text
This project uses NextAuth.

Key files:

- auth.ts
- middleware.ts
```

Avoid:

- long essay responses

## Terminal Personality

Tone:

- confident
- concise
- technical

Avoid:

- excessive jokes
- excessive emojis
- chat-like responses

DevMap is a professional developer tool.
