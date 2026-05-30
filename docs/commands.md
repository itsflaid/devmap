# DevMap Commands

## devmap init

Initialize DevMap configuration.

### Purpose

Setup AI provider and API key.

### Usage

```bash
devmap init
```

### Flow

Select provider:

* Groq
* OpenAI
* Gemini

Input API Key

Generate:

```txt
~/.devmap/config.json
```

### Output

```txt
✓ Configuration created
✓ Provider: Groq
✓ API Key saved
```

---

## devmap analyze

Analyze current project.

### Usage

```bash
devmap analyze
```

### Options

```bash
devmap analyze
devmap analyze .
devmap analyze ./project
```

### Detects

Framework:

* Next.js
* React
* Express
* Node.js

Project Statistics:

* Total files
* Total folders
* Components
* Routes
* APIs

Database:

* Prisma
* Drizzle

External Services:

* Supabase
* Firebase
* Stripe
* Resend
* Midtrans
* Clerk

### Output

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
```

### Generates

```txt
.devmap/project-map.json
```

---

## devmap explain

Explain project architecture.

### Usage

```bash
devmap explain
```

### Purpose

Understand project structure quickly.

### Output

```txt
components/
Contains reusable UI components.

lib/
Contains business logic and utilities.

prisma/
Contains database schema.
```

### Additional Output

Architecture Summary:

```txt
Frontend
↓
API
↓
Database
```

---

## devmap ask

Ask questions about the codebase.

### Usage

```bash
devmap ask "how authentication works"
```

### Examples

```bash
devmap ask "how authentication works"

devmap ask "where payment logic is"

devmap ask "explain booking flow"

devmap ask "where user is created"

devmap ask "which files handle AI"
```

### Internal Flow

Question
↓
Context Builder
↓
Relevant Files
↓
AI
↓
Answer

### Output

```txt
Authentication is handled by:

- middleware.ts
- auth.ts
- app/api/auth

Flow:

User Login
↓
NextAuth
↓
Session Created
```

---

## devmap docs

Generate documentation.

### Usage

```bash
devmap docs
```

### Output

```txt
docs/

├── project-overview.md
├── architecture.md
├── onboarding.md
├── api.md
└── flow.md
```

### Includes

Project Summary

Architecture

Detected Features

Routes

Database Models

External Services

---

## devmap onboard

Generate onboarding guide.

### Usage

```bash
devmap onboard
```

### Purpose

Help new developers understand project.

### Output

```txt
Start Here

1. app/page.tsx

2. app/dashboard/page.tsx

3. lib/auth.ts

4. prisma/schema.prisma
```

### Includes

Important Files

Recommended Reading Order

Architecture Overview

Learning Path

---

# Future Commands

## devmap flow

Generate flow diagram.

```bash
devmap flow
```

Output:

Mermaid Diagram

User Flow

API Flow

Service Flow

---

## devmap deadcode

Find unused code.

```bash
devmap deadcode
```

Output:

Unused Components

Unused Hooks

Unused Utilities

Unused Services

---

## devmap report

Generate health report.

```bash
devmap report
```

Output:

Architecture Score

Code Health Score

Documentation Score

Recommendations

---

## devmap visual

Generate architecture graph.

```bash
devmap visual
```

Output:

SVG

PNG

Mermaid

Interactive Graph

---

## devmap watch

Watch project changes.

```bash
devmap watch
```

Automatically updates:

* project map
* documentation
* architecture data
