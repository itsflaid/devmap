import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runExplain, type ExplainDependencies } from "../commands/explain.js";
import { runFlow } from "../commands/flow.js";
import { runMap } from "../commands/map.js";
import { DevmapError } from "../utils/errors.js";
import { withJsonOutput } from "../utils/output.js";
import { DEVMAP_VERSION } from "../utils/packageMetadata.js";
import { registerPrompts } from "./prompts.js";
import {
  buildOverview,
  queryFind,
  queryImpact,
  queryRoutes
} from "./queries.js";
import { createRefresher, type AnalyzeFn, type Refresher } from "./refresh.js";
import {
  createSnapshotProvider,
  type ProviderSnapshot,
  type SnapshotProvider
} from "./snapshotProvider.js";

export const MAX_TEXT_CHARS = 30_000;
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const SERVER_INSTRUCTIONS = [
  "DevMap gives you a precomputed map of this codebase (features, routes, flows, dependency graph).",
  "Start with devmap_overview, then drill into one feature with devmap_map or devmap_flow instead of reading many files.",
  "Call devmap_impact before changing a file, and devmap_find to locate code by keyword.",
  "Every result includes snapshot.stale; when it is true the code changed after the last analysis, so results may be outdated: call devmap_analyze to refresh the snapshot, then repeat the query.",
  "Prompts devmap_onboard and devmap_plan_change describe ready-made workflows."
].join(" ");

const EXPLAIN_NOTE =
  "devmap_explain sends excerpts of the project's source files to the user's configured AI provider, so it only exists when the server was started with --allow-ai.";

const DEFAULT_ANALYZE_TIMEOUT_SECONDS = 120;
const DEFAULT_HEARTBEAT_MS = 5_000;

export type DevmapServerOptions = {
  projectRoot: string;
  /**
   * Re-analyze automatically when the snapshot is stale or missing, before
   * answering a query. Off by default: queries never write to disk.
   */
  autoRefresh?: boolean;
  /**
   * Let analysis use the configured AI provider (domain inference, enrichment).
   * Off by default: analysis is static, so agents cannot spend AI quota or send
   * project metadata to a provider on their own.
   */
  allowAi?: boolean;
  /** Inject a provider (tests); defaults to a cached provider for `projectRoot`. */
  provider?: SnapshotProvider;
  /** Inject a refresher (tests). */
  refresher?: Refresher;
  /** Inject the analysis function (tests). */
  analyze?: AnalyzeFn;
  /** Inject the AI config/client used by devmap_explain (tests). */
  explainDependencies?: ExplainDependencies;
  /** Interval of progress notifications while devmap_analyze runs. */
  heartbeatMs?: number;
};

export type DevmapServer = {
  server: McpServer;
  provider: SnapshotProvider;
  refresher: Refresher;
};

export function truncateText(value: string, max = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, max)}\n\n… [truncated ${value.length - max} characters]`,
    truncated: true
  };
}

function snapshotMeta(loaded: ProviderSnapshot): {
  generatedAt: string;
  stale: boolean;
  refreshed?: boolean;
  refreshError?: string;
  note?: string;
} {
  return {
    generatedAt: loaded.snapshot.generatedAt,
    stale: loaded.stale,
    ...(loaded.refreshed ? { refreshed: true } : {}),
    ...(loaded.refreshError ? { refreshError: loaded.refreshError } : {}),
    ...(loaded.stale
      ? {
        note: loaded.refreshError
          ? `Auto-refresh failed (${loaded.refreshError}). Results come from an older snapshot.`
          : "The code changed after this snapshot was generated. Results may be outdated; call devmap_analyze to refresh."
      }
      : {})
  };
}

/** Wait for a promise, but give up waiting after `ms` (the promise keeps running). */
async function waitFor<T>(promise: Promise<T>, ms: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout({ timedOut: true }), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function fail(error: unknown): CallToolResult {
  const payload = error instanceof DevmapError
    ? { error: error.message, ...(error.hint ? { hint: error.hint } : {}) }
    : { error: error instanceof Error ? error.message : String(error) };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function respond(action: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await action());
  } catch (error) {
    return fail(error);
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function createDevmapServer(options: DevmapServerOptions): DevmapServer {
  const refresher = options.refresher ?? createRefresher({
    projectRoot: options.projectRoot,
    allowAi: options.allowAi,
    analyze: options.analyze
  });
  const provider = options.provider ?? createSnapshotProvider(options.projectRoot, {
    autoRefresh: options.autoRefresh ? () => refresher.run() : undefined
  });
  const projectRoot = provider.projectRoot;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const server = new McpServer(
    { name: "devmap", version: DEVMAP_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // ── tools ────────────────────────────────────────────────────────────────

  server.registerTool(
    "devmap_overview",
    {
      title: "Project overview",
      description:
        "Entry point for understanding the project: framework, stats, entry points, most critical files, "
        + "detected features, flows and route counts. Call this first.",
      annotations: readOnly
    },
    () => respond(async () => {
      const loaded = await provider.get();
      return {
        ...buildOverview(loaded.snapshot),
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_map",
    {
      title: "Dependency map",
      description:
        "Dependency map for the whole project (omit target), one feature (feature name) or one file (project-relative path): "
        + "what it imports, what imports it, and related files. Use it to find where to look before reading code.",
      inputSchema: {
        target: z.string().optional().describe("Feature name or project-relative file path. Omit for the project-wide map."),
        depth: z.number().int().min(1).max(6).optional().describe("Traversal depth for file/feature maps."),
        includeMermaid: z.boolean().optional().describe("Also return the Mermaid source (default false).")
      },
      annotations: readOnly
    },
    ({ target, depth, includeMermaid }) => respond(async () => {
      const loaded = await provider.get();
      const result = await withJsonOutput(() => runMap(target, { projectRoot, depth, write: false, loaded }));
      const markdown = truncateText(result.markdown);
      return {
        mode: result.mode,
        target: result.target,
        markdown: markdown.text,
        ...(includeMermaid ? { mermaid: truncateText(result.mermaid).text } : {}),
        truncated: markdown.truncated,
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_flow",
    {
      title: "Trace a flow",
      description:
        "Trace how a feature or API request works end to end (ordered steps with file paths). "
        + "Omit target to list the curated top flows. Static analysis only, no AI.",
      inputSchema: {
        target: z.string().optional().describe("Flow name (case-insensitive, partial match allowed)."),
        all: z.boolean().optional().describe("Include lower-confidence features and non-API routes.")
      },
      annotations: readOnly
    },
    ({ target, all }) => respond(async () => {
      const loaded = await provider.get();
      const result = await withJsonOutput(() => runFlow(
        target,
        { projectRoot, all, write: false, narrate: false, loaded },
        {}
      ));
      let truncated = false;
      const flows = result.flows.slice(0, MAX_FLOWS).map((flow) => {
        const markdown = truncateText(flow.markdown, 8_000);
        truncated ||= markdown.truncated;
        return { name: flow.name, type: flow.type, purpose: flow.purpose, markdown: markdown.text };
      });
      return {
        total: result.flows.length,
        truncated: truncated || result.flows.length > MAX_FLOWS,
        flows,
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_routes",
    {
      title: "List routes",
      description: "List detected page and API routes with their handler file and HTTP methods. Filter by kind, path prefix or method.",
      inputSchema: {
        kind: z.enum(["page", "api", "all"]).optional().describe("Route kind (default all)."),
        prefix: z.string().optional().describe("Only routes whose path starts with this, e.g. /api/users."),
        method: z.string().optional().describe("HTTP method, e.g. POST."),
        limit: z.number().int().min(1).max(100).optional().describe("Max routes to return (default 50).")
      },
      annotations: readOnly
    },
    (input) => respond(async () => {
      const loaded = await provider.get();
      return {
        ...queryRoutes(loaded.snapshot, input),
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_impact",
    {
      title: "Change impact",
      description:
        "What is affected if a file changes: direct and transitive dependents (follow imports up to `depth` hops), "
        + "affected features, critical dependents, areas likely impacted, and what it imports. "
        + "Call this before editing a shared file.",
      inputSchema: {
        file: z.string().describe("Project-relative file path (a unique path suffix also works)."),
        depth: z.number().int().min(1).max(5).optional().describe("Import hops to follow for dependents (default 1)."),
        limit: z.number().int().min(1).max(100).optional().describe("Max entries per list (default 50).")
      },
      annotations: readOnly
    },
    ({ file, depth, limit }) => respond(async () => {
      const loaded = await provider.get();
      return {
        ...queryImpact(loaded.snapshot, file, { depth, limit }),
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_find",
    {
      title: "Find code",
      description:
        "Locate features, files and routes by keyword using DevMap's index (paths, exported symbols, function names, search terms, purposes). "
        + "Faster and more precise than grepping the whole repo for a concept.",
      inputSchema: {
        query: z.string().describe("One or more keywords, e.g. \"auth login\" or \"InvoiceService\"."),
        limit: z.number().int().min(1).max(100).optional().describe("Max hits to return (default 15).")
      },
      annotations: readOnly
    },
    ({ query, limit }) => respond(async () => {
      const loaded = await provider.get();
      return {
        ...queryFind(loaded.snapshot, query, limit),
        snapshot: snapshotMeta(loaded)
      };
    })
  );

  server.registerTool(
    "devmap_analyze",
    {
      title: "Refresh the project map",
      description:
        "Re-analyze the project and refresh the DevMap snapshot (writes only inside .devmap/). Call it when a result "
        + "reports snapshot.stale = true, or when no snapshot exists. Returns status \"unchanged\" without re-analyzing if no "
        + "file changed (pass fresh: true to force a full rebuild). "
        + (options.allowAi
          ? "AI enrichment is enabled for this server, so the configured AI provider may be used."
          : "Static analysis only: no AI is used, so AI-derived data (domain, architecture) is not regenerated and aiDataDropped is reported when it is lost. ")
        + "If it takes longer than timeoutSeconds it keeps running in the background and status is \"running\"; call again to wait for it.",
      inputSchema: {
        fresh: z.boolean().optional().describe("Ignore the cache and rebuild from scratch."),
        timeoutSeconds: z.number().int().min(1).max(600).optional()
          .describe(`How long to wait for the analysis (default ${DEFAULT_ANALYZE_TIMEOUT_SECONDS}).`)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: options.allowAi === true
      }
    },
    async ({ fresh, timeoutSeconds }, extra) => {
      const started = Date.now();
      const progressToken = extra._meta?.progressToken;
      let tick = 0;
      let heartbeat: NodeJS.Timeout | undefined;

      // Progress notifications keep clients from timing out on long analyses.
      if (progressToken !== undefined) {
        heartbeat = setInterval(() => {
          tick += 1;
          void extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: tick,
              message: `Analyzing project… ${Math.round((Date.now() - started) / 1000)}s elapsed`
            }
          }).catch(() => undefined);
        }, heartbeatMs);
        heartbeat.unref();
      }

      try {
        const run = refresher.run({ fresh: fresh === true });
        // Drop cached state whenever the analysis ends, even if we stopped waiting for it.
        run.then(() => provider.invalidate(), () => undefined);

        const waited = await waitFor(run, (timeoutSeconds ?? DEFAULT_ANALYZE_TIMEOUT_SECONDS) * 1000);
        if (waited.timedOut) {
          return ok({
            status: "running",
            elapsedSeconds: Math.round((Date.now() - started) / 1000),
            hint: "The analysis is still running in the background. Call devmap_analyze again to wait for it; other tools use the previous snapshot until it finishes."
          });
        }

        const outcome = waited.value;
        return ok({
          ...outcome,
          ...(outcome.aiDataDropped
            ? {
              note: "The previous snapshot had AI-derived data (domain/architecture) that static analysis cannot regenerate. Run `devmap analyze` in a terminal, or start the server with --allow-ai, to restore it."
            }
            : {})
        });
      } catch (error) {
        return fail(error);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    }
  );

  if (options.allowAi) {
    server.registerTool(
      "devmap_explain",
      {
        title: "Explain code with AI",
        description:
          "Ask the user's configured AI provider to explain what a file, feature or top-level function does, "
          + "using DevMap's index to pick the relevant code. Prefer devmap_map, devmap_flow and devmap_impact for structure; "
          + "use this for \"what does this do and why\". "
          + EXPLAIN_NOTE
          + " Requires a provider configured with `devmap init`. Spends the user's AI quota.",
        inputSchema: {
          target: z.string().min(1).describe("A project-relative file path, a feature name, or a top-level function name.")
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true
        }
      },
      ({ target }) => respond(async () => {
        const loaded = await provider.get();
        const result = await withJsonOutput(() => runExplain(
          target,
          { projectRoot, json: true, write: false, loaded },
          options.explainDependencies ?? {}
        ));
        const answer = truncateText(result.answer);
        return {
          mode: result.mode,
          target: result.target,
          ...(result.resolvedFile ? { resolvedFile: result.resolvedFile } : {}),
          answer: answer.text,
          truncated: answer.truncated,
          model: result.model,
          contextFiles: result.contextFiles,
          snapshot: snapshotMeta(loaded)
        };
      })
    );
  }

  // ── resources ────────────────────────────────────────────────────────────

  server.registerResource(
    "devmap-snapshot",
    "devmap://snapshot",
    {
      title: "DevMap snapshot",
      description: "Full analysis snapshot (.devmap/snapshot.json). Can be large; prefer the tools for targeted questions.",
      mimeType: "application/json"
    },
    async (uri) => {
      const { snapshot } = await provider.get();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(snapshot) }] };
    }
  );

  server.registerResource(
    "devmap-md",
    "devmap://devmap-md",
    {
      title: "DEVMAP.md",
      description: "The project's DEVMAP.md context file.",
      mimeType: "text/markdown"
    },
    async (uri) => {
      try {
        const text = await readFile(join(projectRoot, "DEVMAP.md"), "utf8");
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
      } catch {
        throw new DevmapError("DEVMAP.md was not found in the project root.", "Run devmap init first.");
      }
    }
  );

  server.registerResource(
    "devmap-feature",
    new ResourceTemplate("devmap://feature/{id}", {
      list: async () => {
        const ids = await listFeatureIds(projectRoot);
        return {
          resources: ids.map((id) => ({
            uri: `devmap://feature/${id}`,
            name: id,
            mimeType: "application/json"
          }))
        };
      }
    }),
    {
      title: "Feature map",
      description: "Per-feature navigation data from .devmap/features/<id>.json.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const raw = variables.id;
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (typeof id !== "string" || !FEATURE_ID_PATTERN.test(id)) {
        throw new DevmapError(`"${String(id)}" is not a valid feature id.`, "Feature ids are lowercase letters, digits and dashes.");
      }
      try {
        const text = await readFile(join(projectRoot, ".devmap", "features", `${id}.json`), "utf8");
        return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
      } catch {
        throw new DevmapError(`Feature "${id}" was not found.`, "Run devmap analyze, then list resources to see feature ids.");
      }
    }
  );

  registerPrompts(server);

  return { server, provider, refresher };
}

const MAX_FLOWS = 20;

async function listFeatureIds(projectRoot: string): Promise<string[]> {
  try {
    const files = await readdir(join(projectRoot, ".devmap", "features"));
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .filter((id) => FEATURE_ID_PATTERN.test(id))
      .sort();
  } catch {
    return [];
  }
}
