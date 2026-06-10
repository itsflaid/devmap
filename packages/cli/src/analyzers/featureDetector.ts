import type { DatabaseInfo } from "./databaseDetector.js";
import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";
import { isArchitectureSource } from "./sourceScope.js";

export type FeatureInfo = {
  name: string;
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
      features.push({ name: signal.name, evidence });
    }
  }

  if (database) {
    features.push({
      name: "Database",
      evidence: database.files.length > 0 ? database.files : [database.provider]
    });
  }

  const apiFiles = [...new Set(routes.filter((route) => route.kind === "api").map((route) => route.file))];
  if (apiFiles.length > 0) {
    features.push({ name: "API Routes", evidence: apiFiles.slice(0, 5) });
  }

  return features.sort((left, right) => left.name.localeCompare(right.name));
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
