import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import type { RouteInfo } from "./routeDetector.js";
import {
  dropShadowedLayouts,
  sortRoutes,
  splitFlatRouteName,
  stripRouteModuleExtension
} from "./routeUtils.js";

/**
 * Remix (v2 flat routes, v1 folders, remix-flat-routes `+` folders) and React
 * Router v7's `flatRoutes()` share one file-name convention:
 *
 *   notes.$noteId.tsx   → /notes/:noteId
 *   notes._index.tsx    → /notes            (index route)
 *   _auth.login.tsx     → /login            (`_auth` is a pathless layout)
 *   posts_.$id.tsx      → /posts/:id        (trailing `_` escapes the nesting)
 *   ($lang).about.tsx   → /:lang?/about     (optional segment)
 *   files.$.tsx         → /files/*          (splat)
 *   sitemap[.]xml.tsx   → /sitemap.xml      (`[ ]` escapes)
 *
 * A route module without a default export is a resource route (`api`): it only
 * answers `loader` (GET) and `action` (POST and friends).
 */

export type RouteModule = {
  kind: RouteInfo["kind"];
  methods?: string[];
  rendersOutlet: boolean;
};

const ROUTE_EXPORTS =
  "loader|action|clientLoader|clientAction|meta|links|handle|headers|shouldRevalidate|ErrorBoundary|HydrateFallback|Layout";

const DEFAULT_EXPORT = /export\s+default\b|export\s*\{[^}]*\bas\s+default\b/;
const NAMED_ROUTE_EXPORT = new RegExp(
  `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+(?:${ROUTE_EXPORTS})\\b`
  + `|export\\s*\\{[^}]*\\b(?:${ROUTE_EXPORTS})\\b`
);

/** `undefined` when the file exports nothing a router would load. */
export function readRouteModule(file: ScannedFile): RouteModule | undefined {
  const isMarkdown = /\.mdx?$/.test(file.path);
  const hasDefault = isMarkdown || DEFAULT_EXPORT.test(file.content);
  if (!hasDefault && !NAMED_ROUTE_EXPORT.test(file.content)) return undefined;

  const rendersOutlet = /\bOutlet\b/.test(file.content);
  if (hasDefault) return { kind: "page", rendersOutlet };

  const methods = new Set<string>();
  if (/export\s+(?:async\s+)?(?:function|const|let|var)\s+(?:loader|clientLoader)\b|export\s*\{[^}]*\b(?:loader|clientLoader)\b/.test(file.content)) {
    methods.add("GET");
  }
  if (/export\s+(?:async\s+)?(?:function|const|let|var)\s+(?:action|clientAction)\b|export\s*\{[^}]*\b(?:action|clientAction)\b/.test(file.content)) {
    methods.add("POST");
  }
  return { kind: "api", ...(methods.size > 0 ? { methods: [...methods].sort() } : {}), rendersOutlet };
}

export type FlatRoutePath = {
  path: string;
  isIndex: boolean;
};

/**
 * URL for a route file, given its path inside the routes folder. `undefined`
 * for a pathless layout, which has no URL of its own.
 */
export function flatRoutePath(relative: string): FlatRoutePath | undefined {
  const parts = stripRouteModuleExtension(relative).split("/");

  // notes.$id/route.tsx, notes.$id/index.tsx and notes/index.tsx: the folder is the route.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && (last === "route" || last === "index")) parts.pop();

  // remix-flat-routes: `users+/` folders only group their files.
  const names = parts.map((part) => part.replace(/\+$/, ""));
  const segments = splitFlatRouteName(names.join("/"));

  const url: string[] = [];
  let isIndex = false;

  segments.forEach((segment, position) => {
    const isLast = position === segments.length - 1;

    if (isLast && (segment === "_index" || segment === "index")) {
      isIndex = true;
      return;
    }
    // Pathless layout: `_auth`, `__auth`.
    if (segment.startsWith("_")) return;

    const name = segment.length > 1 && segment.endsWith("_") ? segment.slice(0, -1) : segment;
    url.push(toUrlSegment(name));
  });

  if (url.length === 0 && !isIndex) return undefined;
  return { path: `/${url.join("/")}`, isIndex };
}

function toUrlSegment(segment: string): string {
  const optional = /^\((.+)\)$/.exec(segment);
  if (optional) {
    const inner = optional[1];
    return inner.startsWith("$") ? `:${inner.slice(1)}?` : `${inner}?`;
  }
  if (segment === "$") return "*";
  if (segment.startsWith("$")) return `:${segment.slice(1)}`;
  return segment;
}

type FlatEntry = RouteInfo & { isIndex: boolean; isLayout: boolean };

/** Routes for every module under `routesDir` (a path prefix ending in `/`). */
export function detectFlatFileRoutes(files: ScannedFile[], routesDir: string): RouteInfo[] {
  const entries: FlatEntry[] = [];

  for (const file of files) {
    if (!file.path.startsWith(routesDir) || !isArchitectureSource(file.path)) continue;
    if (!/\.(?:[cm]?[jt]sx?|mdx?)$/.test(file.path) || file.path.endsWith(".d.ts")) continue;

    const route = flatRoutePath(file.path.slice(routesDir.length));
    const module = route ? readRouteModule(file) : undefined;
    if (!route || !module) continue;

    entries.push({
      path: route.path,
      file: file.path,
      kind: module.kind,
      ...(module.methods ? { methods: module.methods } : {}),
      isIndex: route.isIndex,
      isLayout: module.rendersOutlet
    });
  }

  return dropShadowedLayouts(entries).map((entry) => ({
    path: entry.path,
    file: entry.file,
    kind: entry.kind,
    ...(entry.methods ? { methods: entry.methods } : {})
  }));
}

/**
 * `confirmed` means the project's framework is known to be Remix. Without it
 * (a monorepo whose other apps won the framework slot) a `routes/` folder only
 * counts when a package.json above it depends on Remix.
 */
export function detectRemixRoutes(files: ScannedFile[], confirmed = true): RouteInfo[] {
  const routesDirs = new Set<string>();
  const remixRoots = confirmed ? undefined : remixPackageDirs(files);

  for (const file of files) {
    const match = /^(.*?(?:^|\/)app\/routes\/)/.exec(file.path);
    if (!match) continue;
    if (remixRoots && !isBelowAny(match[1], remixRoots)) continue;
    routesDirs.add(match[1]);
  }

  return sortRoutes([...routesDirs].flatMap((dir) => detectFlatFileRoutes(files, dir)));
}

/** Folders (`""` for the root) whose package.json depends on `@remix-run/*`, except its router. */
function remixPackageDirs(files: ScannedFile[]): string[] {
  return files
    .filter((file) =>
      /(^|\/)package\.json$/.test(file.path) && /"@remix-run\/(?!router")/.test(file.content)
    )
    .map((file) => (file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : ""));
}

function isBelowAny(path: string, directories: string[]): boolean {
  return directories.some((directory) => path.startsWith(directory));
}
