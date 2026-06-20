import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ScannedFile } from "./fileScanner.js";
import type { Framework } from "./frameworkDetector.js";

export type ProjectLanguage = "typescript" | "javascript" | "mixed" | "unknown";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type ProjectType = "node-cli" | "web-app" | "api-service" | "library" | "unknown";
export type WorkspaceType = "monorepo" | "single-package";

export type ProjectMetadata = {
  name: string;
  root: string;
  framework: Framework;
  language: ProjectLanguage;
  packageManager: PackageManager;
  projectType: ProjectType;
  workspaceType: WorkspaceType;
  description?: string;
};

export function detectProjectMetadata(
  projectRoot: string,
  framework: Framework,
  files: ScannedFile[]
): ProjectMetadata {
  const manifests = readPackageManifests(files);
  const projectType = detectProjectType(framework, manifests);
  const primaryManifest = selectPrimaryManifest(manifests, projectType);

  return {
    name: readProjectName(manifests) ?? basename(projectRoot),
    root: projectRoot,
    framework,
    language: detectLanguage(files),
    packageManager: detectPackageManager(projectRoot),
    projectType,
    workspaceType: detectWorkspaceType(projectRoot, manifests),
    ...(primaryManifest?.description ? { description: primaryManifest.description } : {})
  };
}

type PackageManifest = {
  path: string;
  name?: string;
  description?: string;
  bin?: unknown;
  main?: unknown;
  exports?: unknown;
  workspaces?: unknown;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function readPackageManifests(files: ScannedFile[]): PackageManifest[] {
  return files
    .filter((file) => file.path.endsWith("package.json"))
    .flatMap((file) => {
      try {
        const parsed = JSON.parse(file.content) as Record<string, unknown>;
        return [{
          path: file.path,
          ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
          ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
          bin: parsed.bin,
          main: parsed.main,
          exports: parsed.exports,
          workspaces: parsed.workspaces,
          dependencies: isStringRecord(parsed.dependencies) ? parsed.dependencies : {},
          devDependencies: isStringRecord(parsed.devDependencies) ? parsed.devDependencies : {}
        }];
      } catch {
        return [];
      }
    });
}

function readProjectName(manifests: PackageManifest[]): string | null {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  return rootManifest?.name?.trim() || null;
}

function detectProjectType(
  framework: Framework,
  manifests: PackageManifest[]
): ProjectType {
  if (manifests.some((manifest) => manifest.bin)) return "node-cli";
  if (["nextjs", "react"].includes(framework) || hasDependency(manifests, "astro")) {
    return "web-app";
  }
  if (framework === "express") return "api-service";
  if (manifests.some((manifest) => manifest.exports || manifest.main)) return "library";
  return "unknown";
}

function selectPrimaryManifest(
  manifests: PackageManifest[],
  projectType: ProjectType
): PackageManifest | undefined {
  if (projectType === "node-cli") {
    return manifests.find((manifest) => manifest.bin);
  }

  return manifests.find((manifest) => manifest.path === "package.json") ?? manifests[0];
}

function detectWorkspaceType(
  projectRoot: string,
  manifests: PackageManifest[]
): WorkspaceType {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  return existsSync(join(projectRoot, "pnpm-workspace.yaml"))
    || Boolean(rootManifest?.workspaces)
    || manifests.length > 1
    ? "monorepo"
    : "single-package";
}

function hasDependency(manifests: PackageManifest[], dependency: string): boolean {
  return manifests.some((manifest) =>
    dependency in manifest.dependencies || dependency in manifest.devDependencies
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectLanguage(files: ScannedFile[]): ProjectLanguage {
  const typeScriptFiles = files.filter((file) =>
    [".ts", ".tsx", ".mts", ".cts"].includes(file.extension)
  ).length;
  const javaScriptFiles = files.filter((file) =>
    [".js", ".jsx", ".mjs", ".cjs"].includes(file.extension)
  ).length;

  if (typeScriptFiles > 0 && javaScriptFiles === 0) return "typescript";
  if (javaScriptFiles > 0 && typeScriptFiles === 0) return "javascript";
  if (typeScriptFiles >= javaScriptFiles * 2) return "typescript";
  if (javaScriptFiles >= typeScriptFiles * 2) return "javascript";
  if (typeScriptFiles > 0 && javaScriptFiles > 0) return "mixed";

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
