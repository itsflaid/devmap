import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DevmapError } from "../utils/errors.js";

/** A lock older than this is considered abandoned, even if its pid is still alive. */
export const LOCK_STALE_MS = 15 * 60 * 1000;

type LockInfo = { pid: number; startedAt: string };

function lockPath(projectRoot: string): string {
  return join(projectRoot, ".devmap", "analyze.lock");
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(path: string): Promise<LockInfo | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LockInfo>;
    if (typeof parsed.pid === "number" && typeof parsed.startedAt === "string") {
      return { pid: parsed.pid, startedAt: parsed.startedAt };
    }
  } catch {
    // unreadable or half-written: treated as abandoned
  }
  return undefined;
}

/**
 * Take the analysis lock (`.devmap/analyze.lock`) so two analyses (`devmap analyze`,
 * or the MCP server of two editor windows) never write the snapshot at the same time. A lock whose
 * process is gone, or that is older than LOCK_STALE_MS, is taken over.
 */
export async function acquireLock(projectRoot: string): Promise<() => Promise<void>> {
  const path = lockPath(projectRoot);
  await mkdir(join(projectRoot, ".devmap"), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      try {
        const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
        await handle.writeFile(JSON.stringify(info));
      } finally {
        await handle.close();
      }
      return async () => {
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const info = await readLock(path);
      const age = info ? Date.now() - Date.parse(info.startedAt) : Number.POSITIVE_INFINITY;
      if (info && isProcessAlive(info.pid) && age < LOCK_STALE_MS) {
        throw new DevmapError(
          `Another DevMap analysis is already running (pid ${info.pid}).`,
          "Wait for it to finish, then retry."
        );
      }
      await rm(path, { force: true });
    }
  }

  throw new DevmapError(
    "Could not acquire the DevMap analysis lock.",
    "Delete .devmap/analyze.lock if no analysis is running, then retry."
  );
}
