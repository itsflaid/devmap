# DevMap

Understand any codebase in minutes, not days.

DevMap is a CLI that combines static analysis with optional AI-powered
interpretation. It maps project structure, generates reusable context, and
maps project structure and generates reusable context without sending an entire repository to an AI model.

Version `0.1.0` is an early beta focused on Next.js and Express projects.

## Install

```bash
npm install --global @flaid/devmap
```

Or run without a global install:

```bash
npx @flaid/devmap --help
```

## Requirements

- Node.js 18 or newer
- A Groq or OpenRouter API key for AI-powered analysis and answers

Static analysis still works when AI is not configured.

## Quick Start

Run these commands from the root of the project you want to understand:

```bash
devmap init
devmap analyze
devmap onboarding
devmap doctor
```

`devmap init` selects a provider, validates its key, stores configuration locally, prepares
`.devmap/`, generates `DEVMAP.md`, and integrates with `AGENTS.md` safely.

## AI Provider Setup

Choose Groq or OpenRouter with the arrow keys during:

```bash
devmap init
```

Groq keys are available at https://console.groq.com/keys. OpenRouter keys are
available at https://openrouter.ai/keys.

For OpenRouter, DevMap prompts:

```txt
OpenRouter model [openrouter/free]:
```

Press Enter to use the free router, or type any free or paid OpenRouter model
ID. The selected model is saved and used as the primary choice.

For non-interactive Groq setup:

```bash
GROQ_API_KEY="your-key" devmap init
```

On PowerShell:

```powershell
$env:GROQ_API_KEY="your-key"
devmap init
Remove-Item Env:GROQ_API_KEY
```

For non-interactive OpenRouter setup:

```bash
OPENROUTER_API_KEY="your-key" devmap init
```

The key is stored locally in `~/.devmap/config.json`. Requests go directly from
your machine to the selected provider. DevMap does not send the key to a
DevMap-owned server.

## Commands

```bash
devmap init
devmap analyze
devmap analyze --fresh
devmap onboarding --write
devmap onboarding --write --language id
devmap doctor
devmap config model auto
```

Groq and OpenRouter use the model selected during init. Change either
provider's model with:

```bash
devmap config model <model-id>
devmap config model auto
```

## Generated Context

DevMap generates:

- `.devmap/index.json` for lightweight AI-agent navigation
- `.devmap/features/*.json` for focused feature maps and source priority
- `.devmap/snapshot.json` for the full structured project analysis archive
- `DEVMAP.md` for human and AI-agent usage guidance
- a small DevMap block in `AGENTS.md` only after confirmation when the file
  already exists

Existing `AGENTS.md` and `DEVMAP.md` files are never overwritten.

## For AI Agents

Read `.devmap/index.json` first, open the relevant feature map, and inspect its
`sourcePriority` files. Use `.devmap/snapshot.json` only when the lightweight
navigation layer is insufficient.

Use `--json` for scripts, editors, CI, or AI agents:

```bash
devmap analyze --json
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
- Full repository source is not sent to the selected provider.
- `.env` files and common generated directories are ignored.
- API keys are stored locally and should never be committed.

## Links

- Repository: https://github.com/itsflaid/devmap
- Issues: https://github.com/itsflaid/devmap/issues
- Changelog: https://github.com/itsflaid/devmap/blob/main/CHANGELOG.md

## License

MIT
