# DevMap

Understand any codebase in minutes, not days.

DevMap is a CLI that combines static analysis with optional Groq-powered
interpretation. It maps project structure, generates reusable context, and
answers focused questions without sending an entire repository to an AI model.

Version `0.1.0` is an early beta focused on Next.js and Express projects.

## Install

```bash
npm install --global devmap
```

Or run without a global install:

```bash
npx devmap --help
```

## Requirements

- Node.js 18 or newer
- A Groq API key for AI-powered analysis and answers

Static analysis still works when AI is not configured.

## Quick Start

Run these commands from the root of the project you want to understand:

```bash
devmap init
devmap analyze
devmap ask "How does authentication work?"
devmap onboarding
devmap doctor
```

`devmap init` validates the Groq key, stores configuration locally, prepares
`.devmap/`, generates `DEVMAP.md`, and integrates with `AGENTS.md` safely.

## Groq Setup

Create a key at https://console.groq.com/keys, then either enter it during:

```bash
devmap init
```

Or provide it to the current shell before non-interactive setup:

```bash
GROQ_API_KEY="your-key" devmap init
```

On PowerShell:

```powershell
$env:GROQ_API_KEY="your-key"
devmap init
Remove-Item Env:GROQ_API_KEY
```

The key is stored locally in `~/.devmap/config.json`. Requests go directly from
your machine to Groq. DevMap does not send the key to a DevMap-owned server.

## Commands

```bash
devmap init
devmap analyze
devmap analyze --deep
devmap analyze --fresh
devmap ask "Where is payment logic handled?"
devmap onboarding --write
devmap onboarding --write --language id
devmap doctor
devmap config model auto
```

Automatic model routing uses a fast model for focused questions and larger
models for architecture analysis. Override it with:

```bash
devmap config model <groq-model-id>
devmap config model auto
```

## Generated Context

DevMap generates:

- `.devmap/snapshot.json` for structured project analysis
- `DEVMAP.md` for human and AI-agent usage guidance
- a small DevMap block in `AGENTS.md` only after confirmation when the file
  already exists

Existing `AGENTS.md` and `DEVMAP.md` files are never overwritten.

## For AI Agents

Use `--json` for scripts, editors, CI, or AI agents:

```bash
devmap analyze --json
devmap ask "Where is authentication handled?" --json
devmap onboarding --json
devmap doctor --json
```

JSON mode writes one parseable JSON document to stdout without ANSI colors,
terminal decoration, or streamed partial output.

## Supported Stacks

- Next.js
- Express

Other frameworks may be detected partially and are not part of the `0.1.0`
support promise.

## Privacy

- Project analysis runs locally before AI interpretation.
- Full repository source is not sent to Groq.
- `ask` selects a small set of relevant files.
- `.env` files and common generated directories are ignored.
- API keys are stored locally and should never be committed.

## Links

- Repository: https://github.com/itsflaid/devmap
- Issues: https://github.com/itsflaid/devmap/issues
- Changelog: https://github.com/itsflaid/devmap/blob/main/CHANGELOG.md

## License

MIT
