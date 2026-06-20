import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DevmapError } from "./errors.js";

const DEVMAP_AGENTS_MARKER = "<!-- DevMap Instruction Block -->";
const LEGACY_DEVMAP_AGENTS_MARKER = "<!-- DEVMap Instruction Block -->";

export const DEVMAP_AGENTS_BLOCK = `${DEVMAP_AGENTS_MARKER}
## DevMap Context

Before working in this repository, read \`DEVMAP.md\` first.
Read \`.devmap/index.json\` first, then the relevant
\`.devmap/features/*.json\` map. Inspect files from \`sourcePriority\` before
exploring broadly. Use \`.devmap/snapshot.json\` only when those lightweight
navigation files are insufficient. If the navigation files are missing, run
\`devmap analyze\`.
<!-- End DevMap Instruction Block -->`;

export type AgentsFileStatus = "missing" | "existing" | "integrated";
export type AgentsFileResult = "created" | "appended" | "unchanged" | "skipped";

export async function inspectAgentsFile(projectRoot: string): Promise<AgentsFileStatus> {
  const path = join(projectRoot, "AGENTS.md");

  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new DevmapError(
        "Refusing to update a symlinked AGENTS.md.",
        "Replace the symlink with a regular file before running devmap init."
      );
    }

    const content = await readFile(path, "utf8");
    return (
      content.includes(DEVMAP_AGENTS_MARKER)
      || content.includes(LEGACY_DEVMAP_AGENTS_MARKER)
    )
      ? "integrated"
      : "existing";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "missing";
    }

    throw error;
  }
}

export async function ensureAgentsFile(
  projectRoot: string,
  appendToExisting: boolean
): Promise<AgentsFileResult> {
  const path = join(projectRoot, "AGENTS.md");
  const status = await inspectAgentsFile(projectRoot);

  if (status === "integrated") {
    return "unchanged";
  }

  if (status === "existing") {
    if (!appendToExisting) {
      return "skipped";
    }

    const content = await readFile(path, "utf8");
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    await appendFile(path, `${separator}${DEVMAP_AGENTS_BLOCK}\n`, "utf8");
    return "appended";
  }

  try {
    await writeFile(
      path,
      `# AI Agent Instructions\n\n${DEVMAP_AGENTS_BLOCK}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    return "created";
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return ensureAgentsFile(projectRoot, appendToExisting);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
