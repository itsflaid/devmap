import type { ScannedFile } from "../analysis/index.js";
import type { DetectedFramework } from "./frameworkDetector.js";
import { isArchitectureSource } from "../graph/index.js";

export type RouteInfo = {
  path: string;
  file: string;
  kind: "page" | "api";
  methods?: string[];
};

/**
 * detectRoutes — run every detector whose framework was detected, then merge
 * the results. A project with a Next.js frontend AND an Express backend in a
 * single scan now yields routes from BOTH sides instead of first-match-wins.
 *
 * Each per-framework detector stays isolated (they already filter by their own
 * file patterns), so running several at once is safe — they don't collide
 * because they look at different files.
 *
 * `graph` (optional) lets the Express detector resolve routers mounted across
 * files so mount prefixes compose with the sub-paths they wrap.
 */
export function detectRoutes(
  files: ScannedFile[],
  frameworks: DetectedFramework[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  if (frameworks.includes("nextjs")) {
    routes.push(...detectNextRoutes(files));
  }

  if (frameworks.includes("astro")) {
    routes.push(...detectAstroRoutes(files));
  }

  if (frameworks.includes("nuxt")) {
    routes.push(...detectNuxtRoutes(files));
  }

  if (frameworks.includes("sveltekit")) {
    routes.push(...detectSvelteKitRoutes(files));
  }

  if (frameworks.includes("express")) {
    routes.push(...detectExpressRoutes(files, graph));
  }

  return sortRoutes(routes);
}

function detectNextRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    // App Router — match anywhere in path, not just root.
    // Supports: src/app/, app/, apps/web/src/app/, packages/web/src/app/, dll.
    // Sebelumnya pakai ^(?:src\/)? yang miss monorepo prefix seperti apps/web/.
    const appMatch = file.path.match(
      /(?:^|\/)(?:src\/)?app\/(.+\/)?(page|route)\.[jt]sx?$/
    );
    if (appMatch) {
      const segments = (appMatch[1] ?? "").split("/").filter(Boolean);
      const routePath = toRoutePath(segments);
      const kind = appMatch[2] === "route" ? "api" : "page";
      routes.push({
        path: routePath,
        file: file.path,
        kind,
        ...(kind === "api" ? { methods: findHttpMethods(file.content) } : {})
      });
      continue;
    }

    // Pages Router — sama, ganti ^ ke (?:^|\/) buat monorepo support.
    const pagesMatch = file.path.match(
      /(?:^|\/)(?:src\/)?pages\/(.+)\.[jt]sx?$/
    );
    if (!pagesMatch || pagesMatch[1].startsWith("_")) {
      continue;
    }

    const isApi = pagesMatch[1].startsWith("api/");
    const segments = pagesMatch[1].replace(/\/index$/, "").split("/").filter(Boolean);
    routes.push({
      path: toRoutePath(segments),
      file: file.path,
      kind: isApi ? "api" : "page"
    });
  }

  return sortRoutes(routes);
}

/**
 * detectAstroRoutes — pages live under src/pages/ (Astro always uses src/ as
 * its source root). Page files are .astro/.md/.mdx; endpoint files are
 * .ts/.js exporting GET/POST/etc., the same convention as Next.js route
 * handlers. Underscore-prefixed segments and content collections are not
 * routes and are skipped.
 */
function detectAstroRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    const match = file.path.match(
      /(?:^|\/)src\/pages\/(.+)\.(astro|md|mdx|[cm]?[jt]s)$/
    );
    if (!match) continue;

    const segments = match[1].split("/").filter(Boolean);
    if (segments.some((segment) => segment.startsWith("_"))) continue;

    const isApiFile = match[2] !== "astro" && match[2] !== "md" && match[2] !== "mdx";
    const cleanSegments = segments[segments.length - 1] === "index"
      ? segments.slice(0, -1)
      : segments;

    routes.push({
      path: toRoutePath(cleanSegments),
      file: file.path,
      kind: isApiFile ? "api" : "page",
      ...(isApiFile ? { methods: findHttpMethods(file.content) } : {})
    });
  }

  return sortRoutes(routes);
}

/**
 * detectNuxtRoutes — Nuxt uses root-level pages/** (not src/pages/ like Astro),
 * unless srcDir is customized in nuxt.config — a v1 limitation. Bracket syntax
 * for dynamic segments, [...slug] for catch-alls, and index-stripping mirror
 * Next.js Pages Router conventions.
 */
function detectNuxtRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    const match = file.path.match(/(?:^|\/)pages\/(.+)\.vue$/);
    if (!match) continue;

    const segments = match[1].split("/").filter(Boolean);
    const cleanSegments = segments[segments.length - 1] === "index"
      ? segments.slice(0, -1)
      : segments;

    routes.push({
      path: toRoutePath(cleanSegments),
      file: file.path,
      kind: "page"
    });
  }

  return sortRoutes(routes);
}

/**
 * detectSvelteKitRoutes — the route unit is a FOLDER under src/routes/, not a
 * file name. Only +page.svelte (page) and +server.[jt]s (api) are routes; the
 * "+" prefix is SvelteKit-only, so the escaped literals below are safe. Route
 * groups "(group)" are stripped by toRoutePath.
 */
function detectSvelteKitRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    const relativeMatch = file.path.match(/(?:^|\/)src\/routes\/(.*)$/);
    if (!relativeMatch) continue;
    const relative = relativeMatch[1];

    let kind: "page" | "api" | null = null;
    if (relative.endsWith("+page.svelte")) {
      kind = "page";
    } else if (/\+server\.[cm]?[jt]s$/.test(relative)) {
      kind = "api";
    }
    if (!kind) continue;

    const slashIndex = relative.lastIndexOf("/");
    const folder = slashIndex === -1 ? "" : relative.slice(0, slashIndex);
    const segments = folder === "" ? [] : folder.split("/");

    routes.push({
      path: toRoutePath(segments),
      file: file.path,
      kind,
      ...(kind === "api" ? { methods: findHttpMethods(file.content) } : {})
    });
  }

  return sortRoutes(routes);
}

const ROUTE_METHOD_PATTERN =
  /\b(?:app|router)\.(get|post|put|patch|delete|options|head)\(\s*["'`]([^"'`]+)["'`]/gi;
// Routers are usually named after their resource (paymentsRouter, authApi),
// so a mounted target scan matches any identifier that ends in "Router" (or
// is exactly "app"/"router") before a route method. Narrow enough to skip
// HTTP-client calls like stripe.get() while catching mounted routers.
const MOUNTED_ROUTER_PATTERN =
  /\b(?:app|\w*[Rr]outer)\.(get|post|put|patch|delete|options|head)\(\s*["'`]([^"'`]+)["'`]/gi;
const MOUNT_PATTERN =
  /\b(?:app|router)\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w+)\s*\)/g;

type ExpressMount = { prefix: string; identifier: string; file: string };

function detectExpressRoutes(
  files: ScannedFile[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const eligibleFiles = files.filter((item) =>
    isArchitectureSource(item.path) && /\.[cm]?[jt]s$/.test(item.path)
  );
  const byPath = new Map(eligibleFiles.map((file) => [file.path, file]));

  // First pass: direct route methods per file, plus collect mounted routers.
  const directRoutes = new Map<string, RouteInfo[]>();
  const mounts: ExpressMount[] = [];

  for (const file of eligibleFiles) {
    const methodsByPath = collectRouteMethods(file.content);
    if (methodsByPath.length > 0) {
      directRoutes.set(file.path, methodsByPath.map(([path, methods]) => ({
        path,
        file: file.path,
        kind: "api" as const,
        methods
      })));
    }

    MOUNT_PATTERN.lastIndex = 0;
    let match = MOUNT_PATTERN.exec(file.content);
    while (match) {
      mounts.push({ prefix: match[1], identifier: match[2], file: file.path });
      match = MOUNT_PATTERN.exec(file.content);
    }
  }

  // Second pass: resolve mounted routers and compose prefix + sub-path.
  const mountedFiles = new Set<string>();
  for (const mount of mounts) {
    const target = resolveMountedRouter(mount, eligibleFiles, byPath, graph);
    const subRoutes = target
      ? collectRouteMethods(target.content, MOUNTED_ROUTER_PATTERN)
      : [];

    if (target && subRoutes.length > 0) {
      mountedFiles.add(target.path);
      for (const [subPath, methods] of subRoutes) {
        routes.push({
          path: composeMountPath(mount.prefix, subPath),
          file: mount.file,
          kind: "api",
          methods
        });
      }
    } else {
      // Unresolvable or empty router — keep the mount itself as a USE route so
      // the middleware prefix stays visible instead of silently disappearing.
      routes.push({
        path: mount.prefix,
        file: mount.file,
        kind: "api",
        methods: ["USE"]
      });
    }
  }

  // Emit standalone routes only for files that were not absorbed by a mount.
  for (const [path, fileRoutes] of directRoutes) {
    if (!mountedFiles.has(path)) {
      routes.push(...fileRoutes);
    }
  }

  return routes;
}

function collectRouteMethods(
  content: string,
  pattern: RegExp = ROUTE_METHOD_PATTERN
): Array<[string, string[]]> {
  const methodsByPath = new Map<string, Set<string>>();
  pattern.lastIndex = 0;

  let match = pattern.exec(content);
  while (match) {
    const method = match[1].toUpperCase();
    const path = match[2];
    const methods = methodsByPath.get(path) ?? new Set<string>();
    methods.add(method);
    methodsByPath.set(path, methods);
    match = pattern.exec(content);
  }

  return [...methodsByPath]
    .map(([path, methods]) => [path, [...methods].sort()] as [string, string[]])
    .sort(([left], [right]) => left.localeCompare(right));
}

function resolveMountedRouter(
  mount: ExpressMount,
  files: ScannedFile[],
  byPath: Map<string, ScannedFile>,
  graph?: Record<string, string[]>
): ScannedFile | undefined {
  if (!graph) {
    return undefined;
  }

  const candidates = (graph[mount.file] ?? [])
    .map((path) => byPath.get(path))
    .filter((file): file is ScannedFile => Boolean(file))
    .filter((file) => /\.[cm]?[jt]s$/.test(file.path));
  if (candidates.length === 0) {
    return undefined;
  }

  const identifierPattern = new RegExp(`\\b${escapeRegExp(mount.identifier)}\\b`);
  const identifierMatches = candidates.filter((file) =>
    identifierPattern.test(file.content)
  );
  const withRouteMethods = candidates.filter((file) =>
    collectRouteMethods(file.content, MOUNTED_ROUTER_PATTERN).length > 0
  );

  // Identifier match wins; fall back to "the only imported file that defines
  // route methods" — covers the common one-router-per-import case without
  // precise import parsing.
  const pool = identifierMatches.length > 0 ? identifierMatches : withRouteMethods;
  return pool.length === 1 ? pool[0] : undefined;
}

function composeMountPath(prefix: string, subPath: string): string {
  if (subPath === "/" || subPath === "") {
    return prefix;
  }
  return `${prefix.replace(/\/$/, "")}/${subPath.replace(/^\//, "")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRoutePath(segments: string[]): string {
  const visible = segments.filter(
    (segment) => !segment.startsWith("(") && !segment.startsWith("@")
  );
  return `/${visible.join("/")}`.replace(/\/+/g, "/");
}

function findHttpMethods(content: string): string[] {
  const methods = new Set<string>();
  const pattern = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  let match = pattern.exec(content);

  while (match) {
    methods.add(match[1]);
    match = pattern.exec(content);
  }

  return [...methods].sort();
}

function sortRoutes(routes: RouteInfo[]): RouteInfo[] {
  return routes.sort((left, right) =>
    left.path.localeCompare(right.path) || left.file.localeCompare(right.file)
  );
}
