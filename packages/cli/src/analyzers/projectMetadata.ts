import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ScannedFile } from "./fileScanner.js";
import type { Framework } from "./frameworkDetector.js";

export type ProjectLanguage = "typescript" | "javascript" | "mixed" | "unknown";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

export type ProjectMetadata = {
  name: string;
  root: string;
  framework: Framework;
  language: ProjectLanguage;
  packageManager: PackageManager;
};

export function detectProjectMetadata(
  projectRoot: string,
  framework: Framework,
  files: ScannedFile[]
): ProjectMetadata {
  return {
    name: readProjectName(files) ?? basename(projectRoot),
    root: projectRoot,
    framework,
    language: detectLanguage(files),
    packageManager: detectPackageManager(projectRoot)
  };
}

function readProjectName(files: ScannedFile[]): string | null {
  const packageJson = files.find((file) => file.path === "package.json");
  if (!packageJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(packageJson.content) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : null;
  } catch {
    return null;
  }
}

function detectLanguage(files: ScannedFile[]): ProjectLanguage {
  const hasTypeScript = files.some((file) => [".ts", ".tsx", ".mts", ".cts"].includes(file.extension));
  const hasJavaScript = files.some((file) => [".js", ".jsx", ".mjs", ".cjs"].includes(file.extension));

  if (hasTypeScript && hasJavaScript) {
    return "mixed";
  }

  if (hasTypeScript) {
    return "typescript";
  }

  if (hasJavaScript) {
    return "javascript";
  }

  return "unknown";
}

function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (
    existsSync(join(projectRoot, "package-lock.json"))
    || existsSync(join(projectRoot, "npm-shrinkwrap.json"))
  ) {
    return "npm";
  }

  if (existsSync(join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"))) {
    return "bun";
  }

  return "unknown";
}
