import type { FileAnalysis, ScannedFile } from "../analysis/index.js";
import type { AliasMapping } from "./aliasResolver.js";
import { isDeclaredAlias, resolveAliasCandidates } from "./aliasResolver.js";
import { matchLocalPath, normalizePath } from "./localPaths.js";
import { addNuxtAutoImportEdges } from "./nuxtAutoImports.js";
import {
  indexPackages,
  readPackageManifests,
  resolveSubpathImport,
  resolveWorkspaceSpecifier
} from "./packageManifests.js";

export type FileGraph = Record<string, string[]>;

export interface DependencyGraphDiagnostics {
  unresolvedAliases: Array<{ file: string; specifier: string }>;
  parserFallbacks: string[];
}

// Static imports, re-exports, require() and dynamic import() with a literal.
const IMPORT_RE = /(?:\bimport\s+(?:[^'"]+\s+from\s+)?|\bexport\s+[^'"]+\s+from\s+|\b(?:require|import)\s*\(\s*)['"]([^'"]+)['"]/g;

export function buildDependencyGraph(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis> = {},
  aliasMappings: AliasMapping[] = []
): { graph: FileGraph; diagnostics: DependencyGraphDiagnostics } {
  const graph: FileGraph = {};
  const localPaths = new Set(files.map((file) => file.path));
  const packages = indexPackages(readPackageManifests(files));
  const diagnostics: DependencyGraphDiagnostics = {
    unresolvedAliases: [],
    parserFallbacks: [],
  };

  for (const file of files) {
    // A file importing the same module twice (`import type` + value import,
    // or a static and a dynamic import) is still one dependency edge.
    const edges = new Set<string>();

    const importSpecifiers = analyses[file.path]?.imports ?? findImportSpecifiers(file.content);
    for (const rawSpecifier of importSpecifiers) {
      // Bundler suffixes (`./icon.svg?react`, `./worker.ts?worker`) are not
      // part of the file name.
      const specifier = stripQuery(rawSpecifier);

      if (specifier.startsWith(".")) {
        const resolved = resolveImport(file.path, specifier, localPaths);
        if (resolved && resolved !== file.path) {
          edges.add(resolved);
        }
        continue;
      }

      // package.json "imports": `#internal/db` is local by definition. Other
      // `#` specifiers (Nuxt's `#shared/...`) are aliases and fall through.
      if (specifier.startsWith("#")) {
        const resolved = resolveSubpathImport(specifier, file.path, packages, localPaths);
        if (resolved) {
          if (resolved !== file.path) edges.add(resolved);
          continue;
        }
      }

      // Try alias resolution for non-relative imports
      const candidates = resolveAliasCandidates(specifier, aliasMappings, file.path);
      const aliasResolved = candidates.length > 0 ? firstResolved(candidates, localPaths) : null;
      if (aliasResolved) {
        if (aliasResolved !== file.path) edges.add(aliasResolved);
        continue;
      }

      // A package that lives in this repo (workspace member): import by name.
      const workspaceResolved = resolveWorkspaceSpecifier(specifier, packages, localPaths);
      if (workspaceResolved) {
        if (workspaceResolved !== file.path) edges.add(workspaceResolved);
        continue;
      }

      if (candidates.length > 0) {
        if (isDeclaredAlias(specifier, aliasMappings, file.path)) {
          diagnostics.unresolvedAliases.push({ file: file.path, specifier });
        }
      } else if (file.path.endsWith(".py")) {
        const resolved = resolvePythonModule(specifier, localPaths);
        if (resolved && resolved !== file.path) edges.add(resolved);
      }
      // Non-relative, non-alias imports are silently skipped (npm packages etc.)
    }

    graph[file.path] = [...edges];

    if (!analyses[file.path]) {
      diagnostics.parserFallbacks.push(file.path);
    }
  }

  // Frameworks that connect files without import statements.
  addNuxtAutoImportEdges(graph, files, analyses);

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

function stripQuery(specifier: string): string {
  const query = specifier.indexOf("?");
  return query === -1 ? specifier : specifier.slice(0, query);
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
  return normalized === null ? null : matchLocalPath(normalized, localPaths);
}

// `from app.models import User` -> app/models.py or app/models/__init__.py,
// looked up from the project root and from a conventional src/ layout.
function resolvePythonModule(specifier: string, localPaths: Set<string>): string | null {
  if (!/^[A-Za-z_][\w.]*$/.test(specifier)) return null;
  const modulePath = specifier.replace(/\./g, "/");

  for (const base of ["", "src/"]) {
    for (const candidate of [`${base}${modulePath}.py`, `${base}${modulePath}/__init__.py`]) {
      if (localPaths.has(candidate)) return candidate;
    }
  }
  return null;
}

function firstResolved(rootRelativePaths: string[], localPaths: Set<string>): string | null {
  for (const rootRelativePath of rootRelativePaths) {
    const normalized = normalizePath(rootRelativePath);
    if (normalized === null) continue;
    const resolved = matchLocalPath(normalized, localPaths);
    if (resolved) return resolved;
  }
  return null;
}
