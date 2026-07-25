import type { RouteInfo } from "./routeDetector.js";
import type { FileGraph } from "../graph/dependencyGraph.js";
import { buildReverseGraph } from "../graph/index.js";
import { singularize } from "../analysis/extractors/fallbackExtractor.js";
import type { FeatureInfo } from "../features/featureDetector.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Top-level page segments that aren't really a distinct product feature —
 * either infrastructure (auth callbacks) or too generic to name a feature
 * after on their own. Deliberately short: pages are usually meaningful
 * (unlike the wider NON_RESOURCE_SEGMENTS list used for API-derived CRUD
 * entities in capabilityDetector.ts) — "settings" or "profile" *are* real
 * pages users navigate to, so they stay in.
 */
const NON_FEATURE_PAGE_SEGMENTS = new Set([
  "auth", "oauth", "callback",
  "api", "static", "assets", "public",
]);

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * detectFrontendPageFeatures — turn Next.js App/Pages Router page routes into
 * features, independent of whether any database entity was found.
 *
 * Why this needs to be independent: entity-derived features (Prisma/SQL/
 * route-hint) only run as a fallback chain that stops at the first non-empty
 * source. A project with even one Prisma model (e.g. a NextAuth Session
 * table) never reaches route-hint fallback, so page-only features like
 * "Quran" or "Dzikir" — which have zero database presence — never surfaced
 * at all. This runs unconditionally and merges alongside whatever else was
 * found, so a mostly-frontend project doesn't get its features dominated by
 * whatever thin backend evidence happens to exist.
 */
export function detectFrontendPageFeatures(
  routes: RouteInfo[],
  fileGraph: FileGraph
): FeatureInfo[] {
  const pageRoutes = routes.filter((route) => route.kind === "page");
  if (pageRoutes.length === 0) return [];

  const routesBySegment = groupBySegment(pageRoutes);
  const reverseGraph = buildReverseGraph(fileGraph);

  const features: FeatureInfo[] = [];
  for (const [segment, segmentRoutes] of routesBySegment) {
    const seedFiles = [...new Set(segmentRoutes.map((route) => route.file))].sort();
    const ownedFiles = collectOwnedFiles(seedFiles, fileGraph, reverseGraph);
    const name = singularize(segment);

    features.push({
      name,
      purpose: `Frontend page${segmentRoutes.length > 1 ? "s" : ""} under "${segment}".`,
      files: ownedFiles,
      entryPoint: seedFiles[0],
      entryPoints: seedFiles.slice(0, 2),
      businessFlow: [],
      searchTerms: [...new Set([segment.toLowerCase(), name.toLowerCase()])],
      confidence: "medium",
      evidence: ownedFiles
    });
  }

  return features;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function groupBySegment(pageRoutes: RouteInfo[]): Map<string, RouteInfo[]> {
  const bySegment = new Map<string, RouteInfo[]>();

  for (const route of pageRoutes) {
    const segments = route.path.split("/").filter(Boolean);
    const topSegment = segments[0];

    if (!topSegment) continue; // root "/" — no distinct feature name to derive
    if (topSegment.startsWith("[")) continue; // dynamic-only, e.g. /[locale]
    if (NON_FEATURE_PAGE_SEGMENTS.has(topSegment.toLowerCase())) continue;

    const list = bySegment.get(topSegment) ?? [];
    list.push(route);
    bySegment.set(topSegment, list);
  }

  return bySegment;
}

/**
 * collectOwnedFiles — seed files plus every file reachable from them whose
 * *every* referrer is also within that reachable set. A component imported
 * by this page and nothing else is "owned"; a component also imported by a
 * different page or feature is shared and stays out — false-negative
 * (feature looks smaller than it is) over false-positive (feature claims a
 * shared file it doesn't really own).
 */
function collectOwnedFiles(
  seedFiles: string[],
  graph: FileGraph,
  reverseGraph: FileGraph
): string[] {
  const reachable = new Set<string>(seedFiles);
  const queue = [...seedFiles];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of graph[current] ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const seedSet = new Set(seedFiles);
  const owned = new Set<string>(seedFiles);

  for (const file of reachable) {
    if (seedSet.has(file)) continue;
    const referrers = reverseGraph[file] ?? [];
    const hasExternalReferrer = referrers.some((referrer) => !reachable.has(referrer));
    if (!hasExternalReferrer) {
      owned.add(file);
    }
  }

  return [...owned].sort();
}