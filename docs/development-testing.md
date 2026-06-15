# DevMap Development Testing

## Agent JSON Output

Packaged-command verification should include machine-readable output:

```bash
devmap analyze --json
devmap ask "where is the main entry point?" --json
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
```

Human output should appear progressively without raw Markdown markers. JSON
output should wait for completion and remain one parseable document.
