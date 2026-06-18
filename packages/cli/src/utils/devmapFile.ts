import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Framework } from "../analyzers/frameworkDetector.js";

export async function ensureDevmapFile(projectRoot: string, framework: Framework): Promise<boolean> {
  const path = join(projectRoot, "DEVMAP.md");

  try {
    await access(path);
    return false;
  } catch {
    await writeFile(path, buildDevmapFile(framework), "utf8");
    return true;
  }
}

export function buildDevmapFile(framework: Framework): string {
  const stack = framework === "unknown" ? "Not detected yet" : framework;

  return `# DevMap

This repository uses DevMap to create reusable project context for developers and AI agents.

## Project Context

- Detected framework: ${stack}
- Generated analysis: \`.devmap/snapshot.json\`
- DevMap config: \`~/.devmap/config.json\`

## Recommended Workflow

1. Run \`devmap analyze\` after cloning the repository.
2. Run \`devmap analyze --fresh\` after major architecture changes.
3. Use \`devmap ask "<question>"\` before manually exploring unrelated files.
4. Treat DevMap output as an architecture overview, then verify critical behavior in source code.

## Commands

\`\`\`bash
devmap analyze
devmap analyze --deep
devmap analyze --json
devmap ask "how does authentication work?"
devmap ask "where is authentication handled?" --json
devmap doctor
devmap doctor --json
\`\`\`

## Agent Navigation Contract

This repository uses DevMap as the primary navigation source. Use snapshot-first,
not repository-scan-first.

Before exploring files, read \`.devmap/snapshot.json\` and prefer these sections:

1. \`features\`
2. \`features.entryPoint\`
3. \`features.businessFlow\`
4. \`flows\`
5. \`onboarding.recommendedPath\`
6. \`changeImpact\`
7. \`criticalFiles\`
8. \`fileIndex\`

Do not scan the whole repository first.

Open source files only when:

- the snapshot is missing;
- the snapshot is stale;
- the snapshot does not contain enough detail;
- exact implementation is required;
- the task is edit, debug, or refactor;
- the user explicitly asks for code changes.

When source inspection is needed, inspect the smallest relevant set first.
Prefer feature entry points and flow steps over broad folder exploration.

## Required Agent Workflow

1. Read \`DEVMAP.md\`.
2. Read \`.devmap/snapshot.json\`.
3. Identify the matching feature, flow, entry point, onboarding path, or change
   impact entry.
4. Inspect at most the smallest relevant source-file set first.
5. Explain which snapshot section guided the decision when giving navigation
   advice.
6. Avoid unrelated files unless the snapshot is incomplete or exact code
   verification is required.

If \`.devmap/snapshot.json\` is missing, run \`devmap analyze\` when DevMap is
available and configured. If analyze fails because DevMap is not initialized,
ask the user to run \`devmap init\` and then \`devmap analyze\`.

If the snapshot may be stale, run \`devmap analyze --fresh\` before relying on
it.

Use \`--json\` when calling DevMap programmatically so stdout remains one
parseable JSON document without ANSI or terminal decoration.

Do not edit generated files inside \`.devmap/\`.

## Repository Safety

- \`.devmap/\` is local generated state and should stay out of Git.
- Never commit API keys or provider credentials.
- DevMap helps locate relevant code; it does not replace source-level verification.
`;
}
