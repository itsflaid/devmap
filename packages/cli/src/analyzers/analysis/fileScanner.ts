import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import pLimit from "p-limit";
import { shouldIgnorePath } from "./filterEngine.js";

export type ScannedFile = {
  path: string;
  absolutePath: string;
  extension: string;
  size: number;
  lines: number;
  content: string;
};

export async function scanFiles(projectRoot: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  const limit = pLimit(50);

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const tasks: Promise<void>[] = [];

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, "/");

      if (shouldIgnorePath(relativePath, entry.isDirectory(), projectRoot)) {
        continue;
      }

      if (entry.isDirectory()) {
        tasks.push(limit(() => visit(absolutePath)));
        continue;
      }

      tasks.push(limit(async () => {
        const metadata = await stat(absolutePath);
        const content = await readFile(absolutePath, "utf8").catch(() => "");

        files.push({
          path: relativePath,
          absolutePath,
          extension: extname(entry.name).toLowerCase(),
          size: metadata.size,
          lines: content.length === 0 ? 0 : content.split(/\r?\n/).length,
          content
        });
      }));
    }

    await Promise.all(tasks);
  }

  await visit(projectRoot);
  return files;
}
