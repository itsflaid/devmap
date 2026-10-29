import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getSnapshotPath,
  isSnapshotStale,
  readSnapshotOrThrow,
  type LoadedSnapshot
} from "../cache/snapshot.js";

const DEFAULT_STALE_TTL_MS = 10_000;

export type SnapshotProvider = {
  readonly projectRoot: string;
  /** Read-only. Throws a DevmapError (with hint) when the snapshot is missing or unusable. */
  get(): Promise<LoadedSnapshot>;
};

/**
 * Serves the current snapshot to long-lived callers without re-reading and
 * re-fingerprinting the whole project on every call:
 * - the snapshot is re-read only when snapshot.json changes on disk
 * - the staleness check (which scans project files) is memoized for a short TTL
 */
export function createSnapshotProvider(
  root: string,
  options: { staleTtlMs?: number; now?: () => number } = {}
): SnapshotProvider {
  const projectRoot = resolve(root);
  const ttl = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { mtimeMs: number; snapshot: LoadedSnapshot["snapshot"] } | undefined;
  let staleCache: { value: boolean; at: number; mtimeMs: number } | undefined;

  return {
    projectRoot,
    async get(): Promise<LoadedSnapshot> {
      let mtimeMs: number | undefined;
      try {
        mtimeMs = (await stat(getSnapshotPath(projectRoot))).mtimeMs;
      } catch {
        mtimeMs = undefined;
      }

      if (mtimeMs === undefined || !cached || cached.mtimeMs !== mtimeMs) {
        // Throws DevmapError for missing/corrupt/unsupported snapshots.
        const snapshot = await readSnapshotOrThrow(projectRoot);
        cached = { mtimeMs: mtimeMs ?? 0, snapshot };
        staleCache = undefined;
      }

      const currentMtime = cached.mtimeMs;
      if (!staleCache || staleCache.mtimeMs !== currentMtime || now() - staleCache.at > ttl) {
        staleCache = {
          value: await isSnapshotStale(projectRoot, cached.snapshot),
          at: now(),
          mtimeMs: currentMtime
        };
      }

      return { snapshot: cached.snapshot, stale: staleCache.value };
    }
  };
}
