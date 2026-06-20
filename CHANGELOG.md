# Changelog

All notable changes to DevMap are documented in this file.

## [Unreleased]

### Planned

- Automated npm release workflow
- Public benchmark results
- Feedback-driven fixes from the `0.1.0` beta

### Added

- `ts-morph` analysis for JavaScript and TypeScript behind a normalized
  analyzer registry with heuristic and fallback analyzers
- Lightweight `.devmap/index.json` and per-feature navigation maps for agents

### Changed

- Feature detection now separates documentation, landing UI, CLI commands,
  analysis, snapshot, and AI roles before assigning technical features
- Generated agent guidance now uses index-first navigation and treats the full
  snapshot as a last-resort archive

## [0.1.0] - 2026-06-15

Initial early beta release.

### Added

- `devmap init` with Groq key validation and safe project setup
- Static analysis for Next.js and Express projects
- Versioned reusable snapshots with stale and corrupt-state detection
- Route, dependency, entry point, database, feature, and service detection
- `devmap analyze` with cached AI architecture interpretation
- `devmap ask` with bounded context selection and bilingual questions
- Command-based Groq model routing and configurable model overrides
- Streaming human-readable AI responses
- Machine-readable `--json` output for all MVP commands
- `devmap doctor` diagnostics
- Safe `DEVMAP.md` and `AGENTS.md` integration
- Cross-platform CI for Windows, macOS, and Linux on Node.js 18, 20, and 22
- Packed-package end-to-end tests for Next.js and Express fixtures

### Security And Privacy

- Local persisted configuration and snapshots are validated before use
- Context file reads reject traversal and symlink escape outside project root
- Secret files and generated directories are excluded from scanning
- Raw stack traces and API keys are not printed during normal failures

### Known Limitations

- Supported stacks are limited to Next.js and Express
- Groq is the only AI provider
- Token-efficiency benchmarks are not yet published
- External user feedback will be collected after the beta is published

[Unreleased]: https://github.com/itsflaid/devmap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/itsflaid/devmap/releases/tag/v0.1.0
