import type { FileGraph } from "./dependencyGraph.js";
import { isArchitectureSource } from "./sourceScope.js";

const ENTRY_PATTERNS = [
  /(^|\/)page\.[jt]sx?$/,
  /(^|\/)layout\.[jt]sx?$/,
  /(^|\/)middleware\.[jt]s$/,
  /(^|\/)(server|app|index|main)\.[cm]?[jt]sx?$/,
  /(^|\/)route\.[jt]s$/
];

const ENTRY_PATTERN_SCORES: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(^|\/)layout\.[jt]sx?$/, score: 0 },
  { pattern: /(^|\/)page\.[jt]sx?$/, score: 1 },
  { pattern: /(^|\/)route\.[jt]s$/, score: 2 },
  { pattern: /(^|\/)middleware\.[jt]s$/, score: 3 },
  { pattern: /(^|\/)(app|server)\.[cm]?[jt]sx?$/, score: 4 },
  { pattern: /(^|\/)(index|main)\.[cm]?[jt]sx?$/, score: 5 },
];

function entryPointScore(path: string): number {
  for (const { pattern, score } of ENTRY_PATTERN_SCORES) {
    if (pattern.test(path)) return score;
  }
  return 10;
}

export function detectEntryPoints(graph: FileGraph): string[] {
  const imported = new Set(Object.values(graph).flat());

  return Object.keys(graph)
    .filter((path) => isSourceFile(path))
    .filter((path) => isArchitectureSource(path))
    .filter((path) => ENTRY_PATTERNS.some((pattern) => pattern.test(path)) || (!imported.has(path) && (graph[path]?.length ?? 0) > 0))
    .sort((a, b) => entryPointScore(a) - entryPointScore(b) || a.localeCompare(b))
    .slice(0, 20);
}

function isSourceFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$|\.vue$|\.svelte$|\.astro$/.test(path);
}
