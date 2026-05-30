# DevMap Architecture

## High-Level Flow

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

## Scanner

Responsible for discovering project structure.

Modules:

* File Scanner
* Route Scanner
* API Scanner
* Database Scanner
* Service Scanner

Output:

project-map.json

## Analyzer

Responsible for understanding relationships.

Detects:

* Framework
* Dependencies
* Features
* Entry points
* Architecture

## Project Map

Central source of truth.

Example:

{
framework: "nextjs",
routes: [],
apis: [],
components: [],
models: [],
services: []
}

## Context Builder

Most important module.

Purpose:

Select only relevant files for AI.

Example:

Question:
"How does authentication work?"

Files selected:

* auth.ts
* middleware.ts
* session.ts
* api/auth/*

Instead of sending 300 files.

## AI Layer

Supported providers:

* Groq
* OpenAI
* Gemini

Responsibilities:

* Explain code
* Answer questions
* Generate docs

## Output Layer

CLI Output

Markdown Output

Future:

* HTML Output
* Interactive Graph Output
