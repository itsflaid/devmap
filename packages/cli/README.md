# DevMap

Every new AI chat about your code starts from zero — you re-explain
the same codebase every time. DevMap fixes that.

It's a CLI that combines static analysis with optional AI
interpretation to build a structured, reusable understanding layer
of your project — once. That layer (`.devmap/index.json`, feature
maps, `DEVMAP.md`) is what you and any AI agent read afterward,
instead of re-scanning or re-pasting the whole repo. Full repo
source stays local — nothing gets sent wholesale to the AI model.

## Install

```bash
npm install --global @flaid/devmap
```

Or run without a global install:

```bash
npx @flaid/devmap --help
```

## Requirements

- Node.js 22.12 or newer
- An API key for an AI provider: Groq, OpenRouter, or any custom
  OpenAI-compatible endpoint

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

Choose Groq, OpenRouter, or a custom OpenAI-compatible endpoint with the arrow
keys during:

```bash
devmap init
```

Groq keys are available at https://console.groq.com/keys. OpenRouter keys are
available at https://openrouter.ai/keys.

For custom endpoints, DevMap asks for the base URL (prefilled with
`http://localhost:20128/v1`) and lists the models your server exposes, so any
OpenAI-compatible self-hosted gateway works out of the box.

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
devmap map                    # full project map
devmap map <feature-or-file>  # scoped to one feature or file
devmap flow                   # curated top flows
devmap flow <feature-or-route>
devmap explain <target>       # file, feature, or function
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

- Frontend: Next.js, Astro, SvelteKit, Nuxt, React, Vue, Svelte
- Backend: Express, NestJS, Fastify, Koa

Detection covers the full list above; Next.js and Express receive the deepest
analysis. Multi-package workspaces are classified per project type, so a
monorepo containing a CLI and a web app is reported as both.

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
