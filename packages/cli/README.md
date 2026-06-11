# DevMap

Understand any codebase in minutes, not days.

## Install

```bash
npm install --global devmap
```

Or run it without a global install:

```bash
npx devmap --help
```

## Quick Start

```bash
devmap init
devmap analyze
devmap ask "How does authentication work?"
devmap doctor
```

DevMap generates a reusable project snapshot at
`.devmap/snapshot.json`. The snapshot combines static analysis with an optional
Groq-powered architecture interpretation.

## Requirements

- Node.js 18 or newer
- A Groq API key for AI-powered analysis and answers

Source code, documentation, and issue tracking are available at
https://github.com/itsflaid/devmap.
