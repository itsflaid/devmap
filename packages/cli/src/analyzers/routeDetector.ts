import type { ScannedFile } from "./fileScanner.js";
import type { Framework } from "./frameworkDetector.js";
import { isArchitectureSource } from "./sourceScope.js";

export type RouteInfo = {
  path: string;
  file: string;
  kind: "page" | "api";
  methods?: string[];
};

export function detectRoutes(files: ScannedFile[], framework: Framework): RouteInfo[] {
  if (framework === "nextjs") {
    return detectNextRoutes(files);
  }

  if (framework === "express") {
    return detectExpressRoutes(files);
  }

  return [];
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

function detectExpressRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const routePattern = /\b(?:app|router)\.(get|post|put|patch|delete|options|head|use)\(\s*["'`]([^"'`]+)["'`]/gi;

  for (const file of files.filter((item) =>
    isArchitectureSource(item.path) && /\.[cm]?[jt]s$/.test(item.path)
  )) {
    const methodsByPath = new Map<string, Set<string>>();
    routePattern.lastIndex = 0;

    let match = routePattern.exec(file.content);
    while (match) {
      const method = match[1].toUpperCase();
      const path = match[2];
      const methods = methodsByPath.get(path) ?? new Set<string>();
      methods.add(method);
      methodsByPath.set(path, methods);
      match = routePattern.exec(file.content);
    }

    for (const [path, methods] of methodsByPath) {
      routes.push({
        path,
        file: file.path,
        kind: "api",
        methods: [...methods].sort()
      });
    }
  }

  return sortRoutes(routes);
}

function toRoutePath(segments: string[]): string {
  const visible = segments.filter(
    (segment) => !segment.startsWith("(") && !segment.startsWith("@")
  );
  return `/${visible.join("/")}`.replace(/\/+/g, "/");
}

function findHttpMethods(content: string): string[] {
  const methods = new Set<string>();
  const pattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
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
