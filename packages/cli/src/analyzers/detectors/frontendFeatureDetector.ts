import type { RouteInfo } from "./routeDetector.js";
import type { FileAnalysis, ScannedFile } from "../analysis/index.js";
import type { FileGraph } from "../graph/dependencyGraph.js";
import { buildReverseGraph } from "../graph/index.js";
import { singularize } from "../analysis/extractors/fallbackExtractor.js";
import type { FeatureInfo } from "../features/featureDetector.js";
import { isDynamicSegment } from "./nonResourceSegments.js";
import { compareText } from "../../utils/compare.js";

/** Map key for the page served at "/". */
const ROOT_SEGMENT = "";

export const HOME_FEATURE_NAME = "Home";

// Infrastructure or too-generic top-level segments. Kept short on purpose: unlike the wider
// NON_RESOURCE_SEGMENTS used for API-derived entities, "settings" or "profile" are real pages.
const NON_FEATURE_PAGE_SEGMENTS = new Set([
  "auth", "oauth", "callback",
  "api", "static", "assets", "public",
]);

/**
 * A barrel file only re-exports: it declares no symbols, and most of its non-comment lines are
 * `export * from` / `export { ... } from`. A file that also defines local values has its own
 * logic and takes part in ownership normally.
 */
function isPureBarrelFile(
  analysis: FileAnalysis | undefined,
  content: string
): boolean {
  if (!analysis) return false;
  if (analysis.symbols.length > 0) return false;
  if (analysis.imports.length === 0) return false;

  const lines = content.split("\n");
  const meaningful = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
  });
  if (meaningful.length === 0) return false;

  const reExportCount = meaningful.filter((line) =>
    /^\s*export\s+(\*\s+from|{[^}]*}\s+from)/.test(line)
  ).length;

  return reExportCount / meaningful.length > 0.5;
}

/**
 * Turns Next.js App/Pages Router page routes into features, independent of database entities.
 *
 * Entity-derived features run as a fallback chain that stops at the first non-empty source, so a
 * project with a single Prisma model (e.g. a NextAuth Session table) never reached the
 * route-hint fallback and page-only features with no database presence were lost. This runs
 * unconditionally and is merged with the other sources.
 */
export function detectFrontendPageFeatures(
  routes: RouteInfo[],
  fileGraph: FileGraph,
  analyses: Record<string, FileAnalysis>,
  files: ScannedFile[]
): FeatureInfo[] {
  const pageRoutes = routes.filter((route) => route.kind === "page");
  if (pageRoutes.length === 0) return [];

  const routesBySegment = groupBySegment(pageRoutes);
  const reverseGraph = buildReverseGraph(fileGraph);

  const barrelFiles = new Set(
    files
      .filter((f) => isPureBarrelFile(analyses[f.path], f.content))
      .map((f) => f.path)
  );

  const pages = [...routesBySegment].map(([segment, segmentRoutes]) => {
    const seedFiles = byShallowPath([...new Set(segmentRoutes.map((route) => route.file))]);
    return {
      segment,
      segmentRoutes,
      seedFiles,
      ownedFiles: collectOwnedFiles(seedFiles, fileGraph, reverseGraph, barrelFiles)
    };
  });
  dropSharedFiles(pages);

  const features: FeatureInfo[] = [];
  for (const { segment, segmentRoutes, seedFiles, ownedFiles } of pages) {
    const isRoot = segment === ROOT_SEGMENT;
    const name = isRoot ? HOME_FEATURE_NAME : pageFeatureName(segment);

    features.push({
      name,
      purpose: isRoot
        ? "Frontend landing page served at the site root."
        : `Frontend page${segmentRoutes.length > 1 ? "s" : ""} under "${segment}".`,
      files: ownedFiles,
      entryPoint: seedFiles[0],
      entryPoints: seedFiles.slice(0, 2),
      businessFlow: [],
      searchTerms: [...new Set([segment.toLowerCase(), name.toLowerCase()].filter(Boolean))],
      confidence: "medium",
      evidence: ownedFiles
    });
  }

  return features;
}

function groupBySegment(pageRoutes: RouteInfo[]): Map<string, RouteInfo[]> {
  const bySegment = new Map<string, RouteInfo[]>();

  for (const route of pageRoutes) {
    const segments = route.path.split("/").filter(Boolean);
    const topSegment = segments[0];

    if (!topSegment) {
      // The root page is the "Home" feature; it has no segment to name it after.
      const home = bySegment.get(ROOT_SEGMENT) ?? [];
      home.push(route);
      bySegment.set(ROOT_SEGMENT, home);
      continue;
    }
    if (isDynamicSegment(topSegment)) continue; // dynamic-only, e.g. /[locale]
    if (NON_FEATURE_PAGE_SEGMENTS.has(topSegment.toLowerCase())) continue;

    const list = bySegment.get(topSegment) ?? [];
    list.push(route);
    bySegment.set(topSegment, list);
  }

  return bySegment;
}

// Regex pairing of a path with a component reference: JSX `<Route path element={<Foo />}>` /
// `component={Foo}` and object configs `{ path, element: <Foo /> }` / `{ path, Component: Foo }`.
// Common conventions, not a parser; `path` must come before the component (reversed order is missed).
const CLIENT_ROUTE_PATTERNS = [
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?element=\{<(\w+)/g,
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?component=\{?(\w+)/g,
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?element:\s*<(\w+)/g,
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?Component:\s*(\w+)/g,
  // Vue Router, identifier form.
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*(\w+)\s*[,}]/g,
];

// Vue Router lazy form `component: () => import("./views/About.vue")`: captures the specifier
// rather than an identifier, so it resolves through resolveRouteSpecifierFile.
const LAZY_ROUTE_PATTERN =
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*\(\)\s*=>\s*import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

// svelte-spa-router object map `const routes = { '/about': About }`. Any "string: identifier"
// object would match, so it only runs on files that import svelte-spa-router.
const SVELTE_SPA_ROUTER_PATTERN = /["'`](\/[^"'`]*)["'`]\s*:\s*(\w+)/g;
const SVELTE_SPA_ROUTER_IMPORT =
  /from\s+["']svelte-spa-router["']|require\(\s*["']svelte-spa-router["']\s*\)/;

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

    if (SVELTE_SPA_ROUTER_IMPORT.test(file.content)) {
      SVELTE_SPA_ROUTER_PATTERN.lastIndex = 0;
      let svelteMatch = SVELTE_SPA_ROUTER_PATTERN.exec(file.content);
      while (svelteMatch) {
        routes.push({ path: svelteMatch[1], component: svelteMatch[2], definedIn: file.path });
        svelteMatch = SVELTE_SPA_ROUTER_PATTERN.exec(file.content);
      }
    }
  }

  return routes;
}

/** A route names a component ("QuranPage"), not a file; match it against the defining file's graph imports by file stem. */
function resolveRouteComponentFile(route: ClientRoute, fileGraph: FileGraph): string | undefined {
  const imported = fileGraph[route.definedIn] ?? [];
  const target = route.component.toLowerCase();

  return imported.find((file) => {
    const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^/.]+$/, "");
    return stem.toLowerCase() === target;
  });
}

/** Resolves a lazy-import specifier against the defining file's folder and the scanned file list, with or without an extension. */
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
 * Same output as `detectFrontendPageFeatures` for SPAs without file-based routing (Vite + React
 * Router): paths come from route definitions, ownership uses the same reverse-graph rule.
 */
export function detectClientRouteFeatures(
  files: ScannedFile[],
  fileGraph: FileGraph,
  analyses: Record<string, FileAnalysis>
): FeatureInfo[] {
  const routes = findClientRoutes(files);
  if (routes.length === 0) return [];

  const bySegment = new Map<string, string[]>();
  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean);
    const topSegment = segments[0];
    if (!topSegment || isDynamicSegment(topSegment)) continue;
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

  const barrelFiles = new Set(
    files
      .filter((f) => isPureBarrelFile(analyses[f.path], f.content))
      .map((f) => f.path)
  );

  const pages = [...bySegment]
    .filter(([, seedFiles]) => seedFiles.length > 0)
    .map(([segment, seedFiles]) => ({
      segment,
      seedFiles,
      ownedFiles: collectOwnedFiles(seedFiles, fileGraph, reverseGraph, barrelFiles)
    }));
  dropSharedFiles(pages);

  const features: FeatureInfo[] = [];

  for (const { segment, seedFiles, ownedFiles } of pages) {
    const name = pageFeatureName(segment);

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

/** The page closest to the segment root first: `room/[id]/page.tsx` before `room/[id]/info/page.tsx`. */
function byShallowPath(files: string[]): string[] {
  return [...files].sort((left, right) =>
    left.split("/").length - right.split("/").length || compareText(left, right)
  );
}

/**
 * A file reachable from two pages belongs to neither: with auto-imported or app-wide components
 * every page reaches the same tree, and the first page would otherwise own all of it. A page keeps its seed files.
 */
function dropSharedFiles(pages: Array<{ seedFiles: string[]; ownedFiles: string[] }>): void {
  const claims = new Map<string, number>();
  for (const page of pages) {
    for (const file of page.ownedFiles) claims.set(file, (claims.get(file) ?? 0) + 1);
  }
  for (const page of pages) {
    const seeds = new Set(page.seedFiles);
    page.ownedFiles = page.ownedFiles.filter((file) => seeds.has(file) || claims.get(file) === 1);
  }
}

/** `scheduled-posts` → "Scheduled Post", `domain_blocks` → "Domain Block", `settings` → "Settings". */
export function pageFeatureName(segment: string): string {
  const words = segment.split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return segment;
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Seed files plus every reachable file whose referrers all lie inside the reachable set. A file
 * also imported from elsewhere is shared and stays out: a feature that looks too small is
 * better than one that claims files it does not own.
 */
function collectOwnedFiles(
  seedFiles: string[],
  graph: FileGraph,
  reverseGraph: FileGraph,
  barrelFiles: Set<string>
): string[] {
  const reachable = new Set<string>(seedFiles);
  const queue = [...seedFiles];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (barrelFiles.has(current)) continue; // a barrel's re-exports are not followed: they would pull in files this page does not own
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
