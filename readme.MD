# devmap

> AI-powered project understanding CLI

Understand any codebase in minutes, not days.

---

## Problem

Modern AI tools can generate code faster than developers can understand it.

Developers often struggle with:

* Unfamiliar codebases
* Missing documentation
* Complex architectures
* Long onboarding time
* AI-generated projects they don't fully understand

---

## Solution

DevMap analyzes your project and helps you understand:

* Project structure
* Architecture
* Features
* Routes & APIs
* Database models
* External services
* Business logic

---

## Features

### Analyze Projects

```bash
devmap analyze
```

Detect:

* Framework
* Routes
* APIs
* Database
* External services

---

### Explain Architecture

```bash
devmap explain
```

Understand:

* Folder structure
* File responsibilities
* Business logic
* System architecture

---

### Ask Questions

```bash
devmap ask "how authentication works"
```

Examples:

```bash
devmap ask "where payment logic is"

devmap ask "explain booking flow"

devmap ask "which files handle AI"
```

---

### Generate Documentation

```bash
devmap docs
```

Output:

```txt
docs/
├── project-overview.md
├── architecture.md
├── onboarding.md
├── api.md
└── flow.md
```

---

### Generate Onboarding Guide

```bash
devmap onboard
```

Helps new developers understand a project quickly.

---

## Installation

### Using npm

```bash
npm install -g devmap
```

### Using pnpm

```bash
pnpm add -g devmap
```

### Using npx

```bash
npx devmap analyze
```

---

## Quick Start

Initialize configuration:

```bash
devmap init
```

Analyze current project:

```bash
devmap analyze
```

Ask a question:

```bash
devmap ask "how authentication works"
```

Generate documentation:

```bash
devmap docs
```

---

## Supported Frameworks

Current MVP:

* Next.js
* React
* TypeScript

Planned:

* Express
* NestJS
* Vue
* Nuxt
* Python
* FastAPI
* Go

---

## Example Output

```txt
Project: Devnote

Framework: Next.js

Routes: 12
Components: 47
APIs: 8

Database:
- Prisma

External Services:
- Google Auth
- Neon
- Resend
```

---

## Roadmap

### MVP

* [ ] init
* [ ] analyze
* [ ] explain
* [ ] ask
* [ ] docs
* [ ] onboard

### Future

* [ ] deadcode
* [ ] visual
* [ ] watch
* [ ] report
* [ ] multi-language support

---

## Architecture

Project
↓
Scanner
↓
Analyzer
↓
Project Map
↓
Context Builder
↓
AI
↓
Output

---

## Vision

DevMap is not another AI coding assistant.

AI coding assistants help developers write code.

DevMap helps developers understand code.

---

## License

MIT
