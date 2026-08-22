# `devmap init`

**Source:** `packages/cli/src/commands/init.ts`

Sets up everything DevMap needs before `analyze` can do anything AI-backed:
provider choice, API key, model, and three on-disk artifacts
(`.devmap/config.json`'s global counterpart, `DEVMAP.md`, `AGENTS.md`).
See `docs/commands.md` for the user-facing walkthrough — this covers how
it's actually wired.

## The dependency-injection pattern every command shares

```ts
export type InitDependencies = {
  json?: boolean;
  prompt?: Prompt;
  validateApiKey?: (apiKey: string, provider) => Promise<void>;
  listGroqModels?: (apiKey: string) => Promise<string[]>;
  isInteractive?: boolean;
  loadConfig?: () => Promise<DevmapConfig | null>;
  persistConfig?: (config: DevmapConfig) => Promise<void>;
  // ...
};
```

Every side-effecting or network-touching operation is an overridable field
with a real default (`dependencies.listGroqModels ?? listGroqModels`).
This is the same shape `analyze.ts` uses for `loadConfig`/`createAiClient`
— it's how the test suite exercises the full interactive flow without a
real terminal or a real Groq API key, and it's worth following if you're
adding new commands: default to the real implementation, accept an
override for tests.

## Interactivity is derived, not assumed

```ts
const interactive = dependencies.json
  ? false
  : dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
```

`--json` forces non-interactive unconditionally — a JSON-mode caller (a
script, an agent) never gets an interactive prompt injected into its
output stream. Otherwise, interactivity is inferred from both stdin *and*
stdout being real TTYs, which is what makes `devmap init` behave correctly
when piped or run in CI without anyone having to pass an explicit flag.

## Provider → API key → model, each with its own non-interactive fallback

`resolveProvider()`, `resolveApiKey()`, and `resolveInitialModel()` are
three independent resolution chains, each checked in priority order, each
with a sensible non-interactive path rather than just failing outright:

- **Provider**: existing config's provider, else (non-interactively) infer
  from which env var is actually set — `OPENROUTER_API_KEY` present and
  `GROQ_API_KEY` absent → OpenRouter; otherwise Groq is the default.
- **API key**: environment variable first (`GROQ_API_KEY`/
  `OPENROUTER_API_KEY`) — checked *before* the interactive prompt even
  runs — then existing config's stored key, then an interactive prompt
  that shows `[press Enter to keep existing]` when a key is already on
  file. Non-interactive with nothing resolvable throws a `DevmapError`
  naming the exact env var to set.
- **Model**: for Groq, this is the one place `listGroqModels()` (ch. 12's
  `EXCLUDED_MODEL_PATTERNS`-filtered list) actually gets displayed
  interactively — defaulting to the existing model if it's still in the
  live list, otherwise the first available. For OpenRouter, there's no
  live listing at all — just free-text entry defaulting to
  `OPENROUTER_FREE_MODEL`.

## `AGENTS.md`: never silently overwritten

```ts
const appendToExistingAgents = agentsStatus === "existing" && interactive && prompt
  ? isAffirmative(await prompt.ask("AGENTS.md exists. Append DevMap instructions? [y/N]: "))
  : false;
```

If `AGENTS.md` already exists and `init` is running non-interactively
(`--json`, or a non-TTY environment), the default is **not to touch it** —
`ensureAgentsFile(projectRoot, false)` reports `"skipped"`, and
`printAgentsResult()` surfaces an explicit warning telling the person to
re-run interactively to confirm. The bias here is toward never silently
mutating a file that isn't DevMap's alone to own.

## What actually gets written, and in what order

1. `mkdir .devmap/` (recursive — safe if it already exists)
2. `persistConfig({ provider, apiKey, model })` → the **global**
   `~/.devmap/config.json` (ch. 14) — note this happens *before* any of
   the project-local files below, so a failure writing `DEVMAP.md` never
   leaves the provider config half-set.
3. `ensureDevmapIgnored()` → adds `.devmap/` to `.gitignore` if not
   already covered
4. `ensureDevmapFile()` → creates `DEVMAP.md` if absent (never overwrites
   an existing one)
5. `ensureAgentsFile()` → creates or conditionally appends to `AGENTS.md`,
   per the logic above

`prompt?.close()` runs in a `finally` block wrapping the whole flow — the
readline interface gets cleaned up whether `runInit` succeeds, throws a
`DevmapError` (invalid key, no TTY with no env var), or throws anything
else.

## See also

- Ch. 12 for `listGroqModels`/`validateGroqApiKey`/`validateOpenRouterApiKey`
- Ch. 14 for the global vs. local config split this command's output feeds
- [`07-config.md`](./07-config.md) for how the model chosen here gets
  changed later without re-running the whole `init` flow
