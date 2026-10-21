import type { ScannedFile } from "../analysis/index.js";

// Helpers shared by the per-framework route detectors.

export function resolveRouterTarget(
  identifier: string,
  mountFile: string,
  eligibleFiles: ScannedFile[],
  byPath: Map<string, ScannedFile>,
  graph?: Record<string, string[]>,
  hasRouteMethods?: (file: ScannedFile) => boolean
): ScannedFile | undefined {
  if (!graph) {
    return undefined;
  }

  const candidates = (graph[mountFile] ?? [])
    .map((path) => byPath.get(path))
    .filter((file): file is ScannedFile => Boolean(file))
    .filter((file) => /\.[cm]?[jt]s$/.test(file.path));
  if (candidates.length === 0) {
    return undefined;
  }

  const identifierPattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`);
  const identifierMatches = candidates.filter((file) =>
    identifierPattern.test(file.content)
  );
  const withRouteMethods = hasRouteMethods
    ? candidates.filter(hasRouteMethods)
    : [];

  // Identifier match wins; fall back to "the only imported file that defines
  // route methods" — covers the common one-router-per-import case without
  // precise import parsing.
  const pool = identifierMatches.length > 0 ? identifierMatches : withRouteMethods;
  return pool.length === 1 ? pool[0] : undefined;
}

export function composeMountPath(prefix: string, subPath: string): string {
  if (subPath === "/" || subPath === "") {
    return prefix;
  }
  return `${prefix.replace(/\/$/, "")}/${subPath.replace(/^\//, "")}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HTTP_METHOD_NAMES = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function findHttpMethods(content: string): string[] {
  const methods = new Set<string>();
  const add = (name: string | undefined) => {
    if (name && HTTP_METHOD_NAMES.has(name)) methods.add(name);
  };

  // export async function GET() {} / export const POST = ...
  for (const match of content.matchAll(
    /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
  )) {
    add(match[1]);
  }

  // export { handler as GET, handler as POST }, export { GET } from "./handlers"
  for (const match of content.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const specifier of match[1].split(",")) {
      const exported = specifier.trim().split(/\s+as\s+/).pop()?.trim();
      add(exported);
    }
  }

  // export const { GET, POST } = handlers;  (Auth.js and similar)
  for (const match of content.matchAll(/export\s+const\s*\{([^}]*)\}\s*=/g)) {
    for (const element of match[1].split(",")) {
      const bound = element.trim().split(":").pop()?.trim().split("=")[0].trim();
      add(bound);
    }
  }

  return [...methods].sort();
}

export function sortRoutes<T extends { path: string; file: string }>(routes: T[]): T[] {
  return routes.sort((left, right) =>
    left.path.localeCompare(right.path) || left.file.localeCompare(right.file)
  );
}

/** Join URL fragments into one absolute path: `/a/` + `b` + `/` → `/a/b`. */
export function joinRoutePaths(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((segment) => segment !== "")
    .join("/");
  return `/${joined}`;
}

/**
 * Split a file-based route name into its segments. Both `.` (flat routes) and
 * `/` (folders) separate segments, except inside `[...]`, which escapes
 * characters literally: `sitemap[.]xml` is the single segment `sitemap.xml`.
 */
export function splitFlatRouteName(name: string): string[] {
  const segments: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of name) {
    if (char === "[" && !escaped) {
      escaped = true;
    } else if (char === "]" && escaped) {
      escaped = false;
    } else if ((char === "." || char === "/") && !escaped) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);

  return segments.filter((segment) => segment !== "");
}

const ROUTE_MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|mdx?)$/;

export function stripRouteModuleExtension(path: string): string {
  return path.replace(ROUTE_MODULE_EXTENSION, "");
}

/**
 * When a layout route has an index sibling at the same URL, the index is the
 * page people land on and the layout only wraps it, so list one route per URL.
 * `isLayout` marks the file that renders an `<Outlet />` for children.
 */
export function dropShadowedLayouts<T extends { path: string; isIndex: boolean; isLayout: boolean }>(
  entries: T[]
): T[] {
  const indexPaths = new Set(entries.filter((entry) => entry.isIndex).map((entry) => entry.path));
  return entries.filter((entry) => entry.isIndex || !entry.isLayout || !indexPaths.has(entry.path));
}
