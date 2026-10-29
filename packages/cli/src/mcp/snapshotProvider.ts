import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getSnapshotPath,
  isSnapshotStale,
  readSnapshotOrThrow,
  type LoadedSnapshot
} from "../cache/snapshot.js";
import { DevmapError } from "../utils/errors.js";

const DEFAULT_STALE_TTL_MS = 10_000;
const DEFAULT_RETRY_COOLDOWN_MS = 30_000;

export type ProviderSnapshot = LoadedSnapshot & {
  /** True when this call re-analyzed the project (auto-refresh) before answering. */
  refreshed: boolean;
  /** Set when auto-refresh was attempted and failed; the older snapshot is served instead. */
  refreshError?: string;
};

export type SnapshotProvider = {
  readonly projectRoot: string;
  /** Throws a DevmapError (with hint) when the snapshot is missing or unusable. */
  get(): Promise<ProviderSnapshot>;
  /** Drop cached state, e.g. after the snapshot was rewritten by an analysis. */
  invalidate(): void;
};

export type SnapshotProviderOptions = {
  staleTtlMs?: number;
  now?: () => number;
  /**
   * Opt-in auto-refresh. Called when the snapshot is stale (or missing); the
   * provider then reloads the snapshot. Off by default: reads never write.
   */
  autoRefresh?: () => Promise<unknown>;
  /** After a failed auto-refresh, wait this long before trying again. */
  retryCooldownMs?: number;
};

/**
 * Serves the current snapshot to long-lived callers without re-reading and
 * re-fingerprinting the whole project on every call:
 * - the snapshot is re-read only when snapshot.json changes on disk
 * - the staleness check (which scans project files) is memoized for a short TTL
 * - with `autoRefresh`, a stale snapshot is rebuilt before answering
 */
export function createSnapshotProvider(
  root: string,
  options: SnapshotProviderOptions = {}
): SnapshotProvider {
  const projectRoot = resolve(root);
  const ttl = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
  const now = options.now ?? Date.now;
  const cooldown = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const { autoRefresh } = options;

  let cached: { mtimeMs: number; snapshot: LoadedSnapshot["snapshot"] } | undefined;
  let staleCache: { value: boolean; at: number; mtimeMs: number } | undefined;
  let lastRefreshFailure: { at: number; message: string } | undefined;

  function invalidate(): void {
    cached = undefined;
    staleCache = undefined;
  }

  async function load(): Promise<LoadedSnapshot> {
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

  return {
    projectRoot,
    invalidate,
    async get(): Promise<ProviderSnapshot> {
      let loaded: LoadedSnapshot;
      let refreshed = false;
      let refreshError: string | undefined;

      try {
        loaded = await load();
      } catch (error) {
        if (!autoRefresh || !(error instanceof DevmapError)) throw error;
        // No usable snapshot: build the first one. A failure here is the real error.
        await autoRefresh();
        invalidate();
        loaded = await load();
        refreshed = true;
      }

      if (loaded.stale && autoRefresh && !refreshed) {
        if (lastRefreshFailure && now() - lastRefreshFailure.at < cooldown) {
          refreshError = lastRefreshFailure.message;
        } else {
          try {
            await autoRefresh();
            invalidate();
            loaded = await load();
            refreshed = true;
            lastRefreshFailure = undefined;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lastRefreshFailure = { at: now(), message };
            refreshError = message;
          }
        }
      }

      return { ...loaded, refreshed, ...(refreshError ? { refreshError } : {}) };
    }
  };
}
