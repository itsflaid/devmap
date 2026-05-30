# DevMap MVP

## MVP Goal

A developer can clone an unfamiliar project and understand it within 5–10 minutes.

## Success Criteria

MVP is complete when:

* devmap analyze works
* devmap explain works
* devmap ask works
* devmap docs works
* devmap onboard works

Supported:

* Next.js
* React
* TypeScript

## Core Commands

### devmap init

Configure AI provider.

### devmap analyze

Analyze project structure.

Output:

* Framework
* Dependencies
* Routes
* APIs
* Models
* External services

### devmap explain

Explain architecture.

Output:

* Folder purpose
* File purpose
* Business logic summary

### devmap ask

Natural language project query.

Examples:

devmap ask "how authentication works"

devmap ask "where payment logic is"

devmap ask "explain booking flow"

### devmap docs

Generate documentation.

Output:

docs/
├── overview.md
├── architecture.md
├── onboarding.md
└── flow.md

### devmap onboard

Create onboarding guide.

Output:

* Start Here section
* Important files
* Learning order

## Not MVP

* Dead code detection
* Visual graph UI
* HTML reports
* Watch mode
* Team collaboration
* Cloud dashboard
* Multi-language support
