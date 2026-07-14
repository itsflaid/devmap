import { hashContent } from "../../cache/fileHash.js";
import { analyzeFiles } from "./analyzerRegistry.js";
import { detectProjectMetadata, type ProjectMetadata } from "./projectMetadata.js";
import {
  detectDatabase, type DatabaseInfo,
  detectFramework, detectFrameworks, type Framework,
  detectRoutes, type RouteInfo,
  detectExternalServices,
  detectCapabilities, type CapabilityInfo,
} from "../detectors/index.js";
import {
  buildDependencyGraph, countReferences,
  detectEntryPoints,
  isArchitectureSource,
} from "../graph/index.js";
import {
  authenticationFilePriority,
  detectAuthenticationSemanticRole,
  detectFeatures,
  orderAuthenticationFiles,
  mergeDomainFeatures,
  classifyFileTier,
  type FeatureInfo,
} from "../features/index.js";
import {
  scanFiles,
  extractEntities,
  type ScannedFile,
  type EntityGraph,
  type FileAnalysis,
  type SymbolInfo,
} from "../analysis/index.js";
import {
  inferDomain,
  buildDomainInferenceInput,
  domainFeaturesToFeatureInfo,
  type DomainInferenceResult,
} from "../inference/index.js";

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
  analyzer: string;
  analysisConfidence: "high" | "medium" | "low";
  hash: string;
  imports: string[];
  exportedSymbols: string[];
  symbols: SymbolInfo[];
  topFunctions: Array<{
    name: string;
    kind: "function" | "const" | "class" | "method";
    line: number;
    exported: boolean;
    async: boolean;
  }>;
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
  agentInstructions: {
    navigationPolicy: "index-first";
    defaultMode: "feature-map-first";
    maxInitialFiles: number;
    missingSnapshotAction: "run-devmap-analyze";
    staleSnapshotAction: "run-devmap-analyze-fresh";
    fallbackRule: string;
  };
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
  entityGraph?: EntityGraph;
  capabilities?: CapabilityInfo[];
  /** AI-inferred domain understanding — present kalau AI inference berhasil */
  domain?: DomainInferenceResult;
  flows: FlowInfo[];
  onboarding: {
    recommendedPath: string[];
  };
  changeImpact: Record<string, {
    impacts: string[];
    dependents: string[];
  }>;
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

export async function createProjectMap(
  projectRoot: string,
  /**
   * Optional AI caller — kalau disediakan, domain inference (Step 5) akan dijalankan.
   * Kalau tidak ada, hanya static analysis yang jalan.
   * Injected biar decoupled dari provider specifics (Groq, OpenRouter, dll).
   */
  callAI?: (prompt: string) => Promise<string>
): Promise<ProjectMap> {
  const files = await scanFiles(projectRoot);
  const analyses = await analyzeFiles(files);
  const graph = buildDependencyGraph(files, analyses);
  const references = countReferences(graph);
  const detectedFramework = detectFramework(files);
  const frameworks = detectFrameworks(files);
  const project = detectProjectMetadata(
    projectRoot,
    detectedFramework,
    files,
    frameworks
  );
  const framework = project.framework;
  const entryPoints = detectEntryPoints(graph);
  const routes = detectRoutes(files, framework);
  const database = detectDatabase(files);

  // Step 1: Extract entities dari schema (Prisma dll) atau route fallback
  const entityGraph = extractEntities(files, routes);

  // Step 2: Detect capabilities dari route patterns + HTTP methods
  const capabilities = detectCapabilities(routes, entityGraph);

  // Step 3: Detect features — consume entityGraph + capabilities
  const features = attachFeatureEntryPoints(
    detectFeatures(files, analyses, routes, database, entityGraph, capabilities),
    routes,
    entryPoints,
    graph,
    analyses
  );
  // Step 4: AI domain inference (optional — hanya jalan kalau callAI disediakan)
  // Kirim structured metadata ke AI, dapat domain summary + domain-specific features.
  // Kalau gagal atau callAI tidak ada, static features tetap lengkap.
  let domain: DomainInferenceResult | undefined;
  if (callAI) {
    const inferenceInput = buildDomainInferenceInput(
      entityGraph,
      capabilities,
      features,
      framework,
      routes.length
    );
    const result = await inferDomain(inferenceInput, callAI);
    if (result) {
      domain = result;
      // Merge domain-specific features ke features list.
      // Pakai similarity engine — bukan name equality — sehingga
      // "Customizable Plans" tidak duplicate "Plan Management" yang sudah ada.
      // Canonical name (first-seen) dipertahankan oleh mergeDomainFeatures.
      const domainFeatures = domainFeaturesToFeatureInfo(result.domainFeatures);
      mergeDomainFeatures(features, domainFeatures);
      features.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const criticalFiles = rankCriticalFiles(files, analyses, references, entryPoints);
  const fileIndex = Object.fromEntries(files.map((file) => [
    file.path,
    createFileIndexEntry(
      file,
      analyses[file.path],
      graph[file.path] ?? [],
      references,
      entryPoints,
      criticalFiles,
      features
    )
  ]));

  const flows = generateMinimalFlows(features, fileIndex, routes, graph);

  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    agentInstructions: createAgentInstructions(),
    fingerprint: createProjectFingerprint(files),
    projectRoot,
    framework,
    project,
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
    ...(entityGraph.source !== "empty" ? { entityGraph } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(domain ? { domain } : {}),
    flows,
    onboarding: {
      recommendedPath: buildOnboardingPath(files, entryPoints, criticalFiles, fileIndex)
    },
    changeImpact: buildChangeImpact(fileIndex, features, flows, graph),
    warnings: detectAnalysisWarnings(files),
    dependencies: readPackageDependencies(files),
    fileIndex
  };
}

function createAgentInstructions(): ProjectMap["agentInstructions"] {
  return {
    navigationPolicy: "index-first",
    defaultMode: "feature-map-first",
    maxInitialFiles: 3,
    missingSnapshotAction: "run-devmap-analyze",
    staleSnapshotAction: "run-devmap-analyze-fresh",
    fallbackRule: "Read snapshot.json only when index.json and feature maps are insufficient; inspect extra source only when exact implementation is required."
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
  analyses: Record<string, FileAnalysis>,
  references: Record<string, number>,
  entryPoints: string[]
): ProjectMap["criticalFiles"] {
  const entryPointSet = new Set(entryPoints);

  return files
    .filter((file) =>
      isArchitectureSource(file.path) && /\.[cm]?[jt]sx?$|\.prisma$/.test(file.path)
    )
    .filter((file) => classifyFileTier(file.path) !== "excluded")
    .map((file) => {
      const referencedBy = references[file.path] ?? 0;
      const reasons: string[] = [];
      let score = referencedBy * 3;

      if (referencedBy > 0) {
        reasons.push(`imported by ${referencedBy} file${referencedBy === 1 ? "" : "s"}`);
      }

      if (entryPointSet.has(file.path)) {
        score += 12;
        reasons.push("application entry point");
      }

      const executionBonus = calculateExecutionResponsibilityBonus(file.path);
      if (executionBonus > 0) {
        score += executionBonus;
        reasons.push("core execution responsibility");
      }

      if (/(^|\/)(types?|constants?)\.[cm]?[jt]sx?$/.test(file.path)) {
        score = Math.max(0, score - 8);
      }

      if (/(^|\/)(auth|session|db|database|middleware|schema|config)([./-]|$)/i.test(file.path)) {
        score += 3;
        reasons.push("core project concern");
      }

      const semanticBonus = calculateCriticalSemanticBonus(file, analyses[file.path]);
      if (semanticBonus > 0) {
        score += semanticBonus;
        reasons.push("semantic feature anchor");
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

function calculateExecutionResponsibilityBonus(path: string): number {
  return /(^|\/)(projectmap|filescanner|analyzerregistry|router|controller|orchestrator|engine)\.[cm]?[jt]sx?$/i.test(path)
    || /(^|\/)commands?\/[^/]+\.[cm]?[jt]sx?$/i.test(path)
    ? 16
    : 0;
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
  analysis: FileAnalysis,
  imports: string[],
  references: Record<string, number>,
  entryPoints: string[],
  criticalFiles: ProjectMap["criticalFiles"],
  features: FeatureInfo[]
): FileIndexEntry {
  const topFunctions = analysis.topFunctions;
  const exportedSymbols = analysis.exports;
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
    featureRefs,
    scope,
    exportedSymbols,
    topFunctions
  );
  const searchTerms = buildFileSearchTerms(file.path, scope, exportedSymbols, topFunctions, featureRefs);
  const purpose = inferFilePurpose(file.path, scope, featureRefs);

  return {
    analyzer: analysis.analyzer,
    analysisConfidence: analysis.confidence,
    hash: hashContent(file.content),
    imports,
    exportedSymbols,
    symbols: analysis.symbols,
    topFunctions,
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
  if (/(^|\/)(commands?|cli|bin|scripts?|console)\//.test(path)) return "cli";
  if (/(^|\/)(config|configs|settings|env)\//.test(path) || /(^|[.-])(config|settings|env)\./.test(name)) return "config";
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
  featureRefs: string[],
  scope: FileScope,
  exportedSymbols: string[],
  topFunctions: FileIndexEntry["topFunctions"]
): number {
  let importance = referencedBy * 10 + criticalScore * 5 + featureRefs.length * 8;

  if (isEntryPoint) importance += 20;
  if (/(^|\/)(index|main|app|server|layout|page|route)\./.test(path)) importance += 5;
  if (scope !== "test" && scope !== "docs") {
    importance += calculateSemanticImportanceBonus(path, exportedSymbols, topFunctions, featureRefs);
  }

  return Math.min(100, importance);
}

function calculateSemanticImportanceBonus(
  path: string,
  exportedSymbols: string[],
  topFunctions: FileIndexEntry["topFunctions"],
  featureRefs: string[]
): number {
  const role = detectAuthenticationSemanticRole(
    path,
    [...exportedSymbols, ...topFunctions.map((item) => item.name)],
    []
  );
  if (role === "auth-config") return 70;
  if (role === "guard") return 60;
  if (role === "provider") return 45;
  if (role === "consumer") return 35;
  if (isFeatureConfigFile(path, featureRefs)) return 30;
  return featureRefs.length > 0 ? 20 : 0;
}

function calculateCriticalSemanticBonus(file: ScannedFile, analysis: FileAnalysis): number {
  const role = detectAuthenticationSemanticRole(
    file.path,
    [...analysis.exports, ...analysis.symbols.map((item) => item.name)],
    analysis.imports,
    file.content
  );

  if (role === "auth-config") return 50;
  if (role === "guard") return 40;
  if (role === "provider") return 35;
  if (role === "consumer") return 25;
  return 0;
}

function buildFileSearchTerms(
  path: string,
  scope: FileScope,
  exportedSymbols: string[],
  topFunctions: FileIndexEntry["topFunctions"],
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

  for (const item of topFunctions) {
    for (const part of splitSearchTerms(item.name)) {
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
  featureRefs: string[]
): string | undefined {
  if (scope === "docs" || scope === "test") {
    return undefined;
  }

  const normalized = path.toLowerCase();
  const knownPurpose = inferKnownFilePurpose(normalized);
  if (knownPurpose) {
    return `${path} ${knownPurpose}`;
  }

  if (scope === "unknown" && featureRefs.length === 0) {
    return undefined;
  }

  const fileName = path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "file";
  const responsibility = splitSearchTerms(fileName).join(" ") || fileName.toLowerCase();
  const featureText = featureRefs.length > 0
    ? ` for ${featureRefs.slice(0, 2).join(" and ")}`
    : "";
  const scopeText = scope === "unknown" ? "project" : scope;
  return `${path} implements ${responsibility} ${scopeText} responsibilities${featureText}.`;
}

function inferKnownFilePurpose(path: string): string | undefined {
  if (/\/ai\/provider\.[cm]?[jt]s$/.test(path)) {
    return "selects the configured AI provider and resolves model routing for AI-powered commands.";
  }
  if (/\/ai\/groq\.[cm]?[jt]s$/.test(path)) {
    return "implements Groq requests, retries, streaming, and provider-specific errors.";
  }
  if (/\/ai\/openrouter\.[cm]?[jt]s$/.test(path)) {
    return "implements OpenRouter requests, model selection, streaming, and provider-specific errors.";
  }
  if (/\/ai\/contextbuilder\.[cm]?[jt]s$/.test(path)) {
    return "selects and bounds repository context before an AI request.";
  }
  if (/\/ai\/prompts\.[cm]?[jt]s$/.test(path)) {
    return "constructs grounded prompts from snapshot and retrieval context.";
  }
  if (/\/ai\/completion\.[cm]?[jt]s$/.test(path)) {
    return "coordinates streaming and non-streaming AI completion output.";
  }
  if (/\/analyzers\/projectmap\.[cm]?[jt]s$/.test(path)) {
    return "orchestrates scanning, analysis, feature mapping, flows, and snapshot metadata.";
  }
  if (/\/analyzers\/filescanner\.[cm]?[jt]s$/.test(path)) {
    return "scans eligible project files while applying ignore and safety rules.";
  }
  if (/(^|\/)types?\.[cm]?[jt]s$/.test(path)) {
    return "defines shared type contracts used by neighboring modules.";
  }
  return undefined;
}

function isFeatureConfigFile(path: string, featureRefs: string[]): boolean {
  return featureRefs.length > 0
    && /(^|\/)src\/(lib|utils)\/(config|constants)\.[cm]?[jt]sx?$/.test(path.toLowerCase());
}

function attachFeatureEntryPoints(
  features: FeatureInfo[],
  routes: RouteInfo[],
  entryPoints: string[],
  graph: Record<string, string[]>,
  analyses?: Record<string, FileAnalysis>
): FeatureInfo[] {
  return features.map((feature) => {
    const relatedRouteEntries = routes
      .filter((route) => feature.files.includes(route.file))
      .map((route) => route.file);
    const relatedEntries = [...new Set([
      ...feature.files.filter((file) => entryPoints.includes(file)),
      ...relatedRouteEntries
    ])].sort();
    const orderedFiles = feature.name === "Authentication"
      ? orderAuthenticationFiles(feature.files)
      : feature.files;
    const entryPoint = chooseFeatureEntryPoint(feature.name, orderedFiles, relatedEntries, routes, graph);
    const businessFlow = buildFeatureBusinessFlow(feature.name, entryPoint, graph, orderedFiles);
    const hasHighQualityEvidence = analyses
      ? feature.evidence.some((path) => analyses[path]?.confidence === "high")
      : false;

    return {
      ...feature,
      files: orderedFiles,
      ...(entryPoint ? { entryPoint } : {}),
      entryPoints: relatedEntries,
      businessFlow,
      confidence: hasHighQualityEvidence && (feature.files.length >= 2 || relatedEntries.length > 0)
        ? "high"
        : feature.confidence
    };
  });
}

function chooseFeatureEntryPoint(
  featureName: string,
  files: string[],
  relatedEntries: string[],
  routes: RouteInfo[],
  graph: Record<string, string[]>
): string | undefined {
  if (featureName === "Authentication") {
    const apiEntry = relatedEntries.find((file) => /(^|\/)api\//.test(file));
    if (apiEntry) {
      return apiEntry;
    }

    const authConfig = files.find((file) => authenticationFilePriority(file) === 20);
    if (authConfig) {
      return authConfig;
    }
  }

  if (relatedEntries.length > 0) {
    return relatedEntries[0];
  }

  const route = routes.find((candidate) =>
    files.includes(candidate.file)
    || (graph[candidate.file] ?? []).some((dependency) => files.includes(dependency))
  );

  if (route) {
    return route.file;
  }

  return files[0];
}

function buildFeatureBusinessFlow(
  featureName: string,
  entryPoint: string | undefined,
  graph: Record<string, string[]>,
  featureFiles: string[]
): string[] {
  const structuralFlow = buildStructuralFeatureFlow(featureName, Object.keys(graph));
  if (structuralFlow.length > 0) {
    return structuralFlow;
  }

  if (featureName === "Authentication" && featureFiles.length > 0) {
    const orderedFiles = entryPoint
      ? [entryPoint, ...featureFiles.filter((file) => file !== entryPoint)]
      : featureFiles;

    return orderedFiles.slice(0, 8).map((file) =>
      file === entryPoint && /(^|\/)api\//.test(file)
        ? `Start at ${file}.`
        : describeAuthenticationFlowStep(file, graph[file] ?? [])
    );
  }

  if (!entryPoint) {
    return [`Identify files related to ${featureName}.`];
  }

  const chain = collectFlowFiles(entryPoint, graph);
  const steps = [`Start at ${entryPoint}.`];

  for (const file of chain.slice(1, 4)) {
    steps.push(`Follow dependency ${file}.`);
  }

  return steps;
}

/**
 * buildStructuralFeatureFlow — build human-readable flow steps untuk sebuah feature.
 *
 * Generic by design — bekerja untuk project apapun berdasarkan:
 * 1. FileRole classification — detect architectural layers dari file paths
 * 2. Naming conventions — common patterns yang berlaku cross-domain
 *
 * Sebelumnya hardcode DevMap-specific paths (Analysis Engine, Snapshot Engine).
 * Sekarang derive flow dari actual files yang ditemukan di project.
 */
function buildStructuralFeatureFlow(featureName: string, files: string[]): string[] {
  const find = (...patterns: RegExp[]) =>
    files.find((file) => patterns.some((p) => p.test(file.toLowerCase())));

  const steps: Array<[string, string | undefined]> = [];

  // --- Authentication flow (special case, high value) ---
  if (featureName === "Authentication") {
    steps.push(
      ["Guard protected routes", find(/middleware\.[cm]?[jt]sx?$/, /proxy\.[cm]?[jt]sx?$/)],
      ["Configure auth provider", find(/\/auth\.[cm]?[jt]sx?$/, /\/auth\/config/)],
      ["Handle login", find(/login.*route\.[cm]?[jt]s$/, /\/api\/auth\/.*sign/)],
      ["Handle registration", find(/register.*route\.[cm]?[jt]s$/, /\/api\/auth\/register/)],
      ["Expose session context", find(/provider.*\.[cm]?[jt]sx?$/, /session.*provider/)],
    );
  }

  // --- API layer flow ---
  else if (featureName === "API Layer") {
    steps.push(
      ["Receive and validate request", find(/\/(routes?|controllers?|handlers?)\//)],
      ["Apply business logic", find(/\/(services?|usecases?|domain)\//)],
      ["Access data layer", find(/\/(repositories?|lib\/prisma|lib\/db)/)],
      ["Return response", find(/\/(routes?|controllers?|handlers?)\//)],
    );
  }

  // --- Service layer flow ---
  else if (featureName === "Service Layer") {
    steps.push(
      ["Entry via service interface", find(/\/(services?|usecases?)\//)],
      ["Validate business rules", find(/\/(validators?|schemas?|dto)\//)],
      ["Persist via data layer", find(/\/(repositories?|lib\/prisma|lib\/db)/)],
    );
  }

  // --- CLI Commands flow ---
  else if (featureName === "CLI Commands") {
    steps.push(
      ["Parse and dispatch command", find(/\/(src\/)?index\.[cm]?[jt]s$/, /\/bin\//)],
      ["Execute command handler", find(/\/(commands?|cli)\//)],
      ["Render output", find(/\/(output|reporter|formatter|render)\.[cm]?[jt]s$/)],
    );
  }

  // --- AI Integration flow ---
  else if (featureName === "AI Integration") {
    steps.push(
      ["Build context", find(/\/(context|contextbuilder)\.[cm]?[jt]s$/)],
      ["Construct prompt", find(/\/(prompt|prompts)\.[cm]?[jt]s$/)],
      ["Call AI provider", find(/\/(openai|groq|anthropic|gemini|provider)\.[cm]?[jt]s$/)],
      ["Process completion", find(/\/(completion|response|stream)\.[cm]?[jt]s$/)],
    );
  }

  // --- Generic CRUD flow — berlaku buat Snippet Management, Order Management, dll ---
  else {
    // Extract entity name dari feature name (e.g. "Snippet Management" → "snippet")
    const entitySlug = featureName
      .toLowerCase()
      .replace(/\s+(management|system|module|feature)$/, "")
      .replace(/\s+/g, "[-_]?");

    const entityPattern = new RegExp(`\/${entitySlug}`, "i");

    steps.push(
      ["Handle API request", find(entityPattern, /\/(routes?|controllers?|api)\//i)],
      ["Apply business logic", find(/\/(services?|usecases?|actions?)\//i)],
      ["Access data", find(/\/(repositories?|lib\/prisma|db\/)\//i)],
    );
  }

  return steps
    .filter((step): step is [string, string] => Boolean(step[1]))
    .map(([action, file]) => `${action} in ${file}.`);
}

function describeAuthenticationFlowStep(file: string, dependencies: string[]): string {
  const normalized = file.toLowerCase();
  const dependencyText = dependencies.length > 0
    ? ` and connects to ${dependencies.slice(0, 2).join(", ")}`
    : "";

  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Guard requests in ${file} by checking authentication state before protected routes${dependencyText}.`;
  }
  if (/(^|\/)(src\/)?auth\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Configure authentication in ${file}, including providers, session/JWT callbacks, and shared auth helpers${dependencyText}.`;
  }
  if (/register.*\/route\.[cm]?[jt]s$|\/api\/.*register/.test(normalized)) {
    return `Handle registration in ${file}, validating new users before creating credentials${dependencyText}.`;
  }
  if (/login.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Render login UI in ${file} and submit credentials to the auth provider${dependencyText}.`;
  }
  if (/register.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Render registration UI in ${file} and collect account creation details${dependencyText}.`;
  }
  if (/providers?\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Expose session context in ${file} so client components can read authentication state${dependencyText}.`;
  }
  if (/(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalized)) {
    return `Consume session state in ${file} for authenticated layouts, user navigation, or sign-out behavior${dependencyText}.`;
  }

  return `Review authentication-related behavior in ${file}${dependencyText}.`;
}

function generateMinimalFlows(
  features: FeatureInfo[],
  fileIndex: Record<string, FileIndexEntry>,
  routes: RouteInfo[],
  graph: Record<string, string[]>
): FlowInfo[] {
  return [
    ...generateFeatureFlows(features, fileIndex),
    ...generateRequestFlows(routes, fileIndex, graph)
  ];
}

function generateFeatureFlows(
  features: FeatureInfo[],
  fileIndex: Record<string, FileIndexEntry>
): FlowInfo[] {
  return features
    .filter((feature) =>
      feature.confidence === "high"
      && feature.businessFlow.length > 1
      && !feature.businessFlow.some((step) => /^Identify files related to /i.test(step))
    )
    .slice(0, 3)
    .map((feature) => {
      const candidateFiles = [...new Set([
        ...(feature.entryPoint ? [feature.entryPoint] : []),
        ...feature.entryPoints,
        ...feature.files
      ])];
      const steps = feature.businessFlow.slice(0, 6).map((label) => {
        const file = candidateFiles.find((candidate) => label.includes(candidate));
        return {
          label,
          ...(file ? { file, purpose: fileIndex[file]?.purpose } : {})
        };
      });

      return {
        name: `${feature.name} flow`,
        purpose: `Describes the inferred behavior for ${feature.name.toLowerCase()}.`,
        type: "feature" as const,
        ...(feature.entryPoint ? { entryPoint: feature.entryPoint } : {}),
        steps,
        ...(steps.length > 3 ? { mermaid: renderMermaidFlow(steps) } : {}),
        confidence: "high" as const
      };
    });
}

function generateRequestFlows(
  routes: RouteInfo[],
  fileIndex: Record<string, FileIndexEntry>,
  graph: Record<string, string[]>
): FlowInfo[] {
  return routes
    .filter((route) => route.kind === "api")
    .slice(0, 5)
    .map((route) => {
      const files = collectFlowFiles(route.file, graph, fileIndex);
      const steps = files.map((file, index) => ({
        label: renderFlowStepLabel(file, fileIndex[file], index === 0),
        file,
        purpose: fileIndex[file]?.purpose
      }));

      return {
        name: `Request ${route.path}`,
        purpose: `Shows the main files involved in the ${route.path} request path.`,
        type: "request" as const,
        entryPoint: route.file,
        steps,
        ...(steps.length > 2 ? { mermaid: renderMermaidFlow(steps) } : {}),
        confidence: steps.length > 1 ? "high" as const : "medium" as const
      };
    });
}

function collectFlowFiles(
  entryFile: string,
  graph: Record<string, string[]>,
  fileIndex?: Record<string, FileIndexEntry>
): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0 && files.length < 5) {
    const file = queue.shift();
    if (!file || visited.has(file) || (fileIndex && !fileIndex[file])) {
      continue;
    }

    visited.add(file);
    files.push(file);

    for (const next of graph[file] ?? []) {
      if (!visited.has(next) && (!fileIndex || fileIndex[next])) {
        queue.push(next);
      }
    }
  }

  return files;
}

function buildOnboardingPath(
  files: ScannedFile[],
  entryPoints: string[],
  criticalFiles: ProjectMap["criticalFiles"],
  fileIndex: Record<string, FileIndexEntry>
): string[] {
  const availableFiles = new Set(files.map((file) => file.path));
  const path = new Set<string>();

  for (const candidate of ["README.md", "readme.md", "AGENTS.md", "DEVMAP.md", "package.json"]) {
    if (availableFiles.has(candidate)) {
      path.add(candidate);
    }
  }

  for (const entryPoint of entryPoints) {
    path.add(entryPoint);
  }

  for (const file of criticalFiles.map((item) => item.path)) {
    path.add(file);
  }

  for (const [file, metadata] of Object.entries(fileIndex)
    .sort(([, left], [, right]) => right.importance - left.importance)) {
    if (metadata.scope !== "test" && metadata.scope !== "docs") {
      path.add(file);
    }
  }

  return [...path].slice(0, 12);
}

function buildChangeImpact(
  fileIndex: Record<string, FileIndexEntry>,
  features: FeatureInfo[],
  flows: FlowInfo[],
  graph: Record<string, string[]>
): ProjectMap["changeImpact"] {
  const reverseDependencies = buildReverseDependencies(graph);
  const impacts: ProjectMap["changeImpact"] = {};

  for (const file of Object.keys(fileIndex)) {
    const impactedFeatures = features
      .filter((feature) => feature.files.includes(file) || feature.entryPoint === file)
      .map((feature) => feature.name);
    const impactedFlows = flows
      .filter((flow) => flow.steps.some((step) => step.file === file))
      .map((flow) => flow.name);
    const dependents = reverseDependencies[file] ?? [];
    const impactNames = [...new Set([...impactedFeatures, ...impactedFlows])].sort();

    if (impactNames.length > 0 || dependents.length > 0) {
      impacts[file] = {
        impacts: impactNames,
        dependents
      };
    }
  }

  return impacts;
}

function buildReverseDependencies(graph: Record<string, string[]>): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};

  for (const [file, dependencies] of Object.entries(graph)) {
    for (const dependency of dependencies) {
      reverse[dependency] ??= [];
      reverse[dependency].push(file);
    }
  }

  for (const dependents of Object.values(reverse)) {
    dependents.sort();
  }

  return reverse;
}

function renderFlowStepLabel(
  file: string,
  metadata: FileIndexEntry | undefined,
  isFirstStep: boolean
): string {
  const prefix = isFirstStep ? "Start with" : "Review";
  const symbols = metadata?.topFunctions
    .filter((item) => item.exported)
    .map((item) => item.name)
    .slice(0, 2) ?? [];
  const symbolText = symbols.length > 0 ? ` (${symbols.join(", ")})` : "";

  return `${prefix} ${file}${symbolText}`;
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

function splitSearchTerms(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
