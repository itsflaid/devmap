import type { FileAnalysis } from "./fileAnalysis.js";
import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import { classifyFileRole, isTechnicalFeatureSource, type FileRole } from "./fileRole.js";
import { isArchitectureSource } from "./sourceScope.js";

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

export type AuthSemanticRole = "auth-config" | "guard" | "provider" | "consumer";

const FEATURE_SIGNALS: Array<{
  name: string;
  terms: string[];
  purpose: string;
}> = [
  {
    name: "Authentication",
    terms: ["auth", "login", "session", "jwt", "next-auth", "clerk"],
    purpose: "Handles authentication, identity, sessions, login, and access control."
  },
  {
    name: "Payments",
    terms: ["payment", "stripe", "midtrans"],
    purpose: "Handles payment providers and transaction workflows."
  },
  {
    name: "File Upload",
    terms: ["upload", "multer", "cloudinary"],
    purpose: "Handles file ingestion, storage, and upload providers."
  },
  {
    name: "Email",
    terms: ["email", "resend", "nodemailer"],
    purpose: "Handles application email delivery and templates."
  },
  {
    name: "AI Integration",
    terms: ["openai", "groq", "openrouter", "gemini", "generative-ai"],
    purpose: "Handles AI providers, prompts, and model-facing context."
  },
  {
    name: "Notifications",
    terms: ["notification", "web-push", "pusher"],
    purpose: "Handles user notifications and push delivery."
  }
];

const ROLE_FEATURES: Array<{
  role: FileRole;
  name: string;
  purpose: string;
  terms: string[];
}> = [
  {
    role: "documentation",
    name: "Documentation",
    purpose: "Explains project behavior, setup, architecture, and contribution guidance.",
    terms: ["documentation", "docs", "readme", "guide"]
  },
  {
    role: "landing-ui",
    name: "Web Landing",
    purpose: "Contains public landing and marketing user interface code.",
    terms: ["web", "landing", "marketing", "hero", "ui"]
  },
  {
    role: "cli-command",
    name: "CLI Commands",
    purpose: "Contains command entry points that orchestrate DevMap behavior.",
    terms: ["cli", "command", "analyze", "ask", "init", "doctor"]
  },
  {
    role: "snapshot-engine",
    name: "Snapshot Engine",
    purpose: "Builds, stores, validates, and reuses project snapshots.",
    terms: ["snapshot", "projectmap", "analyze", "cache", "index"]
  },
  {
    role: "analysis-engine",
    name: "Analysis Engine",
    purpose: "Scans source files and extracts project structure and relationships.",
    terms: ["analysis", "analyzer", "scanner", "detector", "dependency"]
  },
  {
    role: "ai-integration",
    name: "AI Integration",
    purpose: "Handles AI providers, prompts, and model-facing context.",
    terms: ["ai", "groq", "openrouter", "prompt", "context", "model"]
  }
];

const FEATURE_FILE_PRIORITIES: Record<string, RegExp[]> = {
  "AI Integration": [
    /\/ai\/provider\.[cm]?[jt]s$/,
    /\/ai\/groq\.[cm]?[jt]s$/,
    /\/ai\/openrouter\.[cm]?[jt]s$/,
    /\/ai\/contextbuilder\.[cm]?[jt]s$/,
    /\/ai\/prompts\.[cm]?[jt]s$/,
    /\/ai\/completion\.[cm]?[jt]s$/
  ],
  "Analysis Engine": [
    /\/analyzers\/projectmap\.[cm]?[jt]s$/,
    /\/analyzers\/analyzerregistry\.[cm]?[jt]s$/,
    /\/analyzers\/tsmorphanalyzer\.[cm]?[jt]s$/,
    /\/analyzers\/heuristicanalyzer\.[cm]?[jt]s$/,
    /\/analyzers\/fileanalysis\.[cm]?[jt]s$/,
    /\/analyzers\/filescanner\.[cm]?[jt]s$/,
    /\/analyzers\/dependencygraph\.[cm]?[jt]s$/,
    /\/analyzers\/featuredetector\.[cm]?[jt]s$/
  ],
  "Snapshot Engine": [
    /\/analyzers\/projectmap\.[cm]?[jt]s$/,
    /\/cache\/snapshot\.[cm]?[jt]s$/,
    /\/cache\/agentnavigation\.[cm]?[jt]s$/,
    /\/cache\/filehash\.[cm]?[jt]s$/
  ],
  "CLI Commands": [
    /\/commands\/analyze\.[cm]?[jt]s$/,
    /\/commands\/ask\.[cm]?[jt]s$/,
    /\/commands\/init\.[cm]?[jt]s$/,
    /\/commands\/doctor\.[cm]?[jt]s$/,
    /\/commands\/onboarding\.[cm]?[jt]s$/
  ],
  Documentation: [
    /(^|\/)readme\.md$/,
    /(^|\/)prd\.md$/,
    /(^|\/)agents\.md$/,
    /(^|\/)contributing\.md$/
  ],
  "Web Landing": [
    /\/pages\/index\.astro$/,
    /\/landing\/herosection\./,
    /\/landing\/siteheader\./
  ]
};

export function detectFeatures(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>,
  routes: RouteInfo[],
  database?: DatabaseInfo
): FeatureInfo[] {
  const features: FeatureInfo[] = [];
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));

  for (const definition of ROLE_FEATURES) {
    const evidence = scopedFiles
      .filter((file) =>
        classifyFileRole(file.path) === definition.role
        || (definition.name === "CLI Commands"
          && /(^|\/)src\/index\.[cm]?[jt]s$/.test(file.path.toLowerCase()))
        || (definition.name === "Snapshot Engine"
          && /(^|\/)projectmap\.[cm]?[jt]sx?$/.test(file.path.toLowerCase()))
      )
      .map((file) => file.path)
      .sort((left, right) =>
        featureFilePriority(definition.name, left) - featureFilePriority(definition.name, right)
        || left.localeCompare(right)
      )
      .slice(0, 12);

    if (evidence.length > 0) {
      features.push(createFeatureInfo(
        definition.name,
        evidence,
        definition.terms,
        definition.purpose
      ));
    }
  }

  const technicalFiles = scopedFiles.filter((file) => isTechnicalFeatureSource(file.path));

  for (const signal of FEATURE_SIGNALS) {
    const evidence = technicalFiles
      .filter((file) => matchesSignal(file, analyses[file.path], signal.terms))
      .map((file) => file.path)
      .sort()
      .slice(0, 5);

    if (evidence.length > 0) {
      mergeFeature(features, createFeatureInfo(
        signal.name,
        evidence,
        signal.terms,
        signal.purpose
      ));
    }
  }

  if (database) {
    const evidence = database.files.length > 0 ? database.files : [database.provider];
    features.push(createFeatureInfo("Database", evidence, [
      "database",
      "schema",
      "model",
      "repository",
      database.provider.toLowerCase()
    ]));
  }

  const apiFiles = [...new Set(routes.filter((route) => route.kind === "api").map((route) => route.file))];
  if (apiFiles.length > 0) {
    features.push(createFeatureInfo("API Routes", apiFiles.slice(0, 5), [
      "api",
      "route",
      "endpoint",
      "request",
      "response"
    ]));
  }

  return enrichAuthenticationFeature(features, scopedFiles, analyses)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createFeatureInfo(
  name: string,
  evidence: string[],
  terms: string[],
  purpose = `Identifies ${name.toLowerCase()} capability in the project.`
): FeatureInfo {
  const files = evidence.filter((item) => item.includes("/") || /\.[A-Za-z0-9]+$/.test(item));

  return {
    name,
    purpose,
    files,
    businessFlow: [],
    entryPoints: [],
    searchTerms: [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8),
    confidence: evidence.length >= 2 ? "high" : "medium",
    evidence
  };
}

function mergeFeature(features: FeatureInfo[], addition: FeatureInfo): void {
  const existingIndex = features.findIndex((feature) => feature.name === addition.name);
  if (existingIndex === -1) {
    features.push(addition);
    return;
  }

  const existing = features[existingIndex];
  const files = [...new Set([...existing.files, ...addition.files])];
  const evidence = [...new Set([...existing.evidence, ...addition.evidence])];
  features[existingIndex] = {
    ...existing,
    files,
    evidence,
    searchTerms: [...new Set([...existing.searchTerms, ...addition.searchTerms])].slice(0, 8),
    confidence: evidence.length >= 2 ? "high" : existing.confidence
  };
}

/**
 * matchesSignal — pakai FileAnalysis.imports dari ts-morph kalau tersedia,
 * fallback ke path-only check kalau file belum dianalysis (non-TS/JS files).
 * Ini eliminasi false positive dari README.md dll yang mentok di content scan.
 */
function matchesSignal(
  file: ScannedFile,
  analysis: FileAnalysis | undefined,
  terms: string[]
): boolean {
  const path = file.path.toLowerCase();

  // Path match tetap berlaku untuk semua file
  if (terms.some((term) => path.includes(term))) return true;

  // Kalau ada analysis dari ts-morph/heuristic, pakai imports-nya — akurat, no false positive
  if (analysis) {
    return terms.some((term) =>
      analysis.imports.some((specifier) => specifier.toLowerCase().includes(term))
    );
  }

  // Fallback untuk file yang tidak punya analysis (harusnya jarang)
  return false;
}

function enrichAuthenticationFeature(
  features: FeatureInfo[],
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): FeatureInfo[] {
  const authFiles = collectAuthenticationFeatureFiles(files, analyses);
  if (authFiles.length === 0) {
    return features;
  }

  const existingAuth = features.find((feature) => feature.name === "Authentication");
  if (existingAuth) {
    return features.map((feature) =>
      feature.name === "Authentication"
        ? {
          ...feature,
          files: orderAuthenticationFiles([...new Set([...feature.files, ...authFiles])]),
          evidence: orderAuthenticationFiles([...new Set([...feature.evidence, ...authFiles])]),
          confidence: "high"
        }
        : feature
    );
  }

  return [
    ...features,
    createFeatureInfo("Authentication", authFiles, [
      "auth",
      "authentication",
      "login",
      "session",
      "jwt",
      "next-auth"
    ])
  ];
}

function collectAuthenticationFeatureFiles(
  files: ScannedFile[],
  analyses: Record<string, FileAnalysis>
): string[] {
  return orderAuthenticationFiles(files
    .filter((file) => isArchitectureSource(file.path))
    .filter((file) => isTechnicalFeatureSource(file.path))
    .filter((file) => !isAnalyzerImplementationFile(file.path))
    .filter((file) => {
      const analysis = analyses[file.path];
      // Pakai symbols + imports dari ts-morph kalau tersedia
      const imports = analysis?.imports ?? extractImportsFallback(file.content);
      const symbols = analysis
        ? analysis.symbols.map((s) => s.name)
        : extractSymbolsFallback(file.content);
      return detectAuthenticationSemanticRole(file.path, symbols, imports, file.content) !== null;
    })
    .map((file) => file.path));
}

function isAnalyzerImplementationFile(path: string): boolean {
  return /(^|\/)(analyzers?|detectors?)\//i.test(path);
}

export function detectAuthenticationSemanticRole(
  path: string,
  symbols: string[],
  imports: string[],
  content = ""
): AuthSemanticRole | null {
  const normalizedPath = path.toLowerCase();
  const text = `${normalizedPath} ${symbols.join(" ")} ${imports.join(" ")} ${content}`.toLowerCase();
  const normalizedImports = imports.map((specifier) => specifier.toLowerCase());
  const hasAuthImport = normalizedImports.some((specifier) =>
    /(^|[/@-])(auth|next-auth|auth0|clerk)([/.-]|$)/.test(specifier)
    || /supabase.*auth/.test(specifier)
  );
  const hasAuthSymbol = symbols.some((symbol) =>
    /(auth|session|login|register|signin|signout|jwt|token)/i.test(symbol)
  );
  const hasAuthPath = /(^|[/._-])(auth|session|login|register|signin|signout)([/._-]|$)/.test(normalizedPath);
  const hasGuardPath = /(^|[/._-])(guard|middleware|proxy|protected)([/._-]|$)/.test(normalizedPath);
  const hasGuardSymbol = symbols.some((symbol) =>
    /(guard|middleware|proxy|protected)/i.test(symbol)
  );

  if (/(^|\/)src\/auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /(^|\/)auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasSymbol(symbols, "auth") && hasSymbol(symbols, "handlers"))
    || hasAuthImport && /\b(nextauth|getserversession|getsession|credentials)\b/.test(text)
  ) {
    return "auth-config";
  }

  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasAuthPath || hasAuthImport || hasAuthSymbol) && (hasGuardPath || hasGuardSymbol)
  ) {
    return "guard";
  }

  if (/providers?\.[cm]?[jt]sx?$/.test(normalizedPath)
    && (hasAuthImport || hasAuthSymbol)
  ) {
    return "provider";
  }

  if (/(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalizedPath)
    && /\b(signout|handlesignout|usesession|sessionprovider)\b/.test(text)
  ) {
    return "consumer";
  }

  if (hasAuthPath || hasAuthImport || hasAuthSymbol) {
    return "consumer";
  }

  return null;
}

function featureFilePriority(featureName: string, path: string): number {
  const normalized = path.toLowerCase();
  if (featureName === "Documentation") {
    if (normalized === "readme.md") return 0;
    if (normalized === "agents.md") return 1;
    if (normalized === "contributing.md") return 2;
    if (normalized === "prd.md") return 3;
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
    || left.localeCompare(right)
  );
}

export function authenticationFilePriority(path: string): number {
  const normalized = path.toLowerCase();
  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalized)) return 10;
  if (/(^|\/)(src\/)?auth\.[cm]?[jt]sx?$/.test(normalized)) return 20;
  if (/\/api\/.*register|register.*\/route\.[cm]?[jt]s$/.test(normalized)) return 30;
  if (/login.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 40;
  if (/register.*(page|form)\.[cm]?[jt]sx?$/.test(normalized)) return 45;
  if (/providers?\.[cm]?[jt]sx?$/.test(normalized)) return 50;
  if (/(dashboard|app-shell|layout)\.[cm]?[jt]sx?$/.test(normalized)) return 60;
  return 80;
}

/**
 * Fallback functions — hanya dipanggil kalau FileAnalysis tidak tersedia.
 * Untuk non-TS/JS files yang dihandle HeuristicAnalyzer / FallbackAnalyzer.
 */
function extractImportsFallback(content: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|require\()\s*['"]([^'"]+)['"]/g;
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
    /(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*(?:Auth|Session|Login|Register|SignOut|Provider)[A-Za-z0-9_$]*)/g
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
  return symbols.some((symbol) => symbol.toLowerCase() === name);
}
