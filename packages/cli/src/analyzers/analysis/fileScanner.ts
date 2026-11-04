import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import pLimit from "p-limit";
import { clearGitignoreCache, shouldIgnorePath } from "./filterEngine.js";
import { compareText } from "../../utils/compare.js";

export type ScannedFile = {
  path: string;
  absolutePath: string;
  extension: string;
  size: number;
  lines: number;
  content: string;
  /** The file is larger than MAX_READ_BYTES: it is listed, but its content was not read. */
  oversize?: boolean;
};

/**
 * Past this size a text file is a dataset, a dump or a generated bundle, and
 * reading it whole is what exhausts the heap: six 400 MB CSV files in one
 * project crashed the process before any analysis started.
 */
export const MAX_READ_BYTES = 5 * 1024 * 1024;

export async function scanFiles(projectRoot: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  const limit = pLimit(50);
  const realRoot = await realpath(projectRoot).catch(() => projectRoot);

  // Ignore files are cached per process; re-read them for every scan.
  clearGitignoreCache();

  // The limiter only guards actual filesystem I/O (readdir, stat + readFile).
  // visit() must NOT run inside limit(): a directory task that awaits its
  // children while holding a slot starves those children once 50 directories
  // are open at the same time, and the whole scan deadlocks.
  async function visit(directory: string, isRoot = false): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await limit(() => readdir(directory, { withFileTypes: true }));
    } catch (error) {
      // A missing/unreadable project root is a real error; an unreadable
      // subdirectory (EACCES, removed mid-scan) must not abort the run.
      if (isRoot) throw error;
      return;
    }
    entries.sort((a, b) => compareText(a.name, b.name));

    const tasks: Promise<void>[] = [];

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, "/");

      if (shouldIgnorePath(relativePath, entry.isDirectory(), projectRoot)) {
        continue;
      }

      if (entry.isDirectory()) {
        tasks.push(visit(absolutePath));
        continue;
      }

      tasks.push(limit(async () => {
        let metadata: Stats;
        try {
          // stat() follows symlinks. Dangling links throw ENOENT; links to
          // directories, FIFOs and sockets are not regular files and must not
          // be read (readFile on a FIFO would block forever).
          metadata = await stat(absolutePath);
        } catch {
          return;
        }
        if (!metadata.isFile()) return;
        // A link that leaves the project would put someone else's file in the map.
        if (entry.isSymbolicLink() && !(await resolvesInside(absolutePath, realRoot))) return;

        const oversize = metadata.size > MAX_READ_BYTES;
        const content = oversize ? "" : await readFile(absolutePath, "utf8").catch(() => "");

        files.push({
          path: relativePath,
          absolutePath,
          extension: extname(entry.name).toLowerCase(),
          size: metadata.size,
          lines: countLines(content),
          content,
          ...(oversize ? { oversize: true } : {})
        });
      }));
    }

    await Promise.all(tasks);
  }

  await visit(projectRoot, true);

  // visit() recurses concurrently, so files.push() order depends on
  // I/O completion timing, not directory structure. Sort here so every
  // downstream consumer (fileIndex ordering, onboarding path ties, etc.)
  // gets a stable, reproducible order across runs on an unchanged project.
  return files.sort((a, b) => compareText(a.path, b.path));
}

async function resolvesInside(path: string, realRoot: string): Promise<boolean> {
  try {
    const target = await realpath(path);
    return target === realRoot || target.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

// Same count as content.split(/\r?\n/).length without allocating a string per line.
function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) lines += 1;
  return lines;
}
