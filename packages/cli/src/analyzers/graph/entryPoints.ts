import type { FileGraph } from "./dependencyGraph.js";
import type { ManifestEntry } from "./packageManifests.js";
import { isArchitectureSource } from "./sourceScope.js";

const ENTRY_PATTERNS = [
  /(^|\/)page\.[jt]sx?$/,
  /(^|\/)layout\.[jt]sx?$/,
  /(^|\/)middleware\.[jt]s$/,
  /(^|\/)(server|app|index|main)\.[cm]?[jt]sx?$/,
  /(^|\/)route\.[jt]s$/
];

// Files a framework loads by convention. They only count while no source file
// imports them: a Vue SPA's `pages/Home.vue` pulled in by its router is a
// component, while a Nuxt page that nothing references is where a route starts.
const FRAMEWORK_LOADED_PATTERNS = [
  /(^|\/)app\.vue$/,
  /(^|\/)\+(?:page|layout)\.svelte$/,
  /(^|\/)\+server\.[jt]s$/,
  /(^|\/)hooks\.(?:server|client)\.[jt]s$/,
  /(^|\/)app\/root\.[jt]sx?$/,
  /(^|\/)entry\.(?:client|server)\.[jt]sx?$/,
  // React Router v7 route config and Remix / React Router route modules.
  /(^|\/)app\/routes\.[cm]?[jt]s$/,
  /(^|\/)app\/routes\/.+\.[jt]sx?$/,
  // TanStack Router root route, and the router TanStack Start builds on boot.
  /(^|\/)routes\/__root\.[jt]sx?$/,
  /(^|\/)src\/(?:router|start)\.[jt]sx?$/,
  // Expo Router layouts wrap every screen below them.
  /(^|\/)_layout\.[jt]sx?$/,
  /(^|\/)pages\/.+\.(?:vue|astro)$/,
  /(^|\/)pages\/(?:_app|_document)\.[jt]sx?$/,
  /(^|\/)server\/(?:api|routes|middleware)\/.+\.[cm]?[jt]s$/
];

const ENTRY_PATTERN_SCORES: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(^|\/)layout\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)app\/root\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)app\/routes\.[cm]?[jt]s$/, score: 0 },
  { pattern: /(^|\/)routes\/__root\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)_layout\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)src\/(?:router|start)\.[jt]sx?$/, score: 1 },
  { pattern: /(^|\/)app\/routes\/.+\.[jt]sx?$/, score: 2 },
  { pattern: /(^|\/)\+layout\.svelte$/, score: 0 },
  { pattern: /(^|\/)app\.vue$/, score: 0 },
  { pattern: /(^|\/)pages\/(?:_app|_document)\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)pages\/.+\.(?:vue|astro)$/, score: 1 },
  { pattern: /(^|\/)page\.[jt]sx?$/, score: 1 },
  { pattern: /(^|\/)\+page\.svelte$/, score: 1 },
  { pattern: /(^|\/)route\.[jt]s$/, score: 2 },
  { pattern: /(^|\/)\+server\.[jt]s$/, score: 2 },
  { pattern: /(^|\/)server\/(?:api|routes|middleware)\/.+\.[cm]?[jt]s$/, score: 2 },
  { pattern: /(^|\/)middleware\.[jt]s$/, score: 3 },
  { pattern: /(^|\/)hooks\.(?:server|client)\.[jt]s$/, score: 3 },
  { pattern: /(^|\/)entry\.(?:client|server)\.[jt]sx?$/, score: 3 },
  { pattern: /(^|\/)(app|server)\.[cm]?[jt]sx?$/, score: 4 },
  { pattern: /(^|\/)(index|main)\.[cm]?[jt]sx?$/, score: 5 },
];

function entryPointScore(path: string): number {
  for (const { pattern, score } of ENTRY_PATTERN_SCORES) {
    if (pattern.test(path)) return score;
  }
  return 10;
}

// Declared entries rank above guesses: a CLI's `bin` is the way in, a package's
// `main` is its public face, and a script runs the file on purpose.
const MANIFEST_SCORES: Record<ManifestEntry["kind"], number> = {
  bin: -2,
  main: -1,
  script: 6.5
};

/**
 * `manifestEntries` come from package.json (`bin`, `main`/`exports`, scripts).
 * A `main` file that another source file imports is just shared plumbing, so
 * it only counts while nothing imports it; `bin` and script entries are
 * started from outside and always count.
 */
export function detectEntryPoints(graph: FileGraph, manifestEntries: ManifestEntry[] = []): string[] {
  // Only production code counts as a consumer: a barrel that nothing but its
  // own tests imports (or a root index.ts that tests import) is still an
  // entry, while a barrel re-exported through the app is just plumbing.
  //
  // Generated files (`routeTree.gen.ts`, `*.generated.ts`) import every file
  // they index, so they would make every route look like shared plumbing.
  const imported = new Set(
    Object.entries(graph)
      .filter(([path]) => isArchitectureSource(path) && !isGeneratedFile(path))
      .flatMap(([, imports]) => imports)
  );

  const declared = new Map<string, number>();
  for (const entry of manifestEntries) {
    if (!(entry.path in graph) || !isSourceFile(entry.path) || !isArchitectureSource(entry.path)) continue;
    if (entry.kind === "main" && imported.has(entry.path)) continue;
    const score = MANIFEST_SCORES[entry.kind];
    declared.set(entry.path, Math.min(score, declared.get(entry.path) ?? score));
  }

  const scoreOf = (path: string) => declared.get(path) ?? entryPointScore(path);

  return Object.keys(graph)
    .filter((path) => isSourceFile(path))
    .filter((path) => isArchitectureSource(path) && !isGeneratedFile(path))
    .filter((path) => {
      if (declared.has(path)) return true;
      const unimportedWithImports = !imported.has(path) && (graph[path]?.length ?? 0) > 0;
      // index.* is also the conventional barrel file; it is an entry only when
      // nothing else imports it. A top-level index (index.ts, src/index.ts) is
      // the package entry even when it has no imports of its own.
      if (/(^|\/)index\.[cm]?[jt]sx?$/.test(path)) {
        return !imported.has(path) && ((graph[path]?.length ?? 0) > 0 || path.split("/").length <= 2);
      }
      return ENTRY_PATTERNS.some((pattern) => pattern.test(path))
        || (!imported.has(path) && FRAMEWORK_LOADED_PATTERNS.some((pattern) => pattern.test(path)))
        || unimportedWithImports;
    })
    .sort((a, b) => scoreOf(a) - scoreOf(b) || a.localeCompare(b))
    .slice(0, 20);
}

function isGeneratedFile(path: string): boolean {
  return /\.(?:gen|generated)\.[cm]?[jt]sx?$/.test(path);
}

function isSourceFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$|\.vue$|\.svelte$|\.astro$/.test(path);
}
