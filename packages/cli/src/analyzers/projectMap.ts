import { hashContent } from "../cache/fileHash.js";
import { buildDependencyGraph, countReferences } from "./dependencyGraph.js";
import { detectEntryPoints } from "./entryPoints.js";
import type { ScannedFile } from "./fileScanner.js";
import { scanFiles } from "./fileScanner.js";
import { detectFramework, type Framework } from "./frameworkDetector.js";
import { detectExternalServices } from "./serviceDetector.js";

export type ProjectMap = {
  generatedAt: string;
  projectRoot: string;
  framework: Framework;
  stats: {
    totalFiles: number;
    relevantFiles: number;
    totalLines: number;
  };
  entryPoints: string[];
  criticalFiles: Array<{ path: string; referencedBy: number }>;
  externalServices: string[];
  dependencies: Record<string, string[]>;
  fileIndex: Record<string, {
    hash: string;
    imports: string[];
    exportedSymbols: string[];
    lines: number;
  }>;
};

export async function createProjectMap(projectRoot: string): Promise<ProjectMap> {
  const files = await scanFiles(projectRoot);
  const graph = buildDependencyGraph(files);
  const references = countReferences(graph);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    framework: detectFramework(files),
    stats: {
      totalFiles: files.length,
      relevantFiles: files.length,
      totalLines: files.reduce((sum, file) => sum + file.lines, 0)
    },
    entryPoints: detectEntryPoints(graph),
    criticalFiles: Object.entries(references)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 10)
      .map(([path, referencedBy]) => ({ path, referencedBy })),
    externalServices: detectExternalServices(files),
    dependencies: readPackageDependencies(files),
    fileIndex: Object.fromEntries(files.map((file) => [
      file.path,
      {
        hash: hashContent(file.content),
        imports: graph[file.path] ?? [],
        exportedSymbols: findExportedSymbols(file.content),
        lines: file.lines
      }
    ]))
  };
}

function readPackageDependencies(files: ScannedFile[]): Record<string, string[]> {
  const packageJson = files.find((file) => file.path === "package.json");
  if (!packageJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(packageJson.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      dependencies: Object.keys(parsed.dependencies ?? {}).sort(),
      devDependencies: Object.keys(parsed.devDependencies ?? {}).sort()
    };
  } catch {
    return {};
  }
}

function findExportedSymbols(content: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
    /export\s+type\s+([A-Za-z0-9_]+)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      symbols.add(match[1]);
      match = pattern.exec(content);
    }
  }

  return [...symbols].sort();
}
