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
 * TanStack Router / TanStack Start file routes. Every route file declares its
 * own id, which the router plugin keeps in sync with the file name:
 *
 *   createFileRoute('/posts/$postId')     → /posts/$postId
 *   createFileRoute('/posts/')            → /posts            (index route)
 *   createFileRoute('/_auth/login')       → /login            (`_auth` is pathless)
 *   createFileRoute('/posts_/$postId')    → /posts/$postId    (trailing `_` un-nests)
 *   createFileRoute('/(shop)/cart')       → /cart             (`(group)` folders)
 *
 * Reading the id from the file avoids re-implementing every naming rule, and
 * the file name is only the fallback for a route the plugin has not filled in
 * yet. Params keep TanStack's own spelling (`$postId`).
 *
 * Start's server routes (`server: { handlers: { GET, POST } }`, or the older
 * `createServerFileRoute().methods({ ... })`) are listed as `api` routes.
 * Code-based routing (`createRoute({ getParentRoute })`) is not read.
 */

const FILE_ROUTE_CALL =
  /\b(createFileRoute|createLazyFileRoute|createServerFileRoute)\s*(?:<[^()]*>)?\s*\(\s*(?:(['"`])([^'"`]*)\2)?/;
const METHOD_KEY = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*[:(]/g;

type TanStackEntry = RouteInfo & { isIndex: boolean; isLayout: boolean; lazy: boolean };

export function detectTanStackRoutes(files: ScannedFile[]): RouteInfo[] {
  const entries: TanStackEntry[] = [];

  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path) || !isArchitectureSource(file.path)) continue;
    if (/\.gen\.[cm]?[jt]sx?$/.test(file.path)) continue;

    const location = /^(?:.*?\/)?routes\/(.+)$/.exec(file.path);
    if (!location || !file.content.includes("FileRoute")) continue;
    const call = FILE_ROUTE_CALL.exec(file.content);
    if (!call) continue;

    const id = call[3] || idFromFileName(location[1]);
    const route = idToRoute(id);
    if (!route) continue;

    const serverMethods = readServerMethods(file.content, call[1]);
    const hasComponent = /\bcomponent\s*:/.test(file.content) || call[1] === "createLazyFileRoute";
    const isApi = serverMethods.length > 0 && !hasComponent;

    entries.push({
      path: route.path,
      file: file.path,
      kind: isApi ? "api" : "page",
      ...(serverMethods.length > 0 ? { methods: serverMethods } : {}),
      isIndex: route.isIndex,
      isLayout: /\bOutlet\b/.test(file.content),
      lazy: call[1] === "createLazyFileRoute"
    });
  }

  return sortRoutes(preferLazyFiles(dropShadowedLayouts(entries)).map((entry) => ({
    path: entry.path,
    file: entry.file,
    kind: entry.kind,
    ...(entry.methods ? { methods: entry.methods } : {})
  })));
}

/** `posts.lazy.tsx` holds the component of the `posts.tsx` route: list the UI file once. */
function preferLazyFiles(entries: TanStackEntry[]): TanStackEntry[] {
  const lazyPaths = new Set(entries.filter((entry) => entry.lazy).map((entry) => entry.path));
  return entries.filter((entry) => entry.lazy || !lazyPaths.has(entry.path) || entry.kind === "api");
}

function readServerMethods(content: string, call: string): string[] {
  const isServerRoute = call === "createServerFileRoute"
    || /\bserver\s*:\s*\{/.test(content) && /\bhandlers\b/.test(content);
  if (!isServerRoute) return [];
  return [...new Set([...content.matchAll(METHOD_KEY)].map((match) => match[1]))].sort();
}

/** Route id the plugin would write for a file, used when the id is still empty. */
function idFromFileName(relative: string): string {
  const segments = splitFlatRouteName(stripRouteModuleExtension(relative))
    .filter((segment) => segment !== "lazy" && !segment.startsWith("-"));

  const last = segments[segments.length - 1];
  const isIndex = last === "index";
  if (isIndex || last === "route") segments.pop();

  return `/${segments.join("/")}${isIndex ? "/" : ""}`;
}

function idToRoute(id: string): { path: string; isIndex: boolean } | undefined {
  const isIndex = id === "/" || id.endsWith("/");
  const segments = id.split("/").filter(Boolean);
  const url: string[] = [];

  for (const [position, segment] of segments.entries()) {
    const isLast = position === segments.length - 1;
    // `_layout` is a pathless layout; `(group)` only organises files.
    if (segment.startsWith("_") || /^\(.*\)$/.test(segment)) {
      if (isLast && !isIndex && segment.startsWith("_")) return undefined;
      continue;
    }
    url.push(segment.length > 1 && segment.endsWith("_") ? segment.slice(0, -1) : segment);
  }

  if (url.length === 0 && !isIndex) return undefined;
  return { path: `/${url.join("/")}`, isIndex };
}
