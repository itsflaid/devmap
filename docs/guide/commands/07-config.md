# `devmap config model`

**Source:** `packages/cli/src/commands/config.ts`

The smallest command file in the CLI — currently one subcommand
(`config model <model>`), no others. Its only real job is writing a model
override to the right one of ch. 14's two config files, and it's a clean,
small illustration of that layering in practice.

## `--local` is the entire branch point

```ts
if (dependencies.local) {
  await writeLocalConfig(projectRoot, { model: selectedModel });
  // → .devmap/config.local.json, this project only
} else {
  await persistConfig({ ...config, model: selectedModel });
  // → ~/.devmap/config.json, every project using this machine's global config
}
```

Without `--local`, this overwrites the **global** config's `model` field
directly (spreading the existing `config` first, so `provider`/`apiKey`
are preserved untouched) — meaning an unqualified `devmap config model x`
changes the default for every project on the machine, not just the
current one. `--local` writes only `{ model: selectedModel }` to the
project-local file, which is the *only* field `LocalDevmapConfig` is
allowed to hold (ch. 14 — `apiKey`/`provider` are rejected if present in
that file).

## `"auto"` is a real, meaningful value — not just "unset"

```ts
output.success(
  selectedModel === "auto"
    ? config.provider === "openrouter"
      ? "Restored OpenRouter free model routing (openrouter/free)."
      : "Restored automatic command-based model routing."
    : `Default model override set to ${selectedModel}.`
);
```

Running `devmap config model auto` doesn't clear the model field — it
explicitly *sets* it to the string `"auto"`, which is exactly the sentinel
`resolveAiRouting()` (ch. 12) checks for to fall back to per-task routing
(`DEFAULT_AI_MODELS[task]` + fallback chain for Groq, `OPENROUTER_FREE_MODEL`
for OpenRouter). This is how a person un-pins a model they'd previously
locked in — `"auto"` is a deliberate, storable choice, not the absence of
one.

## Requires `init` to have already run — deliberately doesn't bootstrap config itself

```ts
if (!config) {
  output.error("DevMap is not configured yet.");
  output.note("Run devmap init before changing the model.");
  return { status: "error", ... };
}
```

This command only ever *edits* an existing config — it has no path that
creates one from nothing, even under `--local`. Provider selection and API
key validation are `init.ts`'s job alone (ch. commands 1); `config model`
assumes that's already happened and errors out cleanly (a normal returned
error object, not a thrown `DevmapError`) rather than trying to
partially bootstrap a config with no provider or key.

## See also

- Ch. 14 for the global/local config split and why `apiKey`/`provider`
  are global-only
- Ch. 12 for `resolveAiRouting` and exactly what `"auto"` resolves to per
  provider and per task
- [`08-doctor.md`](./08-doctor.md) for where `"project override"` vs.
  `"global"` model provenance gets surfaced for inspection
