import { hashContent } from "../cache/fileHash.js";
import { detectDatabase, type DatabaseInfo } from "./databaseDetector.js";
import { buildDependencyGraph, countReferences } from "./dependencyGraph.js";
import { detectEntryPoints } from "./entryPoints.js";
import { detectFeatures, type FeatureInfo } from "./featureDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import { scanFiles } from "./fileScanner.js";
import { detectFramework, type Framework } from "./frameworkDetector.js";
import { detectProjectMetadata, type ProjectMetadata } from "./projectMetadata.js";
import { detectRoutes, type RouteInfo } from "./routeDetector.js";
import { detectExternalServices } from "./serviceDetector.js";
import { isArchitectureSource } from "./sourceScope.js";

export const SNAPSHOT_SCHEMA_VERSION = "1";

export type ProjectMap = {
  version: string;
  generatedAt: string;
  fingerprint: string;
  projectRoot: string;
  framework: Framework;
  project: ProjectMetadata;
  stats: {
    totalFiles: number;
    relevantFiles: number;
    totalLines: number;
  };
  entryPoints: string[];
  criticalFiles: Array<{
    path: string;
    referencedBy: number;
    score: number;
    reasons: string[];
  }>;
  routes: RouteInfo[];
  apiRoutes: RouteInfo[];
  externalServices: string[];
  database?: DatabaseInfo;
  features: FeatureInfo[];
  warnings?: string[];
  dependencies: Record<string, string[]>;
  ai?: {
    architecture: string;
    model: string;
    generatedAt: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
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
  const framework = detectFramework(files);
  const entryPoints = detectEntryPoints(graph);
  const routes = detectRoutes(files, framework);
  const database = detectDatabase(files);
  const fileIndex = Object.fromEntries(files.map((file) => [
    file.path,
    {
      hash: hashContent(file.content),
      imports: graph[file.path] ?? [],
      exportedSymbols: findExportedSymbols(file.content),
      lines: file.lines
    }
  ]));

  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprint: createProjectFingerprint(files),
    projectRoot,
    framework,
    project: detectProjectMetadata(projectRoot, framework, files),
    stats: {
      totalFiles: files.length,
      relevantFiles: files.length,
      totalLines: files.reduce((sum, file) => sum + file.lines, 0)
    },
    entryPoints,
    criticalFiles: rankCriticalFiles(files, references, entryPoints),
    routes,
    apiRoutes: routes.filter((route) => route.kind === "api"),
    externalServices: detectExternalServices(files),
    ...(database ? { database } : {}),
    features: detectFeatures(files, routes, database),
    warnings: detectAnalysisWarnings(files),
    dependencies: readPackageDependencies(files),
    fileIndex
  };
}

export function createProjectFingerprint(files: ScannedFile[]): string {
  const content = files
    .map((file) => [file.path, hashContent(file.content)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}:${hash}`)
    .join("\n");

  return hashContent(content);
}

function rankCriticalFiles(
  files: ScannedFile[],
  references: Record<string, number>,
  entryPoints: string[]
): ProjectMap["criticalFiles"] {
  const entryPointSet = new Set(entryPoints);

  return files
    .filter((file) =>
      isArchitectureSource(file.path) && /\.[cm]?[jt]sx?$|\.prisma$/.test(file.path)
    )
    .map((file) => {
      const referencedBy = references[file.path] ?? 0;
      const reasons: string[] = [];
      let score = referencedBy * 3;

      if (referencedBy > 0) {
        reasons.push(`imported by ${referencedBy} file${referencedBy === 1 ? "" : "s"}`);
      }

      if (entryPointSet.has(file.path)) {
        score += 4;
        reasons.push("application entry point");
      }

      if (/(^|\/)(auth|session|db|database|middleware|schema|config)([./-]|$)/i.test(file.path)) {
        score += 3;
        reasons.push("core project concern");
      }

      if (/(^|\/)(page|layout|route|server|app|main|index)\.[cm]?[jt]sx?$/.test(file.path)) {
        score += 2;
        reasons.push("framework convention");
      }

      return { path: file.path, referencedBy, score, reasons };
    })
    .filter((file) => file.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 10);
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

function detectAnalysisWarnings(files: ScannedFile[]): string[] {
  const packageJson = files.find((file) => file.path === "package.json");
  if (!packageJson) {
    return [];
  }

  try {
    JSON.parse(packageJson.content);
    return [];
  } catch {
    return [
      "package.json could not be parsed. Dependency-based detection may be incomplete."
    ];
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
