import { posix } from "node:path";
import type { ScannedFile } from "../analysis/index.js";
import type { DetectedFramework } from "./frameworkDetector.js";
import { isArchitectureSource } from "../graph/index.js";
import { detectAdonisRoutes } from "./adonisRouteDetector.js";
import { detectAngularRoutes } from "./angularRouteDetector.js";
import { detectClientRoutes } from "./clientRouteDetector.js";
import { detectElysiaRoutes } from "./elysiaRouteDetector.js";
import { detectExpoRoutes } from "./expoRouteDetector.js";
import { detectHonoRoutes } from "./honoRouteDetector.js";
import { detectKoaRoutes } from "./koaRouteDetector.js";
import { detectNestRoutes } from "./nestRouteDetector.js";
import { detectQwikRoutes } from "./qwikRouteDetector.js";
import { detectReactRouterRoutes } from "./reactRouterRouteDetector.js";
import { detectRemixRoutes } from "./remixRouteDetector.js";
import { detectSolidStartRoutes } from "./solidStartRouteDetector.js";
import { detectTanStackRoutes } from "./tanstackRouteDetector.js";
import {
  composeMountPath,
  escapeRegExp,
  findHttpMethods,
  resolveRouterTarget,
  sortRoutes
} from "./routeUtils.js";
import { usesTrpc, detectTrpcRoutes } from "./trpcRouteDetector.js";

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

  if (usesTrpc(files)) {
    routes.push(...detectTrpcRoutes(files, graph));
  }

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

  // The detectors below find their own projects (a `routes.ts` that imports
  // `@react-router/dev/routes`, a package that depends on `expo-router`, a
  // `createFileRoute()` call), so they also work for the second frontend of a
  // monorepo, where `frameworks` only names the winner of each category.
  routes.push(...detectRemixRoutes(files, frameworks.includes("remix")));
  routes.push(...detectReactRouterRoutes(files));
  routes.push(...detectTanStackRoutes(files));
  routes.push(...detectExpoRoutes(files));
  routes.push(...detectSolidStartRoutes(files));
  routes.push(...detectQwikRoutes(files));
  routes.push(...detectAngularRoutes(files, graph));

  if (frameworks.includes("nestjs")) {
    routes.push(...detectNestRoutes(files));
  }

  if (frameworks.includes("express")) {
    routes.push(...detectExpressRoutes(files, graph));
  }

  if (frameworks.includes("fastify")) {
    routes.push(...detectFastifyRoutes(files, graph));
  }

  routes.push(...detectHonoRoutes(files, graph));
  routes.push(...detectElysiaRoutes(files, graph));
  routes.push(...detectKoaRoutes(files, graph));
  routes.push(...detectAdonisRoutes(files, graph));
  routes.push(...detectClientRoutes(files, graph));

  return sortRoutes(routes);
}

// Files that Next serves at a fixed URL.
const METADATA_ROUTES: Record<string, string | undefined> = {
  sitemap: "sitemap.xml",
  robots: "robots.txt",
  manifest: "manifest.webmanifest"
};

function detectNextRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const slotFiles = new Set<string>();

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    // App Router — match anywhere in path, not just root.
    // Supports: src/app/, app/, apps/web/src/app/, packages/web/src/app/, dll.
    // Sebelumnya pakai ^(?:src\/)? yang miss monorepo prefix seperti apps/web/.
    const appMatch = file.path.match(
      /(?:^|\/)(?:src\/)?app\/(.+\/)?(page|route|sitemap|robots|manifest)\.[jt]sx?$/
    );
    if (appMatch) {
      const segments = (appMatch[1] ?? "").split("/").filter(Boolean);
      // Folders that are not URLs of their own: `_private`, and intercepting
      // routes (`(.)photo`, `(..)feed`, `(...)shop`), which re-render a URL that
      // already has its own page.
      if (segments.some((segment) => segment.startsWith("_") || /^\(\.{1,3}\)/.test(segment))) continue;

      const type = appMatch[2];
      const metadataFile = METADATA_ROUTES[type];
      // robots and manifest only count at the root of the app folder (a `(group)` is not a folder).
      if ((type === "robots" || type === "manifest") && segments.some((segment) => !/^\(.*\)$/.test(segment))) continue;
      const isSlot = segments.some((segment) => segment.startsWith("@"));
      const routePath = metadataFile
        ? toRoutePath([...segments, metadataFile], true)
        : toRoutePath(segments, true);
      const kind = type === "page" ? "page" : "api";
      routes.push({
        path: routePath,
        file: file.path,
        kind,
        ...(type === "route" ? { methods: findHttpMethods(file.content) } : {}),
        ...(metadataFile ? { methods: ["GET"] } : {})
      });
      if (isSlot) slotFiles.add(file.path);
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
    // pages/index.tsx is "/" and pages/blog/index.tsx is "/blog".
    const segments = pagesMatch[1].replace(/(^|\/)index$/, "").split("/").filter(Boolean);
    routes.push({
      path: toRoutePath(segments),
      file: file.path,
      kind: isApi ? "api" : "page"
    });
  }

  // `app/dashboard/@team/page.tsx` fills a slot of `/dashboard`: when the URL has a
  // page of its own the slot is part of it, not another route.
  const ownPaths = new Set(routes.filter((route) => !slotFiles.has(route.file)).map((route) => `${route.kind}:${route.path}`));
  const visible = routes.filter((route) => !slotFiles.has(route.file) || !ownPaths.has(`${route.kind}:${route.path}`));

  return sortRoutes(visible);
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
    const serverMatch = file.path.match(/(?:^|\/)server\/(api|routes)\/(.+)\.[cm]?[jt]s$/);
    if (serverMatch) {
      // Nitro: server/api/** is mounted under /api, server/routes/** at the root,
      // and a ".get"/".post" suffix pins the method (users/[id].get.ts).
      const methodSuffix = serverMatch[2].match(/\.(get|post|put|patch|delete|options|head)$/i);
      const withoutMethod = methodSuffix
        ? serverMatch[2].slice(0, -methodSuffix[0].length)
        : serverMatch[2];
      const serverSegments = [
        ...(serverMatch[1] === "api" ? ["api"] : []),
        ...withoutMethod.split("/").filter(Boolean)
      ];
      const cleanServerSegments = serverSegments[serverSegments.length - 1] === "index"
        ? serverSegments.slice(0, -1)
        : serverSegments;

      routes.push({
        path: toRoutePath(cleanServerSegments),
        file: file.path,
        kind: "api",
        ...(methodSuffix ? { methods: [methodSuffix[1].toUpperCase()] } : {})
      });
      continue;
    }

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
// app.use("/api", router) plus middleware before the router
// (app.use("/api", auth, limiter(), router)) and member access (api.router).
// The mounting object may be any app/server/*Router, not just "app".
const MOUNT_PATTERN =
  /\b(?:app|server|\w*[Rr]outer)\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:[\w.]+(?:\([^()]*\))?\s*,\s*)*(?:[\w]+\.)*(\w+)\s*\)/g;

type ExpressMount = { prefix: string; identifier: string; file: string };

const FASTIFY_ROUTE_PATTERN =
  /\b(?:fastify|app|server)\.(get|post|put|patch|delete|options|head)\(\s*["'`]([^"'`]+)["'`]/gi;
// Object-style route declaration: app.route({ method: 'GET', url: '/users', ... })
const FASTIFY_OBJECT_ROUTE_PATTERN =
  /\.route\(\s*\{[^}]*?method:\s*["'`]?(\w+)["'`]?[^}]*?url:\s*["'`]([^"'`]+)["'`]/gs;
// Plugin/prefix registration: app.register(plugin, { prefix: '/api' })
const FASTIFY_REGISTER_PATTERN =
  /\.register\(\s*(\w+)\s*,\s*\{[^}]*?prefix:\s*["'`]([^"'`]+)["'`]/g;

type FastifyRegister = { prefix: string; identifier: string; file: string };

function detectFastifyRoutes(
  files: ScannedFile[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const eligibleFiles = files.filter((item) =>
    isArchitectureSource(item.path) && /\.[cm]?[jt]s$/.test(item.path)
  );
  const byPath = new Map(eligibleFiles.map((file) => [file.path, file]));

  // First pass: direct routes per file, plus collect plugin registrations.
  const directRoutes = new Map<string, RouteInfo[]>();
  const registers: FastifyRegister[] = [];

  for (const file of eligibleFiles) {
    const methodsByPath = collectFastifyRoutes(file.content);
    if (methodsByPath.length > 0) {
      directRoutes.set(file.path, methodsByPath.map(([path, methods]) => ({
        path,
        file: file.path,
        kind: "api" as const,
        methods
      })));
    }

    FASTIFY_REGISTER_PATTERN.lastIndex = 0;
    let match = FASTIFY_REGISTER_PATTERN.exec(file.content);
    while (match) {
      registers.push({ prefix: match[2], identifier: match[1], file: file.path });
      match = FASTIFY_REGISTER_PATTERN.exec(file.content);
    }
  }

  // Second pass: resolve registered plugins and compose prefix + sub-path.
  const mountedFiles = new Set<string>();
  for (const register of registers) {
    const target = resolveRouterTarget(
      register.identifier,
      register.file,
      eligibleFiles,
      byPath,
      graph,
      (file) => collectFastifyRoutes(file.content).length > 0
    );
    const subRoutes = target ? collectFastifyRoutes(target.content) : [];

    if (target && subRoutes.length > 0) {
      mountedFiles.add(target.path);
      for (const [subPath, methods] of subRoutes) {
        routes.push({
          path: composeMountPath(register.prefix, subPath),
          file: register.file,
          kind: "api",
          methods
        });
      }
    }
    // Unresolvable plugin without routes — it is not a route, so drop it.
  }

  // @fastify/autoload registers every plugin file of a folder with the folder path as its
  // prefix, so a file's routes are relative to that path, not to "/".
  const autoloads = findAutoloadRoots(eligibleFiles);

  // Emit standalone routes only for files that were not absorbed by a plugin.
  for (const [path, fileRoutes] of directRoutes) {
    if (mountedFiles.has(path)) continue;
    const prefix = autoloadPrefix(path, autoloads);
    if (prefix === undefined) {
      routes.push(...fileRoutes);
      continue;
    }
    for (const route of fileRoutes) {
      routes.push({ ...route, path: composeMountPath(prefix, route.path) });
    }
  }

  return routes;
}

type AutoloadRoot = {
  /** Folder (project-relative, posix) whose plugin files autoload registers. */
  dir: string;
  /** Prefix of the registration itself (`options: { prefix: "/v1" }`). */
  prefix: string;
  dirNameRoutePrefix: boolean;
  routeParams: boolean;
};

// `fastify.register(autoLoad, { dir: join(__dirname, "routes"), options: { prefix: "/v1" } })`
const AUTOLOAD_IMPORT_PATTERN =
  /import\s+(\w+)\s+from\s+["']@fastify\/autoload["']|(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*["']@fastify\/autoload["']\s*\)/;

function findAutoloadRoots(files: ScannedFile[]): AutoloadRoot[] {
  const roots: AutoloadRoot[] = [];

  for (const file of files) {
    const imported = AUTOLOAD_IMPORT_PATTERN.exec(file.content);
    const local = imported?.[1] ?? imported?.[2];
    if (!local) continue;

    const registration = new RegExp(`\\.register\\(\\s*${escapeRegExp(local)}\\s*,\\s*\\{`, "g");
    let match = registration.exec(file.content);
    while (match) {
      const body = readBalancedBraces(file.content, match.index + match[0].length - 1);
      match = registration.exec(file.content);
      if (!body) continue;

      // dir: path.join(__dirname, "routes") / join(import.meta.dirname, "routes", "api")
      const dirExpression = /\bdir:\s*[\w.]+\(([^)]*)\)/.exec(body);
      const literals = [...(dirExpression?.[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1]);
      if (literals.length === 0) continue;

      const base = posix.dirname(file.path);
      const dir = posix.normalize(posix.join(base === "." ? "" : base, ...literals));
      roots.push({
        dir,
        prefix: /\bprefix:\s*["'`]([^"'`]+)["'`]/.exec(body)?.[1] ?? "",
        dirNameRoutePrefix: !/\bdirNameRoutePrefix:\s*false\b/.test(body),
        routeParams: /\brouteParams:\s*true\b/.test(body)
      });
    }
  }

  return roots;
}

/** The text between the `{` at `open` and its matching `}`, or undefined when unbalanced. */
function readBalancedBraces(content: string, open: number): string | undefined {
  let depth = 0;
  for (let index = open; index < content.length; index++) {
    if (content[index] === "{") depth++;
    else if (content[index] === "}" && --depth === 0) return content.slice(open + 1, index);
  }
  return undefined;
}

function autoloadPrefix(filePath: string, roots: AutoloadRoot[]): string | undefined {
  // Files autoload skips: hooks files, tests and declarations.
  const name = posix.basename(filePath);
  if (/^autohooks\./.test(name) || /\.(?:test|spec)\.|\.d\.[cm]?ts$/.test(name)) return undefined;

  for (const root of roots) {
    if (!filePath.startsWith(`${root.dir}/`)) continue;
    const folders = posix.dirname(filePath.slice(root.dir.length + 1)).split("/").filter((part) => part && part !== ".");
    const segments = root.dirNameRoutePrefix
      ? folders.map((folder) => (root.routeParams && folder.startsWith("_") ? `:${folder.slice(1)}` : folder))
      : [];
    return composeMountPath(root.prefix || "/", segments.length > 0 ? segments.join("/") : "/");
  }
  return undefined;
}

function collectFastifyRoutes(content: string): Array<[string, string[]]> {
  const methodsByPath = new Map<string, Set<string>>();
  addRouteMethods(methodsByPath, content, FASTIFY_ROUTE_PATTERN);
  addRouteMethods(methodsByPath, content, FASTIFY_OBJECT_ROUTE_PATTERN);
  return [...methodsByPath]
    .map(([path, methods]) => [path, [...methods].sort()] as [string, string[]])
    .sort(([left], [right]) => left.localeCompare(right));
}

function addRouteMethods(
  methodsByPath: Map<string, Set<string>>,
  content: string,
  pattern: RegExp
): void {
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
}

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

  // Second pass: resolve each mount to the router file it points at.
  const resolvedMounts = mounts.map((mount) => ({
    mount,
    target: resolveRouterTarget(
      mount.identifier,
      mount.file,
      eligibleFiles,
      byPath,
      graph,
      (file) => collectRouteMethods(file.content, MOUNTED_ROUTER_PATTERN).length > 0
    )
  }));

  // A router can itself be mounted (app -> /api -> v1 router -> /users -> users
  // router), so a mount's effective prefix is the chain of mounts above its file.
  const mountedBy = new Map<string, ExpressMount[]>();
  for (const { mount, target } of resolvedMounts) {
    if (target && target.path !== mount.file) {
      mountedBy.set(target.path, [...(mountedBy.get(target.path) ?? []), mount]);
    }
  }

  const prefixesOf = (file: string, seen: Set<string> = new Set()): string[] => {
    const parents = mountedBy.get(file);
    if (!parents || seen.has(file)) return [""];
    const nextSeen = new Set(seen).add(file);
    return parents.flatMap((parent) =>
      prefixesOf(parent.file, nextSeen).map((outer) => composeMountPath(outer, parent.prefix))
    );
  };

  const mountsByFile = new Set(mounts.map((mount) => mount.file));
  const mountedFiles = new Set<string>();
  for (const { mount, target } of resolvedMounts) {
    const subRoutes = target
      ? collectRouteMethods(target.content, MOUNTED_ROUTER_PATTERN)
      : [];

    for (const outer of prefixesOf(mount.file)) {
      const base = composeMountPath(outer, mount.prefix);

      if (target && subRoutes.length > 0) {
        mountedFiles.add(target.path);
        for (const [subPath, methods] of subRoutes) {
          routes.push({
            path: composeMountPath(base, subPath),
            file: mount.file,
            kind: "api",
            methods
          });
        }
      } else if (target && mountsByFile.has(target.path)) {
        // A router that only forwards to further routers: its children carry
        // the full prefix, so a bare USE entry would be noise.
        mountedFiles.add(target.path);
      } else {
        // Unresolvable or empty router — keep the mount itself as a USE route so
        // the middleware prefix stays visible instead of silently disappearing.
        routes.push({
          path: base || "/",
          file: mount.file,
          kind: "api",
          methods: ["USE"]
        });
      }
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

/**
 * Joins folder segments into a URL. `(group)` folders are never part of it. `@slot`
 * folders are dropped only when `parallelSlots` is set (Next App Router): in SvelteKit,
 * Astro and Nuxt `@` is a literal character, so `profile/@[user]` is `/profile/@[user]`.
 */
function toRoutePath(segments: string[], parallelSlots = false): string {
  const visible = segments.filter(
    (segment) => !segment.startsWith("(") && !(parallelSlots && segment.startsWith("@"))
  );
  return `/${visible.join("/")}`.replace(/\/+/g, "/");
}
