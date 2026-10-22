import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import type { RouteInfo } from "./routeDetector.js";
import { findProjectDirs, joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * Qwik City routes are folders under `src/routes/`, and a folder is a URL only
 * when it holds an `index` file:
 *
 *   src/routes/index.tsx               → /                 (page)
 *   src/routes/blog/[slug]/index.tsx   → /blog/[slug]      (`[...rest]` and `[[optional]]` are kept as written)
 *   src/routes/(marketing)/about/index.mdx → /about        (`(group)` folders add no URL)
 *   src/routes/api/ping/index.ts       → /api/ping         (endpoint: `onGet`, `onPost`, `onRequest`, ...)
 *   index@admin.tsx                    → same URL, rendered in the `admin` layout
 *
 * `layout.tsx`, `plugin@*.ts` and everything else in the folder are not routes.
 */

const QWIK = ["@builder.io/qwik-city", "@qwik.dev/router"];
const ROUTE_FILE = /^index(?:@[\w-]+)?\.(tsx|jsx|ts|js|mdx|md)$/;
const HANDLERS: Record<string, string | undefined> = {
  onGet: "GET", onPost: "POST", onPut: "PUT", onPatch: "PATCH", onDelete: "DELETE",
  onHead: "HEAD", onOptions: "OPTIONS", onRequest: undefined
};

export function detectQwikRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes = new Map<string, RouteInfo>();

  for (const projectDir of findProjectDirs(files, QWIK)) {
    const root = `${projectDir}src/routes/`;

    for (const file of files) {
      if (!file.path.startsWith(root) || !isArchitectureSource(file.path)) continue;
      const segments = file.path.slice(root.length).split("/");
      const name = segments.pop() ?? "";
      const match = ROUTE_FILE.exec(name);
      if (!match) continue;

      const path = joinRoutePaths(...segments.filter((segment) => !/^\(.*\)$/.test(segment)));
      const extension = match[1];

      if (extension === "tsx" || extension === "jsx" || extension === "md" || extension === "mdx") {
        routes.set(`page ${path}`, { path, file: file.path, kind: "page" });
        continue;
      }

      const exported = Object.keys(HANDLERS).filter((handler) =>
        new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${handler}\\b`).test(file.content));
      if (exported.length === 0) continue;

      const methods = exported.map((handler) => HANDLERS[handler]).filter((method): method is string => Boolean(method)).sort();
      routes.set(`api ${path}`, {
        path,
        file: file.path,
        kind: "api",
        ...(methods.length > 0 && !exported.includes("onRequest") ? { methods } : {})
      });
    }
  }

  return sortRoutes([...routes.values()]);
}
