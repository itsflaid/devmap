import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";

export type FrontendFramework =
  | "nextjs" | "react" | "astro" | "vue" | "nuxt" | "svelte" | "sveltekit";
export type BackendFramework =
  | "express" | "fastify" | "nestjs" | "koa";
export type Framework = FrontendFramework | BackendFramework | "unknown";
export type DetectedFramework = Exclude<Framework, "unknown">;

const FRONTEND_ORDER: FrontendFramework[] =
  ["nextjs", "nuxt", "sveltekit", "astro", "react", "vue", "svelte"];
const BACKEND_ORDER: BackendFramework[] =
  ["nestjs", "fastify", "express", "koa"];

export function detectFramework(files: ScannedFile[]): Framework {
  const [frontendWinner, backendWinner] = detectFrameworks(files);
  return frontendWinner ?? backendWinner ?? "unknown";
}

/**
 * detectFrameworks — detect every framework signal, then return AT MOST one
 * winner per category (frontend, backend). Frontend-first for display.
 *
 * A project with both a Next.js frontend and an Express backend (single
 * package or monorepo scan) returns two entries instead of the single
 * first-match-wins value the old flat order produced. `nextjs` still beats
 * `astro` within the frontend category — the same first-match-wins rule is
 * simply scoped per category now.
 */
export function detectFrameworks(files: ScannedFile[]): DetectedFramework[] {
  const detected = new Set<DetectedFramework>();

  // Phase 1: dependency manifest — highest confidence signal.
  // package.json is the canonical source of truth for what frameworks are installed.
  for (const dependencies of readManifestDependencies(files)) {
    if ("next" in dependencies) detected.add("nextjs");
    if ("express" in dependencies) detected.add("express");
    if ("astro" in dependencies) detected.add("astro");
    if ("nuxt" in dependencies) detected.add("nuxt");
    if ("fastify" in dependencies) detected.add("fastify");
    if ("@nestjs/core" in dependencies || "@nestjs/common" in dependencies) {
      detected.add("nestjs");
    }
    if ("@sveltejs/kit" in dependencies) detected.add("sveltekit");

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

    // Nuxt apps ship App.vue too, so vue must exclude when nuxt is present —
    // same mirror of the react-vs-next exclusion. The runtime gate prevents a
    // Vue UI library (vue only in peerDependencies) from being labeled an app.
    const hasVueRuntime = "@vitejs/plugin-vue" in dependencies
      || "@vitejs/plugin-vue2" in dependencies
      || "vue-cli-service" in dependencies;
    if (!("nuxt" in dependencies) && "vue" in dependencies && hasVueRuntime) {
      detected.add("vue");
    }

    const hasSvelteRuntime = "@sveltejs/vite-plugin-svelte" in dependencies;
    if (!("@sveltejs/kit" in dependencies) && "svelte" in dependencies && hasSvelteRuntime) {
      detected.add("svelte");
    }
  }

  // Phase 2: file structure heuristics — secondary signal.
  // Only used when package.json is absent or incomplete (e.g. monorepo root without deps).
  const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

  // Next.js: next.config.* or App Router / Pages Router file conventions.
  // _app and _document are Next.js-unique; a bare src/pages/api/ folder is NOT
  // (Astro uses the same folder for endpoints), so it is deliberately excluded
  // from the Pages Router signal here.
  if (
    files.some((file) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(file.path))
    || sourceFiles.some((file) =>
      /(^|\/)(?:src\/)?app\/(?:.+\/)?(?:page|layout|route)\.[jt]sx?$/.test(file.path)
      || /(^|\/)(?:src\/)?pages\/(?:_app|_document)/.test(file.path)
    )
  ) {
    detected.add("nextjs");
  }

  // Express: primarily via package.json dependency (see below for the file-only path).
  const hasReliableManifest = files.some(
    (file) => file.path.endsWith("package.json") && isArchitectureSource(file.path) && isParseableJson(file.content)
  );

  // Express: ONLY add via file heuristic if express was already confirmed in package.json,
  // OR — narrow fallback — if package.json is missing/unparseable entirely.
  //
  // Rationale: `server.ts` and `app.ts` are common filenames in Next.js, NestJS, and vanilla
  // Node projects. Without the dependency gate, a Next.js project with a custom `app.ts`
  // utility file would be misclassified as Express. The dep check is the authoritative signal;
  // the filename pattern alone is intentionally never used as a standalone trigger.
  //
  // When there's no reliable manifest to check at all, that filename ambiguity is still a
  // real risk, so instead of trusting the filename we scan file *content* for an actual
  // `express()` call or `require("express")`/`from "express"` — evidence specific enough
  // that a Next.js app.ts utility file won't produce a false positive.
  if (
    detected.has("express")
    && sourceFiles.some((file) =>
      /(^|\/)(?:src\/)?(?:server|app)\.[cm]?[jt]s$/.test(file.path)
    )
  ) {
    // Already added via deps — this block intentionally left as documentation of the gate.
    // The detected.add("express") already happened above; we don't re-add.
  } else if (!hasReliableManifest && sourceFiles.some((file) => hasExpressCallSite(file.content))) {
    detected.add("express");
  }

  // Astro: src/pages/*.astro is specific enough to be safe as a standalone signal.
  if (sourceFiles.some((file) => /(^|\/)src\/pages\/.+\.astro$/.test(file.path))) {
    detected.add("astro");
  }

  // Nuxt: nuxt.config.* is as specific as next.config.* today.
  if (files.some((file) => /(^|\/)nuxt\.config\.[cm]?[jt]s$/.test(file.path))) {
    detected.add("nuxt");
  }

  // Vue: App.vue at the project root (or src/) is specific enough to stand alone.
  if (sourceFiles.some((file) => /(^|\/)(?:src\/)?App\.vue$/.test(file.path))) {
    detected.add("vue");
  }

  // SvelteKit: +page.svelte under src/routes/ is unique to SvelteKit — the "+"
  // prefix is not used by any other framework. svelte.config.js is NOT used as a
  // signal because non-SvelteKit Svelte projects have it too.
  if (sourceFiles.some((file) => /(^|\/)src\/routes\/.+\+page\.svelte$/.test(file.path))) {
    detected.add("sveltekit");
  }

  // NestJS: nest-cli.json is as specific as next.config.* / nuxt.config.*.
  if (files.some((file) => /(^|\/)nest-cli\.json$/.test(file.path))) {
    detected.add("nestjs");
  }

  return [
    FRONTEND_ORDER.find((framework) => detected.has(framework)),
    BACKEND_ORDER.find((framework) => detected.has(framework)),
  ].filter((framework): framework is FrontendFramework | BackendFramework => Boolean(framework));
}

function isParseableJson(content: string): boolean {
  try {
    JSON.parse(content);
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

function readManifestDependencies(files: ScannedFile[]): Array<Record<string, string>> {
  return files
    .filter((file) =>
      file.path.endsWith("package.json") && isArchitectureSource(file.path)
    )
    .map((file) => readDependencies(file.content));
}

function readDependencies(content: string): Record<string, string> {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      ...parsed.dependencies,
      ...parsed.devDependencies
    };
  } catch {
    return {};
  }
}
