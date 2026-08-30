import type { FileAnalysis, ScannedFile } from "../analysis/index.js";
import type { AliasMapping } from "./aliasResolver.js";
import { resolveAlias } from "./aliasResolver.js";

export type FileGraph = Record<string, string[]>;

export interface DependencyGraphDiagnostics {
  unresolvedAliases: Array<{ file: string; specifier: string }>;
  parserFallbacks: string[];
}

const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+[^'"]+\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;

export function buildDependencyGraph(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis> = {},
  aliasMappings: AliasMapping[] = []
): { graph: FileGraph; diagnostics: DependencyGraphDiagnostics } {
  const graph: FileGraph = {};
  const localPaths = new Set(files.map((file) => file.path));
  const diagnostics: DependencyGraphDiagnostics = {
    unresolvedAliases: [],
    parserFallbacks: [],
  };

  for (const file of files) {
    graph[file.path] = [];

    const importSpecifiers = analyses[file.path]?.imports ?? findImportSpecifiers(file.content);
    for (const specifier of importSpecifiers) {
      if (specifier.startsWith(".")) {
        const resolved = resolveImport(file.path, specifier, localPaths);
        if (resolved) {
          graph[file.path].push(resolved);
        }
        continue;
      }

      // Try alias resolution for non-relative imports
      const aliasResolved = resolveAlias(specifier, aliasMappings);
      if (aliasResolved) {
        const resolved = resolveAliasPath(aliasResolved, localPaths);
        if (resolved) {
          graph[file.path].push(resolved);
        } else {
          diagnostics.unresolvedAliases.push({ file: file.path, specifier });
        }
      }
      // Non-relative, non-alias imports are silently skipped (npm packages etc.)
    }

    if (!analyses[file.path]) {
      diagnostics.parserFallbacks.push(file.path);
    }
  }

  return { graph, diagnostics };
}

export function countReferences(graph: FileGraph): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const imports of Object.values(graph)) {
    for (const imported of imports) {
      counts[imported] = (counts[imported] ?? 0) + 1;
    }
  }

  return counts;
}

function findImportSpecifiers(content: string): string[] {
  const matches: string[] = [];
  IMPORT_RE.lastIndex = 0;

  let match = IMPORT_RE.exec(content);
  while (match) {
    matches.push(match[1]);
    match = IMPORT_RE.exec(content);
  }

  return matches;
}

function resolveImport(fromPath: string, specifier: string, localPaths: Set<string>): string | null {
  const baseParts = fromPath.split("/");
  baseParts.pop();
  const normalized = normalizePath([...baseParts, specifier].join("/"));
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}.vue`,
    `${normalized}.svelte`,
    `${normalized}.astro`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
    `${normalized}/index.jsx`,
    `${normalized}/index.vue`,
    `${normalized}/index.svelte`,
    `${normalized}/index.astro`
  ];

  if (normalized.endsWith(".js")) {
    const withoutExtension = normalized.slice(0, -3);
    candidates.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  }
  if (normalized.endsWith(".mjs")) {
    candidates.push(`${normalized.slice(0, -4)}.mts`);
  }
  if (normalized.endsWith(".cjs")) {
    candidates.push(`${normalized.slice(0, -4)}.cts`);
  }

  return candidates.find((candidate) => localPaths.has(candidate)) ?? null;
}

function resolveAliasPath(rootRelativePath: string, localPaths: Set<string>): string | null {
  const normalized = normalizePath(rootRelativePath);
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}.vue`,
    `${normalized}.svelte`,
    `${normalized}.astro`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
    `${normalized}/index.jsx`,
    `${normalized}/index.vue`,
    `${normalized}/index.svelte`,
    `${normalized}/index.astro`
  ];

  if (normalized.endsWith(".js")) {
    const withoutExtension = normalized.slice(0, -3);
    candidates.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  }

  return candidates.find((candidate) => localPaths.has(candidate)) ?? null;
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "." || part === "") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}
