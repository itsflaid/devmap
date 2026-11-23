import type {
  FileAnalysis,
  ScannedFile,
  EntityGraph,
  RelationInfo,
} from "../analysis/index.js";
import { classifyFileRole, isTechnicalFeatureSource, isDocumentationMeta, type FileRole } from "../analysis/index.js";
import { IMPORT_CLAUSE } from "../analysis/importClause.js";
import type {
  DatabaseInfo,
  RouteInfo,
  CapabilityInfo,
} from "../detectors/index.js";
import { detectFrontendPageFeatures, detectClientRouteFeatures } from "../detectors/index.js";
import type { FileGraph } from "../graph/dependencyGraph.js";
import { countReferences, isArchitectureSource } from "../graph/index.js";
import {
  projectFeatureCandidates,
  reconcileFeatureCandidates,
  type FeatureCandidate,
  type FeatureCandidateSource,
  type FeatureCluster,
} from "./featureCandidates.js";
import { HOME_FEATURE_NAME } from "../detectors/frontendFeatureDetector.js";
import { FEATURE_SIGNALS, hasAiProviderUrl, isAiProviderImport, type FeatureSignal } from "../registry/index.js";
import { compareText } from "../../utils/compare.js";

export type FeatureInfo = {
  name: string;
  purpose: string;
  files: string[];
  entryPoint?: string;
  entryPoints: string[];
  businessFlow: string[];
  searchTerms: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

export type DetectFeaturesResult = {
  features: FeatureInfo[];
  mergeDecisions: Array<{ candidateIds: [string, string]; outcome: string; anchors: Array<{ type: string; value: string }> }>;
  rejectedCandidateIds: string[];
  /**
   * Features whose only support is a vocabulary word in a file name or local import. Unless a route
   * or entry point reaches them, the pipeline reports them at medium confidence at most.
   */
  nameOnlyFeatures: string[];
};

export type AuthSemanticRole = "auth-config" | "guard" | "provider" | "consumer";

// Only user-visible roles. "api-handler", "service", "middleware", "repository" and "ui-component"
// are architectural layers, not features. "ai-integration" is left to FEATURE_SIGNALS (imports),
// since the role is too noisy. "documentation" is included but filtered by isDocumentationEvidence().
const ROLE_FEATURES: Array<{
  role: FileRole;
  name: string;
  purpose: string;
  terms: string[];
}> = [
  {
    role: "documentation",
    name: "Documentation",
    purpose: "Contains project documentation, API references, and developer guides.",
    terms: ["documentation", "docs", "guide", "reference", "api", "wiki"]
  },
  {
    role: "landing-ui",
    name: "Web Landing",
    purpose: "Contains public-facing landing page and marketing UI components.",
    terms: ["web", "landing", "marketing", "hero", "ui", "homepage"]
  },
  {
    role: "cli-command",
    name: "CLI Commands",
    purpose: "Contains CLI entry points and command handlers.",
    terms: ["cli", "command", "bin", "argv", "commander", "yargs"]
  },
];

// Entities that only support an external system (auth provider, ORM bookkeeping) and never become
// features in entityGraphToFeatures, whatever their relations. "Account" is an OAuth link record in
// NextAuth / Lucia schemas; a project that uses it as a domain entity (billing, bank accounts) still
// gets it through FEATURE_SIGNALS or capabilitiesToFeatures.
const INFRASTRUCTURE_ENTITY_NAMES = new Set([
  // NextAuth / Lucia / Better-Auth internals
  "Account",
  "Session",
  "VerificationToken",
  "VerificationCode",
  "Authenticator",

  // Generic auth infrastructure
  "PasswordResetToken",
  "RefreshToken",
  "OAuthToken",
  "OAuthAccount",

  // Audit / system tables
  "AuditLog",
  "ActivityLog",
  "EventLog",
]);

function isDocumentationEvidence(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;

  if (/(^|\/)\.github(\/|$)/.test(normalized)) return false;
  if (isDocumentationMeta(filename)) return false;

  return (
    /(^|\/)docs?(\/|$)/.test(normalized)
    || /(^|\/)wiki(\/|$)/.test(normalized)
    || filename === "readme.md"
    || /\.(guide|tutorial|reference)\.(md|mdx)$/.test(filename)
    || /(openapi|swagger)\.(json|yaml|yml)$/.test(filename)
  );
}

// Generated files and migration history repeat table and column names, which would match feature
// vocabulary without being an implementation.
function isFeatureEvidenceFile(path: string): boolean {
  const lower = path.toLowerCase();

  return !(
    // Tool-generated and tool-owned folders (.adonisjs/, .github/, .storybook/, .nuxt/ ...)
    /(^|\/)\.[^/]+\//.test(lower)
    || /\/prisma\/migrations\//.test(lower)
    || /\/migrations\//.test(lower)
    || /\.sql$/.test(lower)
    || /\/generated\//.test(lower)
    || /\.generated\./.test(lower)
    || /\.(?:svg|png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|mp[34]|webm|pdf)$/.test(lower)
    || /\/prisma\/schema\.prisma$/.test(lower)
    || /^prisma\/schema\.prisma$/.test(lower)
  );
}

// Files under ../registry/ define the detection vocabulary; registry/email.ts would otherwise
// match the "email" term it describes.
function isRegistryFile(path: string): boolean {
  return /\/analyzers\/registry\//.test(path.toLowerCase());
}

const FEATURE_FILE_PRIORITIES: Record<string, RegExp[]> = {
  Documentation: [
    /(^|\/)readme\.md$/,
    /(^|\/)contributing\.md$/,
    /(^|\/)changelog\.md$/,
    /(^|\/)license(\.md)?$/,
    /(^|\/)docs\/index\.md$/,
    /(^|\/)docs\//,
  ],
  Authentication: [
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/,
    /(^|\/)auth\.[cm]?[jt]sx?$/,
    /\/auth\/config\.[cm]?[jt]sx?$/,
    /(^|\/)middleware\.[cm]?[jt]sx?$/,
    /\/auth\/middleware\.[cm]?[jt]sx?$/,
    /\/api\/auth\//,
    /\/api\/.*\/(login|register|logout)\.[cm]?[jt]sx?$/,
    /\/providers?\/auth[^/]*\.[cm]?[jt]sx?$/,
    /\/context\/auth[^/]*\.[cm]?[jt]sx?$/,
  ],
  Payments: [
    /\/lib\/stripe\.[cm]?[jt]sx?$/,
    /\/lib\/payment[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*webhook[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*checkout[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*payment[^/]*\.[cm]?[jt]sx?$/,
  ],
  "AI Integration": [
    /\/lib\/ai\.[cm]?[jt]sx?$/,
    /\/ai\/provider\.[cm]?[jt]sx?$/,
    /\/ai\/client\.[cm]?[jt]sx?$/,
    /\/lib\/openai\.[cm]?[jt]sx?$/,
    /\/lib\/groq\.[cm]?[jt]sx?$/,
    /\/ai\/prompts?\.[cm]?[jt]sx?$/,
    /\/ai\/completion\.[cm]?[jt]sx?$/,
  ],
  Email: [
    /\/lib\/email[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/mailer[^/]*\.[cm]?[jt]sx?$/,
    /\/emails?\//,
    /\/templates?\//,
  ],
  "File Upload": [
    /\/lib\/upload[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/storage[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/cloudinary[^/]*\.[cm]?[jt]sx?$/,
    /\/api\/.*upload[^/]*\.[cm]?[jt]sx?$/,
  ],
  "Background Jobs": [
    /\/lib\/queue[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/worker[^/]*\.[cm]?[jt]sx?$/,
    /\/workers?\//,
    /\/jobs?\//,
    /\/queues?\//,
  ],
  Caching: [
    /\/lib\/redis\.[cm]?[jt]sx?$/,
    /\/lib\/cache[^/]*\.[cm]?[jt]sx?$/,
    /\/cache\//,
  ],
  "CLI Commands": [
    /\/src\/index\.[cm]?[jt]sx?$/,
    /\/bin\//,
    /\/commands?\/index\.[cm]?[jt]sx?$/,
    /\/commands?\//,
  ],
  "Web Landing": [
    /\/pages\/index\.(astro|tsx?|jsx?)$/,
    /\/app\/page\.(tsx?|jsx?)$/,
    /\/landing\//,
    /(hero|pricing|features?section)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/,
  ],
  Testing: [
    /\/(vitest|jest)\.config\.[cm]?[jt]sx?$/,
    /\/test-utils?\.[cm]?[jt]sx?$/,
    /\/setup\.(test|spec)\.[cm]?[jt]sx?$/,
  ],
  Search: [
    /\/lib\/search[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/meilisearch[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/algolia[^/]*\.[cm]?[jt]sx?$/,
  ],
  "Logging & Monitoring": [
    /\/lib\/logger[^/]*\.[cm]?[jt]sx?$/,
    /\/lib\/sentry[^/]*\.[cm]?[jt]sx?$/,
    /\/instrumentation\.[cm]?[jt]sx?$/,
    /\/sentry\.(client|server|edge)\.[cm]?[jt]sx?$/,
  ],
};

// Entry point score: lower is better. Generic utility files score at or above this and are dropped.
const ENTRY_POINT_EXCLUDE_THRESHOLD = 90;

export type FileTier = "primary" | "supporting" | "reference" | "excluded";

export function classifyFileTier(path: string): FileTier {
  const lower = path.toLowerCase();

  if (/\/(prisma\/)?migrations?\//.test(lower)) return "excluded";
  if (/\.sql$/.test(lower)) return "excluded";
  if (/\/generated\//.test(lower) || /\.generated\./.test(lower)) return "excluded";
  if (/\.(lock|log|map)$/.test(lower)) return "excluded";

  if (/(^|\/)schema\.prisma$/.test(lower)) return "reference";
  if (/\.(config|conf)\.[cm]?[jt]s$/.test(lower)) return "reference";

  if (/\/(api|routes?)\//.test(lower)) return "primary";
  if (/\.(service|usecase|action|route|handler)\.[cm]?[jt]sx?$/.test(lower)) return "primary";
  if (/\/(hooks?|stores?)\//.test(lower)) return "primary";

  if (/\.[cm]?[jt]sx?$/.test(lower)) return "supporting";

  return "reference";
}

function scoreEntryPointRelevance(file: string, _context: string): number {
  const lower = file.toLowerCase();

  if (/\/(utils?|helpers?|constants?|types?|shared)\.[cm]?[jt]sx?$/.test(lower)) return 100;
  if (/\/(index)\.[cm]?[jt]sx?$/.test(lower) && !/\/(api|routes?|commands?)\//.test(lower)) return 95;
  if (/\.(d\.ts)$/.test(lower)) return 100;

  if (/\/(route|handler)\.[cm]?[jt]sx?$/.test(lower)) return 5;
  if (/\/api\//.test(lower)) return 10;

  if (/\.(service|usecase|action)\.[cm]?[jt]sx?$/.test(lower)) return 20;
  if (/\/services?\//.test(lower)) return 25;

  if (/\/(commands?|bin)\//.test(lower)) return 15;

  if (/\/(pages?|app)\/.+\/(page|layout)\.[cm]?[jt]sx?$/.test(lower)) return 30;
  if (/\/components?\//.test(lower)) return 50;

  if (/\/lib\//.test(lower)) return 60;

  return 70;
}

export function detectFeatures(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>,
  routes: RouteInfo[],
  database?: DatabaseInfo,
  entityGraph?: EntityGraph,
  capabilities?: CapabilityInfo[],
  fileGraph?: FileGraph
): DetectFeaturesResult {
  const candidates: FeatureCandidate[] = [];
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));

  const hasCliSource = scopedFiles.some(isCliSource);
  for (const definition of ROLE_FEATURES) {
    // Folder names alone ("commands/", "src/main.ts") also fit web apps and libraries.
    if (definition.role === "cli-command" && !hasCliSource) continue;

    const evidence = scopedFiles
      .filter((file) =>
        definition.role === "cli-command"
          ? isCliEvidence(file)
          : classifyFileRole(file.path) === definition.role
      )
      .filter((file) => isFeatureEvidenceFile(file.path))
      .filter((file) =>
        definition.role !== "documentation" || isDocumentationEvidence(file.path)
      )
      .map((file) => file.path)
      .sort((left, right) =>
        featureFilePriority(definition.name, left) - featureFilePriority(definition.name, right)
        || compareText(left, right)
      )
      .slice(0, 12);

    if (evidence.length > 0) {
      candidates.push(toFeatureCandidate(
        "registry",
        `role-${definition.role}`,
        createFeatureInfo(
        definition.name,
        evidence,
        definition.terms,
        definition.purpose,
        analyses
        )
      ));
    }
  }

  const extensionFiles = scopedFiles
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file.path) && VSCODE_IMPORT.test(file.content))
    .filter((file) => isFeatureEvidenceFile(file.path))
    .map((file) => file.path)
    .sort()
    .slice(0, 12);
  if (extensionFiles.length > 0) {
    candidates.push(toFeatureCandidate(
      "registry",
      "role-vscode-extension",
      createFeatureInfo(
        "VS Code Extension",
        extensionFiles,
        ["vscode", "extension", "command", "activate"],
        "Contains the VS Code extension: activation, commands and editor integration.",
        analyses
      )
    ));
  }

  // Filtered once for all signals. Registry files define the vocabulary and would match every signal.
  const technicalFiles = scopedFiles
    .filter((file) => isTechnicalFeatureSource(file.path))
    .filter((file) => isFeatureEvidenceFile(file.path))
    .filter((file) => !isRegistryFile(file.path));

  for (const signal of FEATURE_SIGNALS) {
    const evidence = technicalFiles
      .filter((file) => matchesSignal(file, analyses[file.path], signal))
      .map((file) => file.path)
      .sort((left, right) =>
        featureFilePriority(signal.name, left) - featureFilePriority(signal.name, right)
        || compareText(left, right)
      )
      .slice(0, 5);

    const primaryEvidence = evidence.filter(
      (f) => classifyFileTier(f) === "primary" || classifyFileTier(f) === "supporting"
    );

    if (signal.minimumDistinctFiles && primaryEvidence.length < signal.minimumDistinctFiles) {
      continue;
    }

    if (evidence.length > 0) {
      const candidate = toFeatureCandidate("registry", `signal-${signal.name}`, createFeatureInfo(
        signal.name,
        evidence,
        groundedSignalTerms(signal, evidence, analyses),
        signal.purpose,
        analyses
      ));
      if (!signal.importOnly && !hasPackageEvidence(signal, evidence, analyses)) candidate.nameOnly = true;
      candidates.push(candidate);
    }
  }

  // Database and API routes are not features; they live in snapshot.database and snapshot.routes.

  if (capabilities && capabilities.length > 0) {
    for (const feature of capabilitiesToFeatures(capabilities)) {
      if (feature !== null) {
        candidates.push(toFeatureCandidate("capability", "route-capability", feature, routes));
      }
    }
  }

  if (entityGraph && entityGraph.entityNames.length > 0) {
    for (const feature of entityGraphToFeatures(entityGraph, scopedFiles)) {
      candidates.push(toFeatureCandidate("entity", `entity-${feature.name}`, feature, routes));
    }
  }

  if (fileGraph) {
    for (const feature of detectFrontendPageFeatures(routes, fileGraph, analyses, scopedFiles)) {
      const candidate = toFeatureCandidate("frontend-page", "file-page", feature, routes);
      if (feature.name === HOME_FEATURE_NAME) candidate.standalone = true;
      candidates.push(candidate);
    }
    for (const feature of detectClientRouteFeatures(scopedFiles, fileGraph, analyses)) {
      candidates.push(toFeatureCandidate("client-route", "client-route", feature, routes));
    }
  }

  foldLandingIntoHome(candidates);

  const fileReferenceCounts = fileGraph ? countReferences(fileGraph) : {};
  const reconciliation = reconcileFeatureCandidates(candidates, fileReferenceCounts);
  const features = projectFeatureCandidates(reconciliation.clusters);
  const enriched = enrichAuthenticationFeature(features, reconciliation.clusters, scopedFiles, analyses)
    .sort((left, right) => compareText(left.name, right.name));
  const nameOnlyFeatures = enriched
    .filter((feature) => reconciliation.clusters.some((cluster) =>
      cluster.canonicalLabel === feature.name && cluster.candidates.every((candidate) => candidate.nameOnly)
    ))
    .map((feature) => feature.name);
  return {
    features: enriched,
    mergeDecisions: reconciliation.mergeDecisions ?? [],
    rejectedCandidateIds: reconciliation.rejectedCandidateIds,
    nameOnlyFeatures
  };
}

const VSCODE_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)["']vscode["']/;

const CLI_LIBRARIES = "commander|yargs|citty|cac|clipanion|@oclif/core|oclif|meow|minimist|sade|cleye|gunshi|@clack/prompts|inquirer|mri|arg";
const CLI_IMPORT = new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*)["'](?:${CLI_LIBRARIES.replace(/[/@]/g, (c) => `\\${c}`)})(?:/[^"']*)?["']`);

/** A file that parses arguments: a shebang, `process.argv` or a command-line library import. */
function isCliSource(file: ScannedFile): boolean {
  if (!/\.[cm]?[jt]sx?$/.test(file.path)) return false;
  return /^#!.*\b(?:node|bun|deno|tsx)\b/.test(file.content)
    || /\bprocess\.argv\b|\bDeno\.args\b/.test(file.content)
    || CLI_IMPORT.test(file.content);
}

/** CLI entry points (by content) and command handlers (by folder), in a project that has a CLI. */
function isCliEvidence(file: ScannedFile): boolean {
  const lower = file.path.toLowerCase();
  if (/(^|\/)src\/(index|main|cli)\.[cm]?[jt]s$/.test(lower)) return isCliSource(file);
  return classifyFileRole(file.path) === "cli-command";
}

/**
 * "Web Landing" (landing-ui files) and "Home" (the page served at /) describe the same
 * thing. When both exist and touch the same files, the landing components become part of
 * Home and the separate landing candidate is dropped.
 */
function foldLandingIntoHome(candidates: FeatureCandidate[]): void {
  const home = candidates.find((candidate) => candidate.standalone && candidate.label === HOME_FEATURE_NAME);
  const landingIndex = candidates.findIndex((candidate) => candidate.id.startsWith("registry:role-landing-ui:"));
  if (!home || landingIndex < 0 || !home.projection) return;

  const landing = candidates[landingIndex];
  const homeFiles = new Set(home.files);
  if (!landing.files.some((file) => homeFiles.has(file))) return;

  const files = [...new Set([...home.files, ...landing.files])].sort();
  home.files = files;
  home.projection = {
    ...home.projection,
    files,
    evidence: [...new Set([...home.projection.evidence, ...landing.files])].sort()
  };
  candidates.splice(landingIndex, 1);
}

function toFeatureCandidate(
  source: FeatureCandidateSource,
  ruleId: string,
  feature: FeatureInfo,
  routes: RouteInfo[] = []
): FeatureCandidate {
  const entityNames = feature.name.endsWith(" Management")
    ? [feature.name.slice(0, -" Management".length)]
    : [];
  const routePaths = routes
    .filter((route) => feature.files.includes(route.file))
    .map((route) => route.path)
    .sort();

  return {
    id: `${source}:${ruleId}:${normalizeCandidateSubject(feature.name)}`,
    label: feature.name,
    source,
    evidence: [{
      ruleId,
      source,
      files: [...feature.evidence].sort(),
      routePaths,
      entityNames,
      detail: feature.purpose,
      reliability: source === "entity" ? "high" : "medium",
    }],
    files: [...feature.files].sort(),
    routePaths,
    entityNames,
    conclusionConfidence: feature.confidence,
    projection: feature,
  };
}

function normalizeCandidateSubject(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function capabilitiesToFeatures(capabilities: CapabilityInfo[]): Array<FeatureInfo | null> {
  return capabilities.map((cap) => {
    const terms = [cap.kind, ...cap.entities.map((e) => e.toLowerCase())];

    const scoredEvidence = cap.evidence
      .map((file) => ({ file, score: scoreEntryPointRelevance(file, cap.kind) }))
      .sort((a, b) => a.score - b.score);

    const entryPoints = scoredEvidence
      .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
      .filter((e) => {
        const tier = classifyFileTier(e.file);
        return tier === "primary" || tier === "supporting";
      })
      .slice(0, 2)
      .map((e) => e.file);

    // A route pattern matched but no backing file was found; such a feature would have no entry
    // points and a misleading name.
    if (entryPoints.length === 0 && cap.confidence !== "high") return null;

    return {
      name: cap.name,
      purpose: purposeFromCapability(cap),
      files: cap.evidence,
      entryPoints,
      businessFlow: [],
      searchTerms: [...new Set(terms)],
      confidence: cap.confidence,
      evidence: cap.evidence
    };
  });
}

function purposeFromCapability(cap: CapabilityInfo): string {
  const entityList = cap.entities.length > 0 ? cap.entities.join(", ") : "resources";
  switch (cap.kind) {
    case "crud":            return `Handles create, read, update, and delete operations for ${entityList}.`;
    case "sharing":         return `Handles content sharing via public links and share tokens.`;
    case "collaboration":   return `Handles team collaboration, workspaces, and member management.`;
    case "discovery":       return `Handles public content discovery and browsing.`;
    case "publishing":      return `Handles content publishing and visibility management.`;
    case "social":          return `Handles social interactions like likes, favorites, and reactions.`;
    case "file-management": return `Handles file uploads, storage, and media management.`;
    case "real-time":       return `Handles real-time events, websockets, and live updates.`;
    case "search":          return `Handles full-text search and content filtering.`;
    case "reporting":       return `Handles usage statistics, analytics, and reporting.`;
    default:                return `Handles ${cap.kind} operations for ${entityList}.`;
  }
}

// A name ending in one of these marks a sub-item of its parent, so an entity with a single
// one-to-many parent is still a child even when it owns children itself.
const TRUE_CHILD_SUFFIXES = /(?:Item|Entry|Detail|Line|Row|Part|Step|Variant|Option)$/;

/**
 * A true child has exactly one one-to-many owner and is either a leaf or has a child-like name
 * suffix. It gets no feature of its own; the parent's purpose mentions it. `ChecklistItem` (owned by
 * `Message`) is a child, while `Message` (owned by `User` and `Room`, owns `ChecklistItem[]`) is not.
 */
function isTrueChildEntity(entityName: string, relations: RelationInfo[]): boolean {
  const parents = relations.filter((r) => r.to === entityName && r.kind === "one-to-many");
  if (parents.length === 0) return false;
  if (parents.length > 1) return false;

  const hasOwnChildren = relations.some(
    (r) => r.from === entityName && r.kind === "one-to-many"
  );

  if (!hasOwnChildren) return true;
  if (TRUE_CHILD_SUFFIXES.test(entityName)) return true;

  return false;
}

function entityFileTierScore(path: string): number {
  if (/\.(prisma)$/.test(path)) return 50;
  if (/\/(migrations?)\//.test(path)) return 100;
  return 0;
}

function findEntityFiles(entityName: string, files: ScannedFile[]): string[] {
  const lowerName = entityName.toLowerCase();
  const nameSegments = splitNameToSegments(lowerName);

  const EXCLUDED_EXTS = /\.(sql|lock|log)(\.[^/]+)?$/i;
  const isNonSourceDoc = (p: string) =>
    /\.md$/i.test(p) && !/\/docs\//.test(p.toLowerCase());

  return files
    .filter((f) => isFeatureEvidenceFile(f.path))
    .filter((f) => {
      const lowerPath = f.path.toLowerCase();
      return !EXCLUDED_EXTS.test(lowerPath) && !isNonSourceDoc(lowerPath);
    })
    .filter((f) => {
      const lowerPath = f.path.toLowerCase();
      const pathSegments = lowerPath.split(/[/\\]/);

      return pathSegments.some((segment) => {
        const fileStem = segment.replace(/\.[^/.]+$/, "");
        if (fileStem === lowerName) return true;
        if (fileStem.includes(lowerName) && fileStem.length >= lowerName.length + 1) return true;
        const segParts = splitNameToSegments(fileStem);
        return nameSegments.some((ns) => segParts.includes(ns));
      });
    })
    .map((f) => f.path)
    .sort((a, b) => {
      const tierDiff = entityFileTierScore(a) - entityFileTierScore(b);
      if (tierDiff !== 0) return tierDiff;
      return compareText(a, b);
    })
    .slice(0, 5);
}

function splitNameToSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function entityGraphToFeatures(entityGraph: EntityGraph, files: ScannedFile[] = []): FeatureInfo[] {
  if (entityGraph.source === "empty") return [];

  const relations: RelationInfo[] = [];
  const seenRelKeys = new Set<string>();
  for (const entity of entityGraph.entities) {
    for (const r of entity.relations) {
      const key = `${r.from}→${r.to}:${r.kind}`;
      if (!seenRelKeys.has(key)) {
        seenRelKeys.add(key);
        relations.push(r);
      }
    }
  }

  const trueChildNames = new Set<string>(
    entityGraph.entities
      .map((e) => e.name)
      .filter((name) => isTrueChildEntity(name, relations))
  );

  const features: FeatureInfo[] = [];

  const schemaBacked = entityGraph.source === "prisma" || entityGraph.source === "drizzle";
  const meaningfulEntities = (schemaBacked
    ? entityGraph.entities.filter((e) =>
        relations.some((r) => r.from === e.name || r.to === e.name)
      )
    : entityGraph.entities)
    .filter((e) => !trueChildNames.has(e.name) && !INFRASTRUCTURE_ENTITY_NAMES.has(e.name))
    // Entities with real implementation files (sourceFiles from route hints or SQL) come before
    // those that exist only in the schema.
    .sort((a, b) => (b.sourceFiles?.length ?? 0) - (a.sourceFiles?.length ?? 0));

  for (const entity of meaningfulEntities.slice(0, 8)) {

    const ownedNames = relations
      .filter((r) => r.from === entity.name && r.kind === "one-to-many")
      .map((r) => r.to)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n));

    const oneToOneOwned = relations
      .filter((r) => r.from === entity.name && r.kind === "one-to-one")
      .map((r) => r.to)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n));

    const allOwned = [...new Set([...ownedNames, ...oneToOneOwned])];

    const peerNames = relations
      .filter((r) =>
        r.kind === "many-to-many"
        && (r.from === entity.name || r.to === entity.name)
      )
      .map((r) => r.from === entity.name ? r.to : r.from)
      .filter((n) => !INFRASTRUCTURE_ENTITY_NAMES.has(n) && !trueChildNames.has(n) && n !== entity.name);

    const purpose = buildEntityPurpose(entity.name, allOwned, peerNames);

    const searchTerms = [
      entity.name.toLowerCase(),
      ...allOwned.map((n) => n.toLowerCase()),
      ...peerNames.map((n) => n.toLowerCase()),
      "management", "crud"
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    const entityFiles = entity.sourceFiles ?? findEntityFiles(entity.name, files);

    if (entityFiles.length === 0) continue;

    const entryPoints = entityFiles
      .map((file) => ({ file, score: scoreEntryPointRelevance(file, entity.name.toLowerCase()) }))
      .sort((a, b) => a.score - b.score)
      .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
      .filter((e) => {
        const tier = classifyFileTier(e.file);
        return tier === "primary" || tier === "supporting";
      })
      .slice(0, 2)
      .map((e) => e.file);

    let confidence: FeatureInfo["confidence"] = schemaBacked ? "high" : "medium";
    if (entityFiles.length === 1) {
      const tier = classifyFileTier(entityFiles[0]);
      if (tier === "reference") confidence = "low";
    }

    features.push({
      name: `${entity.name} Management`,
      purpose,
      files: entityFiles,
      entryPoints,
      businessFlow: [],
      searchTerms,
      confidence,
      evidence: entityFiles
    });
  }

  return features;
}

function buildEntityPurpose(
  entityName: string,
  owned: string[],
  peers: string[]
): string {
  if (owned.length > 0 && peers.length > 0) {
    return `Manages ${entityName} (including ${owned.join(", ")}) and its associations with ${peers.join(", ")}.`;
  }
  if (owned.length > 0) {
    return `Manages ${entityName} and its owned items: ${owned.join(", ")}.`;
  }
  if (peers.length > 0) {
    return `Manages ${entityName} and its associations with ${peers.join(", ")}.`;
  }
  return `Manages ${entityName} data and operations.`;
}

function calculateFeatureConfidence(
  evidence: string[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo["confidence"] {
  if (evidence.length === 0) return "low";
  const highQualityCount = evidence.filter(
    (path) => analyses[path]?.confidence === "high"
  ).length;
  if (highQualityCount >= 2) return "high";
  if (highQualityCount >= 1 || evidence.length >= 2) return "medium";
  return "low";
}

function createFeatureInfo(
  name: string,
  evidence: string[],
  terms: string[],
  purpose = `Identifies ${name.toLowerCase()} capability in the project.`,
  analyses: Record<string, FileAnalysis> = {}
): FeatureInfo {
  const files = evidence.filter((item) => item.includes("/") || /\.[A-Za-z0-9]+$/.test(item));

  const entryPoints = files
    .map((file) => ({ file, score: scoreEntryPointRelevance(file, name.toLowerCase()) }))
    .sort((a, b) => a.score - b.score)
    .filter((e) => e.score < ENTRY_POINT_EXCLUDE_THRESHOLD)
    .filter((e) => {
      const tier = classifyFileTier(e.file);
      return tier === "primary" || tier === "supporting";
    })
    .slice(0, 2)
    .map((e) => e.file);

  return {
    name,
    purpose,
    files,
    businessFlow: [],
    entryPoints,
    searchTerms: [...new Set(terms.map((term) => term.toLowerCase()))],
    confidence: calculateFeatureConfidence(evidence, analyses),
    evidence
  };
}

// An `importOnly` signal (AI Integration) matches imports, provider URLs and the role only; see
// ../registry/ai-providers.ts for the vocabulary and the fetch() URL rules. Other signals match by
// path first, then by import.
function matchesSignal(
  file: ScannedFile,
  analysis: FileAnalysis | undefined,
  signal: Pick<FeatureSignal, "terms" | "importTerms" | "excludePaths" | "importOnly">
): boolean {
  if (signal.importOnly) {
    if (analysis?.imports.some(isAiProviderImport)) return true;
    if (hasAiProviderUrl(file.content)) return true;
    return classifyFileRole(file.path) === "ai-integration";
  }

  const path = file.path.toLowerCase();
  if (signal.excludePaths?.some((pattern) => pattern.test(path))) return false;

  if (signal.terms.some((term) => matchesPathTerm(path, term))) return true;

  if (!analysis) return false;
  if (signal.terms.some((term) =>
    analysis.imports.some((specifier) => matchesImportTerm(specifier, term))
  )) return true;

  // Package-only terms: a relative import such as "./blob" is a local module, not the package.
  return (signal.importTerms ?? []).some((term) =>
    analysis.imports.some((specifier) => !specifier.startsWith(".") && matchesImportTerm(specifier, term))
  );
}

/** An npm package specifier: not relative, not an alias such as `@/x`, `~/x`, `#x` or `$lib/x`, not `node:`. */
function isPackageSpecifier(specifier: string): boolean {
  return /^(?:@[a-z0-9][\w.-]*\/[\w.-]+|[a-z0-9][\w.-]*)(?:\/|$)/i.test(specifier);
}

/**
 * Whether a package the evidence imports names the signal. A word in a file name
 * ("cache.js", "session-storage.js") or a local import says what the file is called,
 * not that the project does caching or sessions; an imported `ioredis` or `next-auth` does.
 */
function hasPackageEvidence(
  signal: Pick<FeatureSignal, "terms" | "importTerms">,
  evidence: string[],
  analyses: Record<string, FileAnalysis>
): boolean {
  const terms = [...signal.terms, ...(signal.importTerms ?? [])];
  return evidence.some((path) =>
    analyses[path]?.imports.some((specifier) =>
      isPackageSpecifier(specifier) && terms.some((term) => namesPackage(specifier, term))
    )
  );
}

/**
 * A package is named by its scope or its own name, never by the name behind a scope:
 * `@playwright/test` is Playwright, while `@standard-schema/spec` is not "spec tests".
 * A term that is itself scoped (`@upstash/redis`) must match the package exactly.
 */
function namesPackage(specifier: string, term: string): boolean {
  const lower = specifier.toLowerCase();
  if (term.startsWith("@")) return lower === term || lower.startsWith(`${term}/`);
  const scope = lower.match(/^@([^/]+)\//)?.[1];
  const identity = scope ?? lower.split("/")[0];
  return new RegExp(`(?:^|[._-])${escapeRegex(term)}(?:[._-]|$)`).test(identity);
}

/**
 * The registry lists every vendor a signal knows. Only terms the evidence contains go into the
 * search terms, or an agent reading "clerk, auth0, kinde" would assume the project uses them.
 */
function groundedSignalTerms(
  signal: Pick<FeatureSignal, "name" | "terms" | "importTerms" | "importOnly">,
  evidence: string[],
  analyses: Record<string, FileAnalysis>
): string[] {
  if (signal.importOnly) return signal.terms;

  const paths = evidence.map((path) => path.toLowerCase());
  const grounded = [...signal.terms, ...(signal.importTerms ?? [])].filter((term) =>
    paths.some((path) => matchesPathTerm(path, term))
    || evidence.some((path) =>
      analyses[path]?.imports.some((specifier) => !specifier.startsWith(".") && matchesImportTerm(specifier, term))
    )
  );
  return grounded.length > 0 ? [...new Set(grounded)] : [signal.name.toLowerCase()];
}

/**
 * Matches on segment boundaries so "author" does not match the "auth" signal: `next-auth`,
 * `@org/next-auth` and `./auth/config` match "auth", `./author` does not. For a scoped package only
 * the name after the scope is tested, so `@auth/core` matches only through a term like `@auth`.
 */
function matchesImportTerm(specifier: string, term: string): boolean {
  const lower = specifier.toLowerCase();

  // A term may name a scope or a full scoped package ("@sentry/nextjs", "@trigger.dev").
  if (term.startsWith("@") && (lower === term || lower.startsWith(`${term}/`))) return true;

  // Scoped package: match the segment after the scope.
  const scopedMatch = lower.match(/^@[^/]+\/(.+)$/);
  if (scopedMatch) {
    const packageName = scopedMatch[1];
    return getOrCompilePattern(term).test(packageName)
      || packageName === term
      || packageName.split("-").includes(term);
  }

  // Unscoped package or local path: same boundary regex as path matching.
  return getOrCompilePattern(term).test(lower)
    || lower.split("/").some((segment) => segment === term);
}

const regexCache = new Map<string, RegExp>();

function getOrCompilePattern(term: string): RegExp {
  if (regexCache.has(term)) return regexCache.get(term)!;
  const pattern = new RegExp(`(?:^|[/._-])${escapeRegex(term)}(?:[/._-]|$)`);
  regexCache.set(term, pattern);
  return pattern;
}

function matchesPathTerm(path: string, term: string): boolean {
  // Terms up to 7 chars need a segment boundary: "ai" must not match "detail" or "email", "search"
  // must not match "SearchSurah.tsx", "upload" must not match "LoginUploadWidget.tsx". Longer terms
  // ("elasticsearch") are specific enough for a substring match.
  if (term.length <= 7) {
    return getOrCompilePattern(term).test(path);
  }
  return path.includes(term);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enrichAuthenticationFeature(
  features: FeatureInfo[],
  clusters: FeatureCluster[],
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo[] {
  const authFiles = collectAuthenticationFeatureFiles(files, analyses);
  if (authFiles.length === 0) return features;

  const authCluster = clusters.find((cluster) =>
    cluster.candidates.some((c) => c.source === "registry" && c.label === "Authentication")
  );
  const targetName = authCluster?.canonicalLabel ?? "Authentication";
  const existingTarget = features.find((f) => f.name === targetName);
  if (existingTarget) {
    return features.map((feature) =>
      feature.name === targetName
        ? {
            ...feature,
            files: orderAuthenticationFiles([...new Set([...feature.files, ...authFiles])]),
            evidence: orderAuthenticationFiles([...new Set([...feature.evidence, ...authFiles])]),
            confidence: calculateFeatureConfidence(
              [...new Set([...feature.evidence, ...authFiles])],
              analyses
            )
          }
        : feature
    );
  }

  return [
    ...features,
    createFeatureInfo(targetName, authFiles, [
      "auth", "authentication", "login", "session", "jwt", "next-auth"
    ], undefined, analyses)
  ];
}

function collectAuthenticationFeatureFiles(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): string[] {
  return orderAuthenticationFiles(
    files
      .filter((file) => isArchitectureSource(file.path))
      .filter((file) => isTechnicalFeatureSource(file.path))
      .filter((file) => isFeatureEvidenceFile(file.path))
      .filter((file) => !isAnalyzerImplementationFile(file.path))
      .filter((file) => classifyFileRole(file.path) !== "ai-integration")
      .filter((file) => {
        const analysis = analyses[file.path];
        const imports = analysis?.imports ?? extractImportsFallback(file.content);
        const symbols = analysis
          ? analysis.symbols.map((s) => s.name)
          : extractSymbolsFallback(file.content);
        const role = detectAuthenticationSemanticRole(file.path, symbols, imports, file.content);
        return role !== null && role !== "consumer";
      })
      .map((file) => file.path)
  );
}

function isAnalyzerImplementationFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    /(^|\/)(analyzers?|detectors?)\//.test(normalized)
    || /(^|\/)[^/]+(?:analyzer|detector)\.[cm]?[jt]sx?$/.test(normalized)
  );
}

export function detectAuthenticationSemanticRole(
  path: string,
  symbols: string[],
  imports: string[],
  content = ""
): AuthSemanticRole | null {
  const normalizedPath = path.toLowerCase();
  const text = `${normalizedPath} ${symbols.join(" ")} ${imports.join(" ")} ${content}`.toLowerCase();
  const normalizedImports = imports.map((s) => s.toLowerCase());

  const hasAuthImport = normalizedImports.some((s) =>
    /(^|[/@-])(auth|next-auth|auth0|clerk|lucia|better-auth|passport|kinde)([/.-]|$)/.test(s)
    || /supabase.*auth/.test(s)
    || /firebase\/auth/.test(s)
  );
  const hasAuthSymbol = symbols.some((s) =>
    /\b(auth|session|login|register|signin|signout|jwt|token|credential)\b/i.test(s)
  );
  const hasAuthPath = /(^|[/._-])(auth|session|login|register|signin|signout)([/._-]|$)/.test(normalizedPath);
  const hasGuardPath = /(^|[/._-])(guard|middleware|proxy|protected)([/._-]|$)/.test(normalizedPath);
  const hasGuardSymbol = symbols.some((s) => /\b(guard|middleware|proxy|protected)\b/i.test(s));

  if (
    /(^|\/)src\/auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /(^|\/)auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasSymbol(symbols, "auth") && hasSymbol(symbols, "handlers"))
    || (hasAuthImport && /\b(nextauth|getserversession|getsession|credentials|authconfig)\b/.test(text))
  ) return "auth-config";

  if (
    /(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalizedPath)
    || ((hasAuthPath || hasAuthImport || hasAuthSymbol) && (hasGuardPath || hasGuardSymbol))
  ) return "guard";

  if (/providers?\.[cm]?[jt]sx?$/.test(normalizedPath) && (hasAuthImport || hasAuthSymbol))
    return "provider";

  if (
    /(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalizedPath)
    && /\b(signout|handlesignout|usesession|sessionprovider|useauth)\b/.test(text)
  ) return "consumer";

  if (hasAuthPath || hasAuthImport || hasAuthSymbol) return "consumer";

  return null;
}

export function featureFilePriority(featureName: string, path: string): number {
  const normalized = path.toLowerCase();

  if (featureName === "Documentation") {
    if (normalized === "readme.md") return 0;
    if (normalized === "contributing.md") return 1;
    if (normalized === "changelog.md") return 2;
    if (/^packages\/[^/]+\/readme\.md$/.test(normalized)) return 10;
    if (/^docs\//.test(normalized)) return 20;
    return 30 + normalized.split("/").length;
  }

  const index = FEATURE_FILE_PRIORITIES[featureName]
    ?.findIndex((pattern) => pattern.test(normalized)) ?? -1;
  return index === -1 ? 100 : index;
}

export function orderAuthenticationFiles(files: string[]): string[] {
  return [...new Set(files)].sort((left, right) =>
    authenticationFilePriority(left) - authenticationFilePriority(right)
    || compareText(left, right)
  );
}

export function authenticationFilePriority(path: string): number {
  const normalized = path.toLowerCase();
  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalized)) return 10;
  if (/(^|\/)(src\/)?auth\.[cm]?[jt]sx?$/.test(normalized)) return 20;
  if (/\/auth\/config\.[cm]?[jt]sx?$/.test(normalized)) return 25;
  if (/\/api\/auth\//.test(normalized)) return 30;
  if (/\/api\/.*\/(login|register|logout)\.[cm]?[jt]s$/.test(normalized)) return 35;
  if (/login.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 40;
  if (/register.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 45;
  if (/providers?\.[cm]?[jt]sx?$/.test(normalized)) return 50;
  if (/(dashboard|app-shell|layout)\.[cm]?[jt]sx?$/.test(normalized)) return 60;
  return 80;
}

// Regex fallbacks for files with no ts-morph analysis.
function extractImportsFallback(content: string): string[] {
  const imports: string[] = [];
  const pattern = new RegExp(
    String.raw`(?:import\s+(?:${IMPORT_CLAUSE}\s+from\s+)?|require\()\s*['"]([^'"]+)['"]`,
    "g"
  );
  let match = pattern.exec(content);
  while (match) {
    imports.push(match[1].toLowerCase());
    match = pattern.exec(content);
  }
  return imports;
}

function extractSymbolsFallback(content: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*(?:Auth|Session|Login|Register|SignOut|Provider|Guard)[A-Za-z0-9_$]*)/g
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      symbols.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return [...symbols];
}

function hasSymbol(symbols: string[], name: string): boolean {
  return symbols.some((s) => s.toLowerCase() === name);
}
