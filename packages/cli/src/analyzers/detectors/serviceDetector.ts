import type { ScannedFile } from "../analysis/fileScanner.js";
import { isArchitectureSource } from "../graph/sourceScope.js";

const SERVICES: Array<[string[], string]> = [
  [["@prisma/client", "prisma"], "Prisma"],
  [["@supabase/supabase-js", "supabase"], "Supabase"],
  [["stripe"], "Stripe"],
  [["next-auth", "authjs"], "NextAuth"],
  [["midtrans"], "Midtrans"],
  [["resend"], "Resend"],
  [["cloudinary"], "Cloudinary"],
  [["firebase"], "Firebase"],
  [["openai"], "OpenAI"],
  [["groq"], "Groq"],
  [["openrouter"], "OpenRouter"]
];

const SOURCE_SERVICE_SIGNALS: Array<[string[], string]> = [
  [["api.groq.com", "console.groq.com", "groq api key", "groqclient"], "Groq"],
  [["api.openai.com", "openai api key", "openaiclient"], "OpenAI"],
  [["openrouter.ai", "openrouter api key", "openrouterclient"], "OpenRouter"]
];

export function detectExternalServices(files: ScannedFile[]): string[] {
  const services = new Set<string>();
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));
  const packageDependencies = readPackageDependencyNames(scopedFiles);
  const importedPackages = readImportedPackageNames(scopedFiles);
  const candidates = new Set([...packageDependencies, ...importedPackages]);

  for (const [needles, name] of SERVICES) {
    if (needles.some((needle) => candidates.has(needle))) {
      services.add(name);
    }
  }

  for (const service of readSourceServiceNames(scopedFiles)) {
    services.add(service);
  }

  return [...services].sort();
}

function readPackageDependencyNames(files: ScannedFile[]): string[] {
  const packageFiles = files.filter((file) => file.path.endsWith("package.json"));
  const names = new Set<string>();

  for (const file of packageFiles) {
    try {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      for (const dependency of Object.keys(parsed.dependencies ?? {})) {
        names.add(dependency.toLowerCase());
      }

      for (const dependency of Object.keys(parsed.devDependencies ?? {})) {
        names.add(dependency.toLowerCase());
      }
    } catch {
      continue;
    }
  }

  return [...names];
}

function readImportedPackageNames(files: ScannedFile[]): string[] {
  const names = new Set<string>();
  const importPattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+[^'"]+\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;

  for (const file of files.filter((item) =>
    [".ts", ".tsx", ".js", ".jsx"].includes(item.extension)
    && !isServiceSignalDefinitionFile(item.path)
  )) {
    let match = importPattern.exec(file.content);
    while (match) {
      const specifier = match[1].toLowerCase();
      if (!specifier.startsWith(".") && !specifier.startsWith("node:")) {
        names.add(specifier);
      }
      match = importPattern.exec(file.content);
    }
  }

  return [...names];
}

function readSourceServiceNames(files: ScannedFile[]): string[] {
  const services = new Set<string>();

  for (const file of files.filter((item) =>
    [".ts", ".tsx", ".js", ".jsx"].includes(item.extension)
    && !isServiceSignalDefinitionFile(item.path)
  )) {
    const content = file.content.toLowerCase();

    for (const [signals, service] of SOURCE_SERVICE_SIGNALS) {
      if (signals.some((signal) => content.includes(signal))) {
        services.add(service);
      }
    }
  }

  return [...services];
}

function isServiceSignalDefinitionFile(path: string): boolean {
  const fileName = path.toLowerCase().split("/").at(-1) ?? "";
  return fileName === "servicedetector.ts"
    || fileName === "servicedetector.tsx"
    || fileName === "servicedetector.js"
    || fileName === "servicedetector.jsx"
    || fileName === "featuredetector.ts"
    || fileName === "featuredetector.tsx"
    || fileName === "featuredetector.js"
    || fileName === "featuredetector.jsx";
}
