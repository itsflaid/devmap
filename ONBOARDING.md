# Onboarding Project

## Apa yang Dilakukan Project Ini

devmap-workspace adalah project menggunakan typescript dengan framework workspace astro yang dipetakan dari snapshot DevMap.
Area utamanya terlihat dari fitur terdeteksi seperti AI Integration, Analysis Engine, CLI Commands dan Documentation.
Untuk memahami cara project berjalan, mulai dari entry point packages/cli/src/index.ts, lalu ikuti file yang terhubung dengannya.
Project ini juga terhubung ke external service seperti Groq dan OpenRouter, jadi bagian integrasi perlu dibaca dengan hati-hati.

## Mental Model

User menjalankan CLI command.
Command membaca konfigurasi dan menentukan proses yang dibutuhkan.
Project files discan dan dianalisis menjadi Project Map.
Hasil analisis disimpan sebagai Snapshot.
Command lain memakai Snapshot untuk menjawab, membuat guide, atau memberi output.

## Konsep Utama

### AI Integration

Handles AI providers, prompts, and model-facing context.

Penting karena punya entry point packages/cli/src/ai/provider.ts.

### Analysis Engine

Scans source files and extracts project structure and relationships.

Penting karena punya entry point packages/cli/src/analyzers/projectMap.ts.

### CLI Commands

Contains command entry points that orchestrate DevMap behavior.

Penting karena punya entry point packages/cli/src/index.ts.

### Documentation

Explains project behavior, setup, architecture, and contribution guidance.

Penting karena punya entry point README.md.

### Entry Points

File tempat runtime, command, atau request mulai masuk ke project.

Ini membantu agent membuka file pertama yang benar sebelum membaca detail lain.

### External Services

Integrasi ke service seperti Groq dan OpenRouter.

Area ini biasanya berkaitan dengan credential, network call, dan failure handling.

### Snapshot

Representasi hasil analisis project yang digunakan ulang oleh command lain.

Mengurangi kebutuhan agent membaca repository dari nol setiap kali bekerja.

### Context Retrieval

Proses memilih file paling relevan sebelum AI menjawab pertanyaan.

Ini menjaga jawaban tetap fokus dan menghindari eksplorasi repository yang terlalu luas.

## Area Penting untuk Dipahami

### Priority 1 - Core architecture

- packages/cli/src/analyzers/projectMap.ts
  Purpose: packages/cli/src/analyzers/projectMap.ts orchestrates scanning, analysis, feature mapping, flows, and snapshot metadata.
  Why read this: File ini memberi konteks langsung untuk Analysis Engine dan Snapshot Engine.

- packages/cli/src/analyzers/fileScanner.ts
  Purpose: packages/cli/src/analyzers/fileScanner.ts scans eligible project files while applying ignore and safety rules.
  Why read this: File ini memberi konteks langsung untuk Analysis Engine.

- packages/cli/src/index.ts
  Purpose: packages/cli/src/index.ts implements index cli responsibilities for CLI Commands.
  Why read this: File ini menjelaskan bagaimana eksekusi project dimulai.

- packages/cli/src/ai/types.ts
  Purpose: packages/cli/src/ai/types.ts defines shared type contracts used by neighboring modules.
  Why read this: File ini memberi konteks langsung untuk AI Integration.

- packages/cli/src/ai/contextBuilder.ts
  Purpose: packages/cli/src/ai/contextBuilder.ts selects and bounds repository context before an AI request.
  Why read this: File ini memberi konteks langsung untuk AI Integration.

### Priority 2 - Core execution flow

- packages/cli/src/cache/snapshot.ts
  Purpose: packages/cli/src/cache/snapshot.ts implements snapshot cli responsibilities for Snapshot Engine.
  Why read this: File ini memberi konteks langsung untuk Snapshot Engine.

- packages/cli/src/commands/analyze.ts
  Purpose: packages/cli/src/commands/analyze.ts implements analyze cli responsibilities for CLI Commands.
  Why read this: File ini memberi konteks langsung untuk CLI Commands.

- packages/cli/src/commands/init.ts
  Purpose: packages/cli/src/commands/init.ts implements init cli responsibilities for AI Integration and CLI Commands.
  Why read this: File ini memberi konteks langsung untuk AI Integration dan CLI Commands.

- packages/cli/src/ai/groq.ts
  Purpose: packages/cli/src/ai/groq.ts implements Groq requests, retries, streaming, and provider-specific errors.
  Why read this: File ini memberi konteks langsung untuk AI Integration.

- packages/cli/src/ai/provider.ts
  Purpose: packages/cli/src/ai/provider.ts selects the configured AI provider and resolves model routing for AI-powered commands.
  Why read this: File ini memberi konteks langsung untuk AI Integration.

### Priority 3 - Supporting infrastructure

- packages/cli/src/commands/config.ts
  Purpose: packages/cli/src/commands/config.ts implements config config responsibilities for CLI Commands.
  Why read this: File ini memberi konteks langsung untuk CLI Commands.

- packages/cli/src/analyzers/fileAnalysis.ts
  Purpose: packages/cli/src/analyzers/fileAnalysis.ts implements fileanalysis cli responsibilities for Analysis Engine.
  Why read this: File ini memberi konteks langsung untuk Analysis Engine.

- packages/cli/src/utils/config.ts
  Purpose: packages/cli/src/utils/config.ts implements config config responsibilities.
  Why read this: Banyak bagian project bergantung pada file ini.

- packages/cli/src/analyzers/dependencyGraph.ts
  Purpose: packages/cli/src/analyzers/dependencyGraph.ts implements dependencygraph cli responsibilities for Analysis Engine.
  Why read this: File ini memberi konteks langsung untuk Analysis Engine.

- packages/cli/src/commands/onboarding.ts
  Purpose: packages/cli/src/commands/onboarding.ts implements onboarding cli responsibilities for CLI Commands.
  Why read this: File ini memberi konteks langsung untuk CLI Commands.

### Priority 4 - Utilities and helpers

- packages/cli/src/utils/output.ts
  Purpose: packages/cli/src/utils/output.ts implements output cli responsibilities.
  Why read this: Banyak bagian project bergantung pada file ini.

## Flow Penting

### AI Integration flow

1. packages/cli/src/ai/contextBuilder.ts selects and bounds repository context before an AI request.
2. packages/cli/src/ai/prompts.ts constructs grounded prompts from snapshot and retrieval context.
3. packages/cli/src/ai/provider.ts selects the configured AI provider and resolves model routing for AI-powered commands.
4. packages/cli/src/ai/groq.ts implements Groq requests, retries, streaming, and provider-specific errors.
5. packages/cli/src/ai/completion.ts coordinates streaming and non-streaming AI completion output.

### Analysis Engine flow

1. packages/cli/src/analyzers/fileScanner.ts scans eligible project files while applying ignore and safety rules.
2. packages/cli/src/analyzers/analyzerRegistry.ts implements analyzerregistry cli responsibilities for Analysis Engine.
3. packages/cli/src/analyzers/tsMorphAnalyzer.ts implements tsmorphanalyzer cli responsibilities for Analysis Engine.
4. packages/cli/src/analyzers/projectMap.ts orchestrates scanning, analysis, feature mapping, flows, and snapshot metadata.

### CLI Commands flow

1. packages/cli/src/index.ts implements index cli responsibilities for CLI Commands.
2. packages/cli/src/commands/analyze.ts implements analyze cli responsibilities for CLI Commands.
3. Render human or machine-readable output in packages/cli/src/utils/output.ts.

## Mulai dari Mana

Jika baru pertama kali masuk project ini:

1. Baca `DEVMAP.md` untuk memahami cara memakai Snapshot dan aturan agent.
2. Pahami Mental Model di atas sebelum membuka source file.
3. Buka README.md, AGENTS.md dan package.json sebagai file awal.
4. Ikuti Flow Penting atau feature entry point yang paling dekat dengan task.
5. Baru buka file tambahan jika Snapshot belum cukup menjawab pertanyaan.

Dibuat oleh DevMap dari `.devmap/snapshot.json`.
