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

export type FileScope =
  | "api"
  | "ui"
  | "database"
  | "config"
  | "service"
  | "cli"
  | "test"
  | "docs"
  | "unknown";

export type FlowInfo = {
  name: string;
  purpose: string;
  type: "architecture" | "feature" | "request" | "data" | "dependency";
  entryPoint?: string;
  steps: Array<{
    label: string;
    file?: string;
    purpose?: string;
  }>;
  mermaid?: string;
  confidence: "high" | "medium" | "low";
};

export type FileIndexEntry = {
  hash: string;
  imports: string[];
  exportedSymbols: string[];
  lines: number;
  purpose?: string;
  scope: FileScope;
  featureRefs: string[];
  searchTerms: string[];
  importance: number;
};

export type ProjectMap = {
  version: string;
  generatedAt: string;
  fingerprint: string;
  projectRoot: string;
  framework: Framework;
  project: ProjectMetadata;
  stats: {
    // Schema v1 only tracks files returned by scanFiles(), after ignore filtering.
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
  flows: FlowInfo[];
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
  fileIndex: Record<string, FileIndexEntry>;
};

export async function createProjectMap(projectRoot: string): Promise<ProjectMap> {
  const files = await scanFiles(projectRoot);
  const graph = buildDependencyGraph(files);
  const references = countReferences(graph);
  const framework = detectFramework(files);
  const entryPoints = detectEntryPoints(graph);
  const routes = detectRoutes(files, framework);
  const database = detectDatabase(files);
  const features = attachFeatureEntryPoints(
    detectFeatures(files, routes, database),
    routes,
    entryPoints
  );
  const criticalFiles = rankCriticalFiles(files, references, entryPoints);
  const fileIndex = Object.fromEntries(files.map((file) => [
    file.path,
    createFileIndexEntry(file, graph[file.path] ?? [], references, entryPoints, criticalFiles, features)
  ]));

  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprint: createProjectFingerprint(files),
    projectRoot,
    framework,
    project: detectProjectMetadata(projectRoot, framework, files),
    stats: {
      // A pre-filter filesystem count is not collected in schema v1.
      totalFiles: files.length,
      relevantFiles: files.length,
      totalLines: files.reduce((sum, file) => sum + file.lines, 0)
    },
    entryPoints,
    criticalFiles,
    routes,
    apiRoutes: routes.filter((route) => route.kind === "api"),
    externalServices: detectExternalServices(files),
    ...(database ? { database } : {}),
    features,
    flows: generateMinimalFlows(features, fileIndex),
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

function createFileIndexEntry(
  file: ScannedFile,
  imports: string[],
  references: Record<string, number>,
  entryPoints: string[],
  criticalFiles: ProjectMap["criticalFiles"],
  features: FeatureInfo[]
): FileIndexEntry {
  const exportedSymbols = findExportedSymbols(file.content);
  const scope = classifyFileScope(file, exportedSymbols, imports);
  const featureRefs = features
    .filter((feature) => feature.files.includes(file.path) || feature.evidence.includes(file.path))
    .map((feature) => feature.name)
    .sort();
  const criticalFile = criticalFiles.find((item) => item.path === file.path);
  const importance = calculateImportance(
    file.path,
    references[file.path] ?? 0,
    entryPoints.includes(file.path),
    criticalFile?.score ?? 0,
    featureRefs.length
  );
  const searchTerms = buildFileSearchTerms(file.path, scope, exportedSymbols, featureRefs);
  const purpose = inferFilePurpose(file.path, scope, exportedSymbols, featureRefs);

  return {
    hash: hashContent(file.content),
    imports,
    exportedSymbols,
    lines: file.lines,
    ...(purpose ? { purpose } : {}),
    scope,
    featureRefs,
    searchTerms,
    importance
  };
}

function classifyFileScope(
  file: ScannedFile,
  exportedSymbols: string[],
  imports: string[]
): FileScope {
  const path = file.path.toLowerCase();
  const name = path.split("/").at(-1) ?? path;
  const text = `${path} ${name} ${exportedSymbols.join(" ")} ${imports.join(" ")}`.toLowerCase();

  if (isTestFile(path)) return "test";
  if (path.endsWith(".md") || path.startsWith("docs/")) return "docs";
  if (/(^|\/)(api|apis|routes?|controllers?|actions?)\//.test(path)) return "api";
  if (/(^|\/)(server|app|main|index)\.[cm]?[jt]sx?$/.test(path) && imports.some((specifier) => /routes?|controllers?|api/.test(specifier))) return "api";
  if (/(^|\/)(views?|pages?|components?|screens?|templates?|layouts?)\//.test(path)) return "ui";
  if (/(^|\/)(models?|entities|repositories|schemas?|migrations?|database|db|prisma)\//.test(path)) return "database";
  if (/(^|\/)(config|configs|settings|env)\//.test(path) || /(^|[.-])(config|settings|env)\./.test(name)) return "config";
  if (/(^|\/)(commands?|cli|bin|scripts?|console)\//.test(path)) return "cli";
  if (/(^|\/)(lib|libs|shared|utils?|helpers?|services?)\//.test(path)) return "service";
  if (/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.test(exportedSymbols.join(" "))) return "api";
  if (/\b(Component|View|Page|Layout|Screen)\b/i.test(exportedSymbols.join(" "))) return "ui";
  if (/\b(model|entity|repository|schema|migration|database|db)\b/.test(text)) return "database";
  if (/\b(command|cli|program|argv)\b/.test(text)) return "cli";
  if (/\b(service|client|provider|adapter|manager|utility|utils|helper)\b/.test(text)) return "service";

  return "unknown";
}

function calculateImportance(
  path: string,
  referencedBy: number,
  isEntryPoint: boolean,
  criticalScore: number,
  featureCount: number
): number {
  let importance = referencedBy * 10 + criticalScore * 5 + featureCount * 8;

  if (isEntryPoint) importance += 20;
  if (/(^|\/)(index|main|app|server|layout|page|route)\./.test(path)) importance += 5;

  return Math.min(100, importance);
}

function buildFileSearchTerms(
  path: string,
  scope: FileScope,
  exportedSymbols: string[],
  featureRefs: string[]
): string[] {
  const terms = new Set<string>();

  for (const part of splitSearchTerms(path)) {
    terms.add(part);
  }

  if (scope !== "unknown") {
    terms.add(scope);
  }

  for (const symbol of exportedSymbols) {
    for (const part of splitSearchTerms(symbol)) {
      terms.add(part);
    }
  }

  for (const feature of featureRefs) {
    for (const part of splitSearchTerms(feature)) {
      terms.add(part);
    }
  }

  return [...terms]
    .filter((term) => term.length > 1 && !isVagueSearchTerm(term))
    .slice(0, 12);
}

function inferFilePurpose(
  path: string,
  scope: FileScope,
  exportedSymbols: string[],
  featureRefs: string[]
): string | undefined {
  const subject = exportedSymbols[0]
    ? `exports ${exportedSymbols.slice(0, 3).join(", ")}`
    : `contains ${scope === "unknown" ? "project" : scope} code`;
  const featureText = featureRefs.length > 0
    ? ` for ${featureRefs.slice(0, 2).join(" and ")}`
    : "";

  if (scope === "docs" || scope === "test") {
    return undefined;
  }

  if (scope === "unknown" && exportedSymbols.length === 0 && featureRefs.length === 0) {
    return undefined;
  }

  return `${path} ${subject}${featureText}.`;
}

function attachFeatureEntryPoints(
  features: FeatureInfo[],
  routes: RouteInfo[],
  entryPoints: string[]
): FeatureInfo[] {
  return features.map((feature) => {
    const relatedRouteEntries = routes
      .filter((route) => feature.files.includes(route.file))
      .map((route) => route.file);
    const relatedEntries = [...new Set([
      ...feature.files.filter((file) => entryPoints.includes(file)),
      ...relatedRouteEntries
    ])].sort();

    return {
      ...feature,
      entryPoints: relatedEntries,
      confidence: feature.files.length >= 2 || relatedEntries.length > 0
        ? "high"
        : feature.confidence
    };
  });
}

function generateMinimalFlows(
  features: FeatureInfo[],
  fileIndex: Record<string, FileIndexEntry>
): FlowInfo[] {
  return features
    .filter((feature) => feature.confidence === "high" && feature.files.length > 0)
    .slice(0, 3)
    .map((feature) => {
      const steps = feature.files.slice(0, 5).map((file, index) => ({
        label: index === 0 ? `Start with ${file}` : `Review related file ${file}`,
        file,
        purpose: fileIndex[file]?.purpose
      }));

      return {
        name: `${feature.name} flow`,
        purpose: `Shows the main files related to ${feature.name.toLowerCase()}.`,
        type: "feature" as const,
        ...(feature.entryPoints[0] ? { entryPoint: feature.entryPoints[0] } : {}),
        steps,
        ...(steps.length > 3 ? { mermaid: renderMermaidFlow(steps) } : {}),
        confidence: "high" as const
      };
    });
}

function renderMermaidFlow(steps: FlowInfo["steps"]): string {
  const lines = ["graph TD"];
  steps.forEach((step, index) => {
    const node = `S${index + 1}`;
    lines.push(`  ${node}["${escapeMermaidLabel(step.file ?? step.label)}"]`);
    if (index > 0) {
      lines.push(`  S${index} --> ${node}`);
    }
  });
  return lines.join("\n");
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, "'");
}

function isTestFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.includes("/test/")
    || normalized.includes("/tests/")
    || normalized.includes("/__tests__/")
    || normalized.includes("/fixtures/")
    || normalized.endsWith(".test.ts")
    || normalized.endsWith(".test.tsx")
    || normalized.endsWith(".test.js")
    || normalized.endsWith(".test.jsx")
    || normalized.endsWith(".spec.ts")
    || normalized.endsWith(".spec.tsx")
    || normalized.endsWith(".spec.js")
    || normalized.endsWith(".spec.jsx")
  );
}

function isVagueSearchTerm(term: string): boolean {
  return new Set([
    "app",
    "data",
    "feature",
    "file",
    "handler",
    "logic",
    "page",
    "service",
    "system"
  ]).has(term);
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

function splitSearchTerms(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
