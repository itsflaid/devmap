import type { ProjectMap } from "../analyzers/pipeline/index.js";
import { acquireLock, LOCK_STALE_MS } from "../cache/analysisLock.js";
import { inspectSnapshot, isSnapshotStale } from "../cache/snapshot.js";
import { runAnalyze } from "../commands/analyze.js";
import { withJsonOutput } from "../utils/output.js";

// The lock itself lives in cache/analysisLock.ts so `devmap analyze` can share it.
export { acquireLock, LOCK_STALE_MS };

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
