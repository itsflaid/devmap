import { posix } from "node:path";
import type { ScannedFile } from "../analysis/index.js";
import { parseJsonText } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import type { RouteInfo } from "./routeDetector.js";
import { findHttpMethods, joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * Expo Router turns the `app/` folder (or `src/app/`) into screens:
 *
 *   app/index.tsx              → /
 *   app/(tabs)/explore.tsx     → /explore          (`(group)` folders add no URL)
 *   app/post/[id].tsx          → /post/[id]        (dynamic segment)
 *   app/[...missing].tsx       → /[...missing]     (catch-all)
 *   app/hello+api.ts           → /hello            (API route: `export function GET`)
 *   app/_layout.tsx, +html.tsx, +not-found.tsx     → wrappers, not screens
 *
 * Platform suffixes (`about.web.tsx`, `about.native.tsx`) are the same screen.
 */

const SCREEN_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const PLATFORM_SUFFIX = /\.(?:web|native|ios|android)$/;

export function detectExpoRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes = new Map<string, RouteInfo>();

  for (const root of findExpoAppDirs(files)) {
    for (const file of files) {
      if (!file.path.startsWith(root) || !isArchitectureSource(file.path)) continue;
      if (!SCREEN_EXTENSION.test(file.path) || file.path.endsWith(".d.ts")) continue;

      const route = screenRoute(file.path.slice(root.length));
      if (!route) continue;

      if (route.api) {
        const methods = findHttpMethods(file.content);
        add(routes, root, { path: route.path, file: file.path, kind: "api", ...(methods.length > 0 ? { methods } : {}) });
      } else if (/\bexport\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(file.content)) {
        add(routes, root, { path: route.path, file: file.path, kind: "page" });
      }
    }
  }

  return sortRoutes([...routes.values()]);
}

/** Keep the first file for a URL: `about.tsx` before `about.web.tsx`. */
function add(routes: Map<string, RouteInfo>, root: string, route: RouteInfo): void {
  const key = `${root}\0${route.kind}:${route.path}`;
  const existing = routes.get(key);
  if (!existing || route.file.length < existing.file.length) routes.set(key, route);
}

type ScreenRoute = { path: string; api: boolean };

function screenRoute(relative: string): ScreenRoute | undefined {
  let name = relative.replace(SCREEN_EXTENSION, "");
  let api = false;

  if (name.endsWith("+api")) {
    api = true;
    name = name.slice(0, -"+api".length);
  }
  name = name.replace(PLATFORM_SUFFIX, "");

  const segments = name.split("/");
  const last = segments[segments.length - 1];

  // `_layout`, `+html`, `+not-found`, `+native-intent`, `+middleware`.
  if (last.startsWith("_layout") || (last.startsWith("+") && !api)) return undefined;

  if (last === "index") segments.pop();

  const url = segments.filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return { path: joinRoutePaths(...url), api };
}

/** `app/` folders of every project that has Expo Router installed. */
function findExpoAppDirs(files: ScannedFile[]): string[] {
  // One entry per project folder: package.json and app.json both name
  // expo-router, but only app.json can say where the screens live.
  const projects = new Map<string, string | undefined>();

  for (const file of files) {
    const isManifest = /(^|\/)package\.json$/.test(file.path);
    const isAppConfig = /(^|\/)app(?:\.config\.[cm]?[jt]s|\.json)$/.test(file.path);
    if (!isManifest && !isAppConfig) continue;
    if (!file.content.includes("expo-router") || !isArchitectureSource(file.path)) continue;

    const projectDir = posix.dirname(file.path) === "." ? "" : `${posix.dirname(file.path)}/`;
    const custom = isAppConfig ? readCustomRoot(file) : undefined;
    projects.set(projectDir, custom ?? projects.get(projectDir));
  }

  const dirs = new Set<string>();
  for (const [projectDir, custom] of projects) {
    const candidates = [
      ...(custom ? [`${projectDir}${custom}/`] : []),
      `${projectDir}src/app/`,
      `${projectDir}app/`
    ];
    const found = candidates.find((candidate) => files.some((item) => item.path.startsWith(candidate)));
    if (found) dirs.add(found);
  }

  return [...dirs];
}

/** `["expo-router", { "root": "src/app" }]` in app.json. */
function readCustomRoot(file: ScannedFile): string | undefined {
  if (!file.path.endsWith(".json")) {
    const match = /expo-router["'`]\s*,\s*\{[^}]*\broot\s*:\s*["'`]([^"'`]+)["'`]/s.exec(file.content);
    return match ? cleanRoot(match[1]) : undefined;
  }

  try {
    const parsed = parseJsonText(file.content) as { expo?: { plugins?: unknown[] } };
    for (const plugin of parsed.expo?.plugins ?? []) {
      if (Array.isArray(plugin) && plugin[0] === "expo-router") {
        const root = (plugin[1] as { root?: unknown } | undefined)?.root;
        if (typeof root === "string") return cleanRoot(root);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function cleanRoot(root: string): string {
  return root.replace(/^\.\//, "").replace(/\/+$/, "");
}
