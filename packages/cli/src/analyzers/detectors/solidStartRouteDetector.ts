import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import type { RouteInfo } from "./routeDetector.js";
import { dropShadowedLayouts, findHttpMethods, findProjectDirs, joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * SolidStart turns `src/routes/` into URLs:
 *
 *   src/routes/index.tsx           → /
 *   src/routes/users/[id].tsx      → /users/[id]       (`[...rest]` and `[[optional]]` are kept as written)
 *   src/routes/(auth)/login.tsx    → /login            (`(group)` folders and `(group)name` parts add no URL)
 *   src/routes/users.tsx           → layout of users/  (listed only when users/ has no index)
 *   export function GET()          → an API route with that method
 *
 * A module with a default export is a page; named `GET`/`POST`/... exports make
 * it an API route as well, and a file with neither is not a route.
 */

const SOLID_START = ["@solidjs/start", "solid-start"];
const CODE = /\.(?:[cm]?[jt]sx?)$/;

export function detectSolidStartRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const projectDir of findProjectDirs(files, SOLID_START)) {
    const root = `${projectDir}src/routes/`;
    const entries: Array<{ path: string; file: string; isIndex: boolean; isLayout: boolean; content: string }> = [];
    const folders = new Set<string>();

    const inRoutes = files.filter((file) => file.path.startsWith(root) && isArchitectureSource(file.path));
    for (const file of inRoutes) {
      const parts = file.path.slice(root.length).split("/");
      for (let depth = 1; depth < parts.length; depth += 1) folders.add(parts.slice(0, depth).join("/"));
    }

    for (const file of inRoutes) {
      if (!CODE.test(file.path) || file.path.endsWith(".d.ts") || /\.data\.[cm]?[jt]sx?$/.test(file.path)) continue;

      const relative = file.path.slice(root.length).replace(CODE, "");
      const segments = relative.split("/");
      const isIndex = segments[segments.length - 1] === "index";
      if (isIndex) segments.pop();

      // `(group)` folders, and groups written into a name: `(auth)login.tsx` is `/login`.
      const url = segments.map((segment) => segment.replace(/\([^)]*\)/g, "")).filter((segment) => segment !== "");
      entries.push({
        path: joinRoutePaths(...url),
        file: file.path,
        isIndex,
        isLayout: !isIndex && folders.has(relative),
        content: file.content
      });
    }

    for (const entry of dropShadowedLayouts(entries)) {
      const methods = findHttpMethods(entry.content);
      if (/\bexport\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(entry.content)) {
        routes.push({ path: entry.path, file: entry.file, kind: "page" });
      }
      if (methods.length > 0) {
        routes.push({ path: entry.path, file: entry.file, kind: "api", methods });
      }
    }
  }

  return sortRoutes(routes);
}
