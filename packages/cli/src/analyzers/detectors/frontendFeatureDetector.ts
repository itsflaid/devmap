import type { RouteInfo } from "./routeDetector.js";
import type { ScannedFile } from "../analysis/index.js";
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

// ---------------------------------------------------------------------------
// React Router (client-side routing)
// ---------------------------------------------------------------------------

/**
 * Matches the common ways a path gets paired with a component reference in
 * React Router — JSX `<Route path="..." element={<Foo />} />` / `component={Foo}`,
 * and object/data-router configs `{ path: "...", element: <Foo /> }` /
 * `{ path: "...", Component: Foo }`. Not a JSX/AST parser — same "common
 * conventions, not full coverage" approach as the SQL table-name extraction.
 * Assumes `path` appears before the element/component reference, which is
 * the idiomatic order in real code; reversed ordering is a known v1 miss.
 */
const CLIENT_ROUTE_PATTERNS = [
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?element=\{<(\w+)/g,
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?component=\{?(\w+)/g,
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?element:\s*<(\w+)/g,
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?Component:\s*(\w+)/g,
  // Vue Router — identifier form (component already imported above).
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*(\w+)\s*[,}]/g,
];

// Vue Router — lazy import form: `component: () => import("./views/About.vue")`.
// Captures the relative specifier instead of an identifier, so it resolves
// through resolveRouteSpecifierFile rather than the identifier matcher.
const LAZY_ROUTE_PATTERN =
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*\(\)\s*=>\s*import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

type ClientRoute = {
  path: string;
  component: string;
  /** Relative import specifier for lazy imports (e.g. "./views/About.vue"). */
  specifier?: string;
  definedIn: string;
};

function findClientRoutes(files: ScannedFile[]): ClientRoute[] {
  const routes: ClientRoute[] = [];

  for (const file of files) {
    for (const pattern of CLIENT_ROUTE_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(file.content);
      while (match) {
        routes.push({ path: match[1], component: match[2], definedIn: file.path });
        match = pattern.exec(file.content);
      }
    }

    LAZY_ROUTE_PATTERN.lastIndex = 0;
    let match = LAZY_ROUTE_PATTERN.exec(file.content);
    while (match) {
      routes.push({ path: match[1], component: "", specifier: match[2], definedIn: file.path });
      match = LAZY_ROUTE_PATTERN.exec(file.content);
    }
  }

  return routes;
}

/**
 * A route only gives an identifier ("QuranPage"), not a file. Resolve it by
 * checking what the defining file actually imports — the dependency graph
 * already has that edge, so this is a lookup, not new import resolution.
 */
function resolveRouteComponentFile(route: ClientRoute, fileGraph: FileGraph): string | undefined {
  const imported = fileGraph[route.definedIn] ?? [];
  const target = route.component.toLowerCase();

  return imported.find((file) => {
    const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^/.]+$/, "");
    return stem.toLowerCase() === target;
  });
}

/**
 * Vue Router's lazy form captures a relative specifier ("./views/About.vue"),
 * not an identifier — the graph's resolved imports won't match it directly.
 * Resolve the specifier against the defining file's folder and match the
 * scanned file list, covering explicit .vue extensions and omitted ones.
 */
function resolveRouteSpecifierFile(route: ClientRoute, files: ScannedFile[]): string | undefined {
  const available = new Set(files.map((file) => file.path));
  const baseParts = route.definedIn.split("/");
  baseParts.pop();
  const normalized = normalizeRoutePath([...baseParts, route.specifier ?? ""].join("/"));
  const candidates = [
    normalized,
    `${normalized}.vue`,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}/index.vue`,
    `${normalized}/index.ts`,
    `${normalized}/index.js`
  ];

  return candidates.find((candidate) => available.has(candidate));
}

function normalizeRoutePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "." || part === "") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

/**
 * detectClientRouteFeatures — same purpose and output shape as
 * detectFrontendPageFeatures, for SPAs with no file-based routing (Vite +
 * React Router). Route paths come from parsing route definitions instead of
 * folder conventions; ownership uses the exact same reverse-graph rule.
 */
export function detectClientRouteFeatures(
  files: ScannedFile[],
  fileGraph: FileGraph
): FeatureInfo[] {
  const routes = findClientRoutes(files);
  if (routes.length === 0) return [];

  const bySegment = new Map<string, string[]>();
  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean);
    const topSegment = segments[0];
    if (!topSegment || topSegment.startsWith(":") || topSegment.startsWith("*")) continue;
    if (NON_FEATURE_PAGE_SEGMENTS.has(topSegment.toLowerCase())) continue;

    const resolvedFile = route.specifier
      ? resolveRouteSpecifierFile(route, files)
      : resolveRouteComponentFile(route, fileGraph);
    if (!resolvedFile) continue;

    const seeds = bySegment.get(topSegment) ?? [];
    if (!seeds.includes(resolvedFile)) seeds.push(resolvedFile);
    bySegment.set(topSegment, seeds);
  }

  const reverseGraph = buildReverseGraph(fileGraph);
  const features: FeatureInfo[] = [];

  for (const [segment, seedFiles] of bySegment) {
    if (seedFiles.length === 0) continue;
    const ownedFiles = collectOwnedFiles(seedFiles, fileGraph, reverseGraph);
    const name = singularize(segment);

    features.push({
      name,
      purpose: `Client-side route${seedFiles.length > 1 ? "s" : ""} under "${segment}".`,
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

/**
 * collectOwnedFiles — seed files plus every file reachable from them whose
 * *every* referrer is also within that reachable set. A component (or
 * store, or any other file) imported by this route/page and nothing else is
 * "owned"; a file also imported by a different page or feature is shared
 * and stays out — false-negative (feature looks smaller than it is) over
 * false-positive (feature claims a shared file it doesn't really own).
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
