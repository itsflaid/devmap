import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function ensureDevmapIgnored(projectRoot: string): Promise<boolean> {
  const gitignorePath = join(projectRoot, ".gitignore");

  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch {
    current = "";
  }

  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(".devmap/") || lines.includes(".devmap")) {
    return false;
  }

  const next = current.length > 0 && !current.endsWith("\n")
    ? `${current}\n.devmap/\n`
    : `${current}.devmap/\n`;

  await writeFile(gitignorePath, next, "utf8");
  return true;
}
