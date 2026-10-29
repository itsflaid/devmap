import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { runFlow } from "../commands/flow.js";
import { runMap } from "../commands/map.js";
import { DevmapError } from "../utils/errors.js";
import { withJsonOutput } from "../utils/output.js";
import { DEVMAP_VERSION } from "../utils/packageMetadata.js";
import {
  buildOverview,
  queryFind,
  queryImpact,
  queryRoutes,
  type SnapshotMeta
} from "./queries.js";
import { createSnapshotProvider, type SnapshotProvider } from "./snapshotProvider.js";

export const MAX_TEXT_CHARS = 30_000;
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const SERVER_INSTRUCTIONS = [
  "DevMap gives you a precomputed map of this codebase (features, routes, flows, dependency graph).",
  "Start with devmap_overview, then drill into one feature with devmap_map or devmap_flow instead of reading many files.",
  "Call devmap_impact before changing a file, and devmap_find to locate code by keyword.",
  "Every result includes snapshot.stale; when it is true the code changed after the last analysis, so treat results as approximate and ask the user to run `devmap analyze --fresh`."
].join(" ");

export type DevmapServerOptions = {
  projectRoot: string;
  /** Inject a provider (tests); defaults to a cached provider for `projectRoot`. */
  provider?: SnapshotProvider;
};

export type DevmapServer = {
  server: McpServer;
  provider: SnapshotProvider;
};

export function truncateText(value: string, max = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, max)}\n\n… [truncated ${value.length - max} characters]`,
    truncated: true
  };
}

function snapshotMeta(generatedAt: string, stale: boolean): SnapshotMeta & { note?: string } {
  return {
    generatedAt,
    stale,
    ...(stale
      ? { note: "The code changed after this snapshot was generated. Results may be outdated; run `devmap analyze --fresh`." }
      : {})
  };
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
  const provider = options.provider ?? createSnapshotProvider(options.projectRoot);
  const projectRoot = provider.projectRoot;

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
      const { snapshot, stale } = await provider.get();
      return {
        ...buildOverview(snapshot),
        snapshot: snapshotMeta(snapshot.generatedAt, stale)
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
      const result = await withJsonOutput(() => runMap(target, { projectRoot, depth, write: false }));
      const markdown = truncateText(result.markdown);
      return {
        mode: result.mode,
        target: result.target,
        markdown: markdown.text,
        ...(includeMermaid ? { mermaid: truncateText(result.mermaid).text } : {}),
        truncated: markdown.truncated,
        snapshot: snapshotMeta(result.snapshot.generatedAt, result.snapshot.stale)
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
      const result = await withJsonOutput(() => runFlow(
        target,
        { projectRoot, all, write: false, narrate: false },
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
        snapshot: snapshotMeta(result.snapshot.generatedAt, result.snapshot.stale)
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
      const { snapshot, stale } = await provider.get();
      return {
        ...queryRoutes(snapshot, input),
        snapshot: snapshotMeta(snapshot.generatedAt, stale)
      };
    })
  );

  server.registerTool(
    "devmap_impact",
    {
      title: "Change impact",
      description:
        "What is affected if a file changes: files that import it, areas likely impacted, features it belongs to, and what it imports. "
        + "Call this before editing a shared file.",
      inputSchema: {
        file: z.string().describe("Project-relative file path (a unique path suffix also works)."),
        limit: z.number().int().min(1).max(100).optional().describe("Max entries per list (default 50).")
      },
      annotations: readOnly
    },
    ({ file, limit }) => respond(async () => {
      const { snapshot, stale } = await provider.get();
      return {
        ...queryImpact(snapshot, file, limit),
        snapshot: snapshotMeta(snapshot.generatedAt, stale)
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
      const { snapshot, stale } = await provider.get();
      return {
        ...queryFind(snapshot, query, limit),
        snapshot: snapshotMeta(snapshot.generatedAt, stale)
      };
    })
  );

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

  return { server, provider };
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
