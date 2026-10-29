import type { ProjectMap } from "../analyzers/pipeline/index.js";
import type { RouteInfo } from "../analyzers/detectors/routeDetector.js";
import { DevmapError } from "../utils/errors.js";

/**
 * Pure, read-only queries over a ProjectMap snapshot. No I/O, no printing,
 * so they are cheap to test and safe to call from any front-end.
 */

export type SnapshotMeta = { generatedAt: string; stale: boolean };

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export function clampLimit(limit: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

// ── overview ────────────────────────────────────────────────────────────────

export type OverviewResult = {
  project: ProjectMap["project"];
  stats: ProjectMap["stats"];
  entryPoints: string[];
  criticalFiles: Array<{ path: string; referencedBy: number; reasons: string[] }>;
  features: Array<{
    name: string;
    purpose: string;
    confidence: string;
    entryPoint?: string;
    fileCount: number;
  }>;
  flows: Array<{ name: string; type: string; purpose: string }>;
  routeCounts: { pages: number; api: number };
  database?: ProjectMap["database"];
  externalServices: string[];
  recommendedPath: string[];
  nextSteps: string[];
};

export function buildOverview(snapshot: ProjectMap, limit = 10): OverviewResult {
  return {
    project: snapshot.project,
    stats: snapshot.stats,
    entryPoints: snapshot.entryPoints.slice(0, limit),
    criticalFiles: snapshot.criticalFiles.slice(0, limit).map((file) => ({
      path: file.path,
      referencedBy: file.referencedBy,
      reasons: file.reasons
    })),
    features: snapshot.features.map((feature) => ({
      name: feature.name,
      purpose: feature.purpose,
      confidence: feature.confidence,
      ...(feature.entryPoint ? { entryPoint: feature.entryPoint } : {}),
      fileCount: feature.files.length
    })),
    flows: snapshot.flows.map((flow) => ({
      name: flow.name,
      type: flow.type,
      purpose: flow.purpose
    })),
    routeCounts: {
      pages: snapshot.routes.filter((route) => route.kind === "page").length,
      api: snapshot.routes.filter((route) => route.kind === "api").length
    },
    ...(snapshot.database ? { database: snapshot.database } : {}),
    externalServices: snapshot.externalServices,
    recommendedPath: snapshot.onboarding.recommendedPath,
    nextSteps: [
      "devmap_map with a feature name to see its files and dependencies",
      "devmap_flow with a flow name to trace it end to end",
      "devmap_impact with a file path before changing it",
      "devmap_find to locate files, features or routes by keyword"
    ]
  };
}

// ── routes ──────────────────────────────────────────────────────────────────

export type RoutesQuery = {
  kind?: "page" | "api" | "all";
  prefix?: string;
  method?: string;
  limit?: number;
};

export type RoutesResult = {
  total: number;
  returned: number;
  truncated: boolean;
  routes: RouteInfo[];
};

export function queryRoutes(snapshot: ProjectMap, query: RoutesQuery = {}): RoutesResult {
  const kind = query.kind ?? "all";
  const prefix = query.prefix?.trim();
  const method = query.method?.trim().toUpperCase();
  const limit = clampLimit(query.limit, 50);

  const matches = snapshot.routes.filter((route) => {
    if (kind !== "all" && route.kind !== kind) return false;
    if (prefix && !route.path.startsWith(prefix)) return false;
    if (method && !(route.methods ?? []).some((candidate) => candidate.toUpperCase() === method)) {
      return false;
    }
    return true;
  });

  return {
    total: matches.length,
    returned: Math.min(matches.length, limit),
    truncated: matches.length > limit,
    routes: matches.slice(0, limit)
  };
}

// ── impact ──────────────────────────────────────────────────────────────────

export function resolveProjectFile(snapshot: ProjectMap, input: string): string {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized === "") {
    throw new DevmapError("A file path is required.", "Pass a path relative to the project root.");
  }

  const paths = Object.keys(snapshot.fileIndex);
  if (snapshot.fileIndex[normalized]) return normalized;

  const lower = normalized.toLowerCase();
  const insensitive = paths.filter((path) => path.toLowerCase() === lower);
  if (insensitive.length === 1) return insensitive[0]!;

  const suffix = paths.filter((path) => path.toLowerCase().endsWith(`/${lower}`));
  if (suffix.length === 1) return suffix[0]!;
  if (suffix.length > 1) {
    throw new DevmapError(
      `"${input}" matches multiple files.`,
      `Be more specific — options: ${suffix.slice(0, 8).join(", ")}`
    );
  }

  const similar = paths
    .filter((path) => path.toLowerCase().includes(lower))
    .slice(0, 5);
  throw new DevmapError(
    `"${input}" isn't a file in the DevMap snapshot.`,
    similar.length > 0
      ? `Did you mean: ${similar.join(", ")}?`
      : "Use a path relative to the project root, or try devmap_find to locate it."
  );
}

export type ImpactResult = {
  file: string;
  purpose?: string;
  scope: string;
  features: string[];
  importance: number;
  /** Files/areas likely affected when this file changes. */
  impacts: string[];
  /** Files that import this file directly. */
  dependents: string[];
  /** Local files this file imports. */
  imports: string[];
  truncated: boolean;
};

export function queryImpact(snapshot: ProjectMap, input: string, limit?: number): ImpactResult {
  const file = resolveProjectFile(snapshot, input);
  const cap = clampLimit(limit, 50);
  const entry = snapshot.fileIndex[file]!;
  const impact = snapshot.changeImpact[file] ?? { impacts: [], dependents: [] };
  const imports = snapshot.fileGraph[file] ?? [];

  return {
    file,
    ...(entry.purpose ? { purpose: entry.purpose } : {}),
    scope: entry.scope,
    features: entry.featureRefs,
    importance: entry.importance,
    impacts: impact.impacts.slice(0, cap),
    dependents: impact.dependents.slice(0, cap),
    imports: imports.slice(0, cap),
    truncated:
      impact.impacts.length > cap || impact.dependents.length > cap || imports.length > cap
  };
}

// ── find ────────────────────────────────────────────────────────────────────

export type FindHit =
  | { type: "feature"; name: string; purpose: string; entryPoint?: string; score: number }
  | { type: "file"; path: string; purpose?: string; scope: string; score: number }
  | { type: "route"; path: string; file: string; kind: string; methods?: string[]; score: number };

export type FindResult = {
  query: string;
  total: number;
  truncated: boolean;
  hits: FindHit[];
};

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function scoreText(haystack: string | undefined, tokens: string[], weight: number): number {
  if (!haystack) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += weight;
  }
  return score;
}

export function queryFind(snapshot: ProjectMap, query: string, limit?: number): FindResult {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    throw new DevmapError("The search query is empty.", "Pass one or more keywords, e.g. \"auth login\".");
  }
  const cap = clampLimit(limit, 15);
  const hits: FindHit[] = [];

  for (const feature of snapshot.features) {
    const score =
      scoreText(feature.name, tokens, 5)
      + scoreText(feature.searchTerms.join(" "), tokens, 3)
      + scoreText(feature.purpose, tokens, 1);
    if (score > 0) {
      hits.push({
        type: "feature",
        name: feature.name,
        purpose: feature.purpose,
        ...(feature.entryPoint ? { entryPoint: feature.entryPoint } : {}),
        score: score + 2
      });
    }
  }

  for (const [path, entry] of Object.entries(snapshot.fileIndex)) {
    const score =
      scoreText(path, tokens, 3)
      + scoreText(entry.exportedSymbols.join(" "), tokens, 3)
      + scoreText(entry.topFunctions.map((fn) => fn.name).join(" "), tokens, 2)
      + scoreText(entry.searchTerms.join(" "), tokens, 2)
      + scoreText(entry.purpose, tokens, 1);
    if (score > 0) {
      hits.push({
        type: "file",
        path,
        ...(entry.purpose ? { purpose: entry.purpose } : {}),
        scope: entry.scope,
        // importance only breaks ties between otherwise equal matches
        score: score + Math.min(entry.importance, 10) / 100
      });
    }
  }

  for (const route of snapshot.routes) {
    const score = scoreText(route.path, tokens, 4) + scoreText(route.file, tokens, 1);
    if (score > 0) {
      hits.push({
        type: "route",
        path: route.path,
        file: route.file,
        kind: route.kind,
        ...(route.methods ? { methods: route.methods } : {}),
        score
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return {
    query,
    total: hits.length,
    truncated: hits.length > cap,
    hits: hits.slice(0, cap)
  };
}
