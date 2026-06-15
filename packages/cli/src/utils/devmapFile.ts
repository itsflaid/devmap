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

## Guidance For AI Agents

- Read this file before exploring the repository.
- Prefer the DevMap snapshot to blind repository-wide exploration.
- Use \`--json\` when calling DevMap programmatically so stdout remains one
  parseable JSON document without ANSI or terminal decoration.
- Start from entry points and critical files reported by DevMap.
- Do not edit generated files inside \`.devmap/\`.
- Re-run analysis when the snapshot may be stale.

## Repository Safety

- \`.devmap/\` is local generated state and should stay out of Git.
- Never commit API keys or provider credentials.
- DevMap helps locate relevant code; it does not replace source-level verification.
`;
}
