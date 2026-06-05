import type { FileGraph } from "./dependencyGraph.js";

const ENTRY_PATTERNS = [
  /(^|\/)page\.[jt]sx?$/,
  /(^|\/)layout\.[jt]sx?$/,
  /(^|\/)middleware\.[jt]s$/,
  /(^|\/)(server|app|index|main)\.[cm]?[jt]s$/,
  /(^|\/)route\.[jt]s$/
];

export function detectEntryPoints(graph: FileGraph): string[] {
  const imported = new Set(Object.values(graph).flat());

  return Object.keys(graph)
    .filter((path) => isSourceFile(path))
    .filter((path) => ENTRY_PATTERNS.some((pattern) => pattern.test(path)) || (!imported.has(path) && (graph[path]?.length ?? 0) > 0))
    .slice(0, 20);
}

function isSourceFile(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path);
}
