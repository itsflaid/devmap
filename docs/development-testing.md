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
