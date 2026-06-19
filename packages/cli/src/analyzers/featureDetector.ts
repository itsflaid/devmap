import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
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
}> = [
  { name: "Authentication", terms: ["auth", "login", "session", "jwt", "next-auth", "clerk"] },
  { name: "Payments", terms: ["payment", "stripe", "midtrans"] },
  { name: "File Upload", terms: ["upload", "multer", "cloudinary"] },
  { name: "Email", terms: ["email", "resend", "nodemailer"] },
  { name: "AI Integration", terms: ["openai", "groq", "gemini", "generative-ai"] },
  { name: "Notifications", terms: ["notification", "web-push", "pusher"] }
];

export function detectFeatures(
  files: ScannedFile[],
  routes: RouteInfo[],
  database?: DatabaseInfo
): FeatureInfo[] {
  const features: FeatureInfo[] = [];
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));

  for (const signal of FEATURE_SIGNALS) {
    const evidence = scopedFiles
      .filter((file) => matchesSignal(file, signal.terms))
      .map((file) => file.path)
      .slice(0, 5);

    if (evidence.length > 0) {
      features.push(createFeatureInfo(signal.name, evidence, signal.terms));
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

  return enrichAuthenticationFeature(features, scopedFiles)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createFeatureInfo(
  name: string,
  evidence: string[],
  terms: string[]
): FeatureInfo {
  const files = evidence.filter((item) => item.includes("/") || /\.[A-Za-z0-9]+$/.test(item));

  return {
    name,
    purpose: `Identifies ${name.toLowerCase()} capability in the project.`,
    files,
    businessFlow: [],
    entryPoints: [],
    searchTerms: [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8),
    confidence: evidence.length >= 2 ? "high" : "medium",
    evidence
  };
}

function matchesSignal(file: ScannedFile, terms: string[]): boolean {
  const path = file.path.toLowerCase();
  const imports = readImportSpecifiers(file.content);

  return terms.some((term) =>
    path.includes(term)
    || imports.some((specifier) => specifier.includes(term))
  );
}

function enrichAuthenticationFeature(features: FeatureInfo[], files: ScannedFile[]): FeatureInfo[] {
  const authFiles = collectAuthenticationFeatureFiles(files);
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

function collectAuthenticationFeatureFiles(files: ScannedFile[]): string[] {
  return orderAuthenticationFiles(files
    .filter((file) => isArchitectureSource(file.path))
    .filter((file) => !isAnalyzerImplementationFile(file.path))
    .filter((file) => {
      const imports = readImportSpecifiers(file.content);
      const symbols = readSemanticSymbols(file.content);
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

  if (/(^|\/)src\/auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /(^|\/)auth\.[cm]?[jt]sx?$/.test(normalizedPath)
    || (hasSymbol(symbols, "auth") && hasSymbol(symbols, "handlers"))
    || /\b(nextauth|getserversession|getsession|credentials)\b/.test(text)
  ) {
    return "auth-config";
  }

  if (/(^|\/)(src\/)?(proxy|middleware)\.[cm]?[jt]sx?$/.test(normalizedPath)
    || /\b(auth|session|token|jwt|redirect|unauthorized|authenticated)\b/.test(text)
      && /\b(middleware|guard|proxy)\b/.test(text)
  ) {
    return "guard";
  }

  if (/providers?\.[cm]?[jt]sx?$/.test(normalizedPath)
    && (imports.some((specifier) => specifier.includes("next-auth"))
      || /\b(sessionprovider|usesession)\b/.test(text))
  ) {
    return "provider";
  }

  if (/(app-shell|layout)\.[cm]?[jt]sx?$/.test(normalizedPath)
    && /\b(signout|handlesignout|usesession|sessionprovider)\b/.test(text)
  ) {
    return "consumer";
  }

  if (/\b(auth|nextauth|getserversession|getsession|signin|signout|usesession|sessionprovider|handlelogin|handleregister|handlesignout)\b/.test(text)) {
    return "consumer";
  }

  return null;
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

function readSemanticSymbols(content: string): string[] {
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

function readImportSpecifiers(content: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|require\()\s*['"]([^'"]+)['"]/g;
  let match = pattern.exec(content);

  while (match) {
    imports.push(match[1].toLowerCase());
    match = pattern.exec(content);
  }

  return imports;
}
