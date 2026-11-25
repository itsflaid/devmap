import { parseJsonText, type ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";

// Order is priority: the first detected framework of a category wins. The
// meta-frameworks come before plain `react` because they all ship React too.
export const FRONTEND_FRAMEWORKS = [
  "nextjs", "nuxt", "sveltekit", "astro",
  "remix", "react-router", "tanstack-start", "tanstack-router", "expo",
  "solid-start", "qwik", "angular",
  "react", "vue", "svelte"
] as const;
export const BACKEND_FRAMEWORKS = [
  "nestjs", "adonisjs", "fastify", "express", "hono", "elysia", "koa"
] as const;

export type FrontendFramework = typeof FRONTEND_FRAMEWORKS[number];
export type BackendFramework = typeof BACKEND_FRAMEWORKS[number];
export type Framework = FrontendFramework | BackendFramework | "unknown";
export type DetectedFramework = Exclude<Framework, "unknown">;

export const FRONTEND_FRAMEWORK_SET = new Set<string>(FRONTEND_FRAMEWORKS);
export const BACKEND_FRAMEWORK_SET = new Set<string>(BACKEND_FRAMEWORKS);

export function detectFramework(files: ScannedFile[]): Framework {
  const [frontendWinner, backendWinner] = detectFrameworks(files);
  return frontendWinner ?? backendWinner ?? "unknown";
}

/**
 * At most one winner per category (frontend, backend), frontend first. A Next.js
 * frontend with an Express backend returns both; within a category the first
 * match in the priority order wins (`nextjs` beats `astro`).
 */
export function detectFrameworks(files: ScannedFile[]): DetectedFramework[] {
  return winnersOf(collectFrameworks(files));
}

/**
 * Every framework the project shows signals for, in display order. Route
 * detection keeps using `detectFrameworks` (one winner per category); this is
 * the list a reader or an agent should see, so a monorepo with a Next.js site,
 * an Expo app and a TanStack Start app names all three.
 */
export function detectAllFrameworks(files: ScannedFile[]): DetectedFramework[] {
  return allOf(collectFrameworks(files));
}

/** Both lists from one pass over the files. */
export function summarizeFrameworks(files: ScannedFile[]): {
  frameworks: DetectedFramework[];
  detectedFrameworks: DetectedFramework[];
} {
  const detected = collectFrameworks(files);
  return { frameworks: winnersOf(detected), detectedFrameworks: allOf(detected) };
}

function winnersOf(detected: Set<DetectedFramework>): DetectedFramework[] {
  return [
    FRONTEND_FRAMEWORKS.find((framework) => detected.has(framework)),
    BACKEND_FRAMEWORKS.find((framework) => detected.has(framework)),
  ].filter((framework): framework is FrontendFramework | BackendFramework => Boolean(framework));
}

// A plain UI framework (or TanStack Router) that a full framework in the same
// project already implies is not listed next to it: every Next.js app ships React.
const IMPLIED_BY: Partial<Record<DetectedFramework, readonly DetectedFramework[]>> = {
  react: ["nextjs", "remix", "react-router", "tanstack-start", "tanstack-router", "expo"],
  vue: ["nuxt"],
  svelte: ["sveltekit"],
  "tanstack-router": ["tanstack-start"],
};

function allOf(detected: Set<DetectedFramework>): DetectedFramework[] {
  return [...FRONTEND_FRAMEWORKS, ...BACKEND_FRAMEWORKS].filter((framework) =>
    detected.has(framework)
    && !(IMPLIED_BY[framework] ?? []).some((parent) => detected.has(parent))
  );
}

function collectFrameworks(files: ScannedFile[]): Set<DetectedFramework> {
  const detected = new Set<DetectedFramework>();
  const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

  // package.json dependencies are the highest-confidence signal.
  for (const manifest of readManifestDependencies(files)) {
    const dependencies = { ...manifest.runtime, ...manifest.dev };
    // A server framework that is only a devDependency is usually test tooling
    // (a mock server in a library's tests), so production code has to import it.
    const serverDeclared = (...names: string[]) => names.some((name) =>
      name in manifest.runtime || (name in manifest.dev && importsPackage(sourceFiles, name))
    );
    if ("next" in dependencies) detected.add("nextjs");
    if (serverDeclared("express")) detected.add("express");
    if ("astro" in dependencies) detected.add("astro");
    if ("nuxt" in dependencies) detected.add("nuxt");
    if (serverDeclared("fastify")) detected.add("fastify");
    if (serverDeclared("@nestjs/core", "@nestjs/common")) {
      detected.add("nestjs");
    }
    if ("@sveltejs/kit" in dependencies) detected.add("sveltekit");
    if (serverDeclared("hono")) detected.add("hono");
    if (serverDeclared("elysia")) detected.add("elysia");
    if (serverDeclared("koa")) detected.add("koa");
    if (serverDeclared(...ADONIS_PACKAGES)) detected.add("adonisjs");

    // SolidStart, Qwik City and Angular are full frameworks with their own router;
    // plain `solid-js` / `@builder.io/qwik` are just component libraries.
    if ("@solidjs/start" in dependencies || "solid-start" in dependencies) detected.add("solid-start");
    if (QWIK_PACKAGES.some((name) => name in dependencies)) detected.add("qwik");
    // `@angular/core` alone is also what an Angular library lists, so an app needs its platform or CLI.
    if (
      "@angular/core" in dependencies
      && ("@angular/platform-browser" in dependencies || "@angular/cli" in dependencies || "@angular/build" in dependencies)
    ) {
      detected.add("angular");
    }

    // Remix v2 lives under `@remix-run/*`; `@remix-run/router` is React Router's
    // own internal package and says nothing about Remix.
    if (REMIX_PACKAGES.some((name) => name in dependencies)) detected.add("remix");
    // React Router v7 "framework mode" (the Remix successor) is the dev tooling;
    // `react-router-dom` alone is just a client-side router inside a React app.
    if ("@react-router/dev" in dependencies) detected.add("react-router");
    if (Object.keys(dependencies).some(isTanStackStartPackage)) detected.add("tanstack-start");
    if (TANSTACK_ROUTER_PACKAGES.some((name) => name in dependencies)) detected.add("tanstack-router");
    // Expo Router is what makes `app/` a route tree; bare Expo is just React Native.
    if ("expo-router" in dependencies) detected.add("expo");

    const hasReactRuntime = "react-dom" in dependencies
      || "react-scripts" in dependencies
      || "@vitejs/plugin-react" in dependencies
      || "@vitejs/plugin-react-swc" in dependencies;
    if (
      !("next" in dependencies)
      && !("astro" in dependencies)
      && "react" in dependencies
      && hasReactRuntime
    ) {
      detected.add("react");
    }

    // Nuxt apps ship App.vue too, so vue is excluded when nuxt is present (as react
    // is for next). The runtime gate keeps a Vue UI library, which lists vue as a
    // peer or dev dependency, from being labeled an app.
    const hasVueRuntime = "@vitejs/plugin-vue" in dependencies
      || "@vitejs/plugin-vue2" in dependencies
      || "@vue/cli-service" in dependencies
      || "vue-cli-service" in dependencies;
    if (!("nuxt" in dependencies) && "vue" in dependencies && hasVueRuntime) {
      detected.add("vue");
    }

    const hasSvelteRuntime = "@sveltejs/vite-plugin-svelte" in dependencies;
    if (!("@sveltejs/kit" in dependencies) && "svelte" in dependencies && hasSvelteRuntime) {
      detected.add("svelte");
    }
  }

  // File-structure signals run in addition to the manifests (a monorepo root may list no deps).

  // Next.js: next.config.* or App Router / Pages Router file conventions.
  // _app and _document are Next.js-unique; a bare src/pages/api/ folder is not a
  // signal because Astro uses the same folder for endpoints.
  if (
    sourceFiles.some((file) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(file.path))
    || sourceFiles.some((file) =>
      // `app/routes/blog/route.tsx` is a Remix route folder, not a Next route handler.
      /(^|\/)(?:src\/)?app\/(?!routes\/)(?:.+\/)?(?:page|layout|route)\.[jt]sx?$/.test(file.path)
      || /(^|\/)(?:src\/)?pages\/(?:_app|_document)/.test(file.path)
    )
  ) {
    detected.add("nextjs");
  }

  // The Express and Hono file heuristics below only apply when this is false.
  const hasReliableManifest = files.some(
    (file) => file.path.endsWith("package.json") && isArchitectureSource(file.path) && isParseableJson(file.content)
  );

  // A `server.ts` / `app.ts` filename never adds Express by itself: Next.js, NestJS and
  // plain Node projects use those names too. With no parseable package.json to check,
  // file content is scanned for an `express()` call or an `express` require/import instead.
  if (
    detected.has("express")
    && sourceFiles.some((file) =>
      /(^|\/)(?:src\/)?(?:server|app)\.[cm]?[jt]s$/.test(file.path)
    )
  ) {
    // Already detected from dependencies.
  } else if (!hasReliableManifest && sourceFiles.some((file) => hasExpressCallSite(file.content))) {
    detected.add("express");
  }

  // src/pages/*.astro is specific enough to stand alone.
  if (sourceFiles.some((file) => /(^|\/)src\/pages\/.+\.astro$/.test(file.path))) {
    detected.add("astro");
  }

  // nuxt.config.* is specific to Nuxt.
  if (sourceFiles.some((file) => /(^|\/)nuxt\.config\.[cm]?[jt]s$/.test(file.path))) {
    detected.add("nuxt");
  }

  // App.vue at the project root (or src/) is specific enough to stand alone.
  if (sourceFiles.some((file) => /(^|\/)(?:src\/)?App\.vue$/.test(file.path))) {
    detected.add("vue");
  }

  // +page.svelte under src/routes/ is unique to SvelteKit. svelte.config.js is not a
  // signal because plain Svelte projects have it too.
  if (sourceFiles.some((file) => /(^|\/)src\/routes\/.+\+page\.svelte$/.test(file.path))) {
    detected.add("sveltekit");
  }

  // nest-cli.json is specific to NestJS.
  if (files.some((file) => /(^|\/)nest-cli\.json$/.test(file.path))) {
    detected.add("nestjs");
  }

  // The Remix and React Router v7 config files are specific to each tool.
  if (files.some((file) => /(^|\/)remix\.config\.[cm]?js$/.test(file.path))) {
    detected.add("remix");
  }
  if (files.some((file) => /(^|\/)react-router\.config\.[cm]?[jt]s$/.test(file.path))) {
    detected.add("react-router");
  }

  // TanStack Router writes `routeTree.gen.ts` (or the name set in `tsr.config.json`).
  if (files.some((file) => /(^|\/)(?:routeTree\.gen\.[jt]sx?|tsr\.config\.json)$/.test(file.path))) {
    detected.add("tanstack-router");
  }

  // Expo Router: the config plugin is declared in app.json / app.config.*.
  if (files.some((file) =>
    /(^|\/)app(?:\.config\.[cm]?[jt]s|\.json)$/.test(file.path) && file.content.includes("expo-router")
  )) {
    detected.add("expo");
  }

  // Angular's workspace file and AdonisJS's rc file are specific to each framework.
  if (files.some((file) => /(^|\/)angular\.json$/.test(file.path))) {
    detected.add("angular");
  }
  if (files.some((file) => /(^|\/)\.?adonisrc\.(?:json|[cm]?[jt]s)$/.test(file.path))) {
    detected.add("adonisjs");
  }

  // Hono: like Express, the import is only trusted when no manifest can confirm it.
  if (!hasReliableManifest && sourceFiles.some((file) => /from\s+["']hono["']/.test(file.content))) {
    detected.add("hono");
  }

  return detected;
}

const REMIX_PACKAGES = [
  "@remix-run/dev", "@remix-run/react", "@remix-run/serve",
  "@remix-run/node", "@remix-run/cloudflare", "@remix-run/deno"
];

const QWIK_PACKAGES = ["@builder.io/qwik-city", "@builder.io/qwik", "@qwik.dev/router", "@qwik.dev/core"];

// `@adonisjs/core` is v5 and v6; `@adonisjs/framework` is v4.
const ADONIS_PACKAGES = ["@adonisjs/core", "@adonisjs/framework"];

const TANSTACK_ROUTER_PACKAGES = [
  "@tanstack/react-router", "@tanstack/solid-router",
  "@tanstack/router-plugin", "@tanstack/router-vite-plugin", "@tanstack/router-cli"
];

// `@tanstack/react-start`, `@tanstack/solid-start`, and the pre-1.0 `@tanstack/start`
// (plus its `start-*` helper packages).
function isTanStackStartPackage(name: string): boolean {
  return /^@tanstack\/(?:react-start|solid-start|start)(?:-|$)/.test(name);
}

function isParseableJson(content: string): boolean {
  try {
    parseJsonText(content);
    return true;
  } catch {
    return false;
  }
}

function hasExpressCallSite(content: string): boolean {
  return /\bexpress\s*\(\s*\)/.test(content)
    || /require\(\s*["']express["']\s*\)/.test(content)
    || /from\s+["']express["']/.test(content);
}

type ManifestDependencies = {
  runtime: Record<string, string>;
  dev: Record<string, string>;
};

function readManifestDependencies(files: ScannedFile[]): ManifestDependencies[] {
  return files
    .filter((file) =>
      file.path.endsWith("package.json") && isArchitectureSource(file.path)
    )
    .map((file) => readDependencies(file.content));
}

function readDependencies(content: string): ManifestDependencies {
  try {
    const parsed = parseJsonText(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      runtime: { ...parsed.dependencies },
      dev: { ...parsed.devDependencies }
    };
  } catch {
    return { runtime: {}, dev: {} };
  }
}

const CODE_FILE = /\.[cm]?[jt]sx?$|\.vue$|\.svelte$|\.astro$/;

function importsPackage(sourceFiles: ScannedFile[], name: string): boolean {
  const escaped = name.replace(/\W/g, "\\$&");
  const pattern = new RegExp(`(?:from\\s*|require\\(\\s*|import\\s*\\(\\s*|import\\s+)["']${escaped}["'/]`);
  return sourceFiles.some((file) => CODE_FILE.test(file.path) && pattern.test(file.content));
}
