import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { inspectSnapshot, isSnapshotStale } from "../cache/snapshot.js";
import { runAnalyze } from "../commands/analyze.js";
import { DevmapError } from "../utils/errors.js";
import { withJsonOutput } from "../utils/output.js";

/** A lock older than this is considered abandoned, even if its pid is still alive. */
export const LOCK_STALE_MS = 15 * 60 * 1000;

export type AnalyzeFn = (
  projectRoot: string,
  options: { fresh: boolean; offline: boolean }
) => Promise<ProjectMap>;

export type RefreshOutcome = {
  status: "refreshed" | "unchanged";
  generatedAt: string;
  durationMs: number;
  /** "static" = no AI was used; "ai-enabled" = the server was started with --allow-ai. */
  mode: "static" | "ai-enabled";
  /**
   * True when the previous snapshot had AI-derived data (domain / architecture)
   * that the new, static-only snapshot does not carry.
   */
  aiDataDropped: boolean;
  stats: ProjectMap["stats"];
};

export type Refresher = {
  /**
   * Re-analyze the project and save the snapshot. Concurrent calls join the
   * analysis already in flight instead of starting another one.
   */
  run(options?: { fresh?: boolean }): Promise<RefreshOutcome>;
  isRunning(): boolean;
};

export type RefresherOptions = {
  projectRoot: string;
  /** Let analysis use the configured AI provider. Default false (static only). */
  allowAi?: boolean;
  /** Injected in tests; defaults to the real analyze pipeline, silenced. */
  analyze?: AnalyzeFn;
};

const defaultAnalyze: AnalyzeFn = (projectRoot, options) =>
  withJsonOutput(() => runAnalyze(
    projectRoot,
    { fresh: options.fresh, offline: options.offline, json: true },
    {}
  ));

export function createRefresher(options: RefresherOptions): Refresher {
  const { projectRoot } = options;
  const allowAi = options.allowAi === true;
  const analyze = options.analyze ?? defaultAnalyze;
  let inflight: Promise<RefreshOutcome> | undefined;

  async function execute(fresh: boolean): Promise<RefreshOutcome> {
    const started = Date.now();
    const mode = allowAi ? "ai-enabled" : "static";
    const previous = await inspectSnapshot(projectRoot);

    // Cheap path: nothing changed since the last snapshot, so skip the full analysis.
    if (!fresh && previous.status === "valid" && !(await isSnapshotStale(projectRoot, previous.snapshot))) {
      return {
        status: "unchanged",
        generatedAt: previous.snapshot.generatedAt,
        durationMs: Date.now() - started,
        mode,
        aiDataDropped: false,
        stats: previous.snapshot.stats
      };
    }

    const release = await acquireLock(projectRoot);
    try {
      const snapshot = await analyze(projectRoot, { fresh, offline: !allowAi });
      const hadAi = previous.status === "valid" && Boolean(previous.snapshot.domain || previous.snapshot.ai);
      const hasAi = Boolean(snapshot.domain || snapshot.ai);
      const reused = previous.status === "valid" && previous.snapshot.generatedAt === snapshot.generatedAt;

      return {
        status: reused ? "unchanged" : "refreshed",
        generatedAt: snapshot.generatedAt,
        durationMs: Date.now() - started,
        mode,
        aiDataDropped: hadAi && !hasAi,
        stats: snapshot.stats
      };
    } finally {
      await release();
    }
  }

  return {
    run(runOptions = {}): Promise<RefreshOutcome> {
      if (!inflight) {
        inflight = execute(runOptions.fresh === true).finally(() => {
          inflight = undefined;
        });
      }
      return inflight;
    },
    isRunning(): boolean {
      return inflight !== undefined;
    }
  };
}

// ── cross-process lock ─────────────────────────────────────────────────────

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
 * Take the analysis lock (`.devmap/analyze.lock`) so two MCP servers (or two
 * editor windows) never write the snapshot at the same time. A lock whose
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
