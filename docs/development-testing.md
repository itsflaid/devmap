# DevMap Development Testing

## Analyzer Registry And Agent Navigation

Focused verification:

```bash
pnpm --filter devmap exec tsx --test test/file-analyzers.test.ts test/agent-navigation.test.ts test/analyzers.test.ts test/analyze-ai.test.ts
```

After `devmap analyze --fresh`, verify:

- JS/TS `fileIndex` entries use `analyzer: "ts-morph"` and high confidence;
- non-JS source keeps heuristic analysis and unknown files use fallback;
- `.devmap/index.json` is short and contains no full `changeImpact` map;
- every index feature points to a readable `.devmap/features/*.json` file;
- docs and landing UI do not become evidence for Authentication or other
  technical backend features;
- generated agent instructions use index-first navigation.

## Agent JSON Output

Packaged-command verification should include machine-readable output:

```bash
devmap analyze --json
devmap ask "where is the main entry point?" --json
devmap onboarding --json
devmap doctor --json
```

Parse stdout directly as JSON and verify that it contains no ANSI codes or
terminal decoration. When invoking through `npm exec` or another package
manager, ignore wrapper-owned stderr warnings and validate DevMap stdout
separately.

## AI Streaming Output

Focused verification:

```bash
pnpm --filter devmap exec tsx --test test/ai-client.test.ts test/ask-command.test.ts test/analyze-ai.test.ts test/json-output.test.ts
```

With a live Groq key, run:

```bash
devmap analyze --fresh
devmap ask "explain the main architecture"
devmap ask "explain the main architecture" --json
devmap onboarding
devmap onboarding --write
```

Human output should appear progressively without raw Markdown markers. JSON
output should wait for completion and remain one parseable document.
