import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import { isArchitectureSource } from "./sourceScope.js";

export type FeatureInfo = {
  name: string;
  purpose: string;
  files: string[];
  entryPoints: string[];
  searchTerms: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

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

  return features.sort((left, right) => left.name.localeCompare(right.name));
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
