import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ScannedFile } from "../analysis/fileScanner.js";
import { parseJsonText } from "../analysis/jsonText.js";
import {
  BACKEND_FRAMEWORK_SET,
  FRONTEND_FRAMEWORK_SET,
  type DetectedFramework,
  type Framework,
} from "../detectors/frameworkDetector.js";
import { isArchitectureSource } from "../graph/index.js";

export type ProjectLanguage = "typescript" | "javascript" | "mixed" | "unknown";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type ProjectType = "node-cli" | "web-app" | "api-service" | "library" | "vscode-extension" | "unknown";

export type WorkspaceType = "monorepo" | "single-package";

export type ProjectMetadata = {
  name: string;
  root: string;
  framework: Framework;
  frameworks: DetectedFramework[];
  language: ProjectLanguage;
  packageManager: PackageManager;
  projectTypes: ProjectType[];
  workspaceType: WorkspaceType;
  description?: string;
};

export function detectProjectMetadata(
  projectRoot: string,
  framework: Framework,
  files: ScannedFile[],
  frameworks: DetectedFramework[] = framework === "unknown" ? [] : [framework]
): ProjectMetadata {
  const manifests = readPackageManifests(files);
  // `remix.init/package.json` is a template hook that runs once after scaffolding.
  // Its `main` would otherwise label a Remix app as a library as well.
  const projectTypes = detectProjectTypes(frameworks, manifests.filter((manifest) => !SCAFFOLD_HOOK_MANIFEST.test(manifest.path)));
  const primaryManifest = selectPrimaryManifest(manifests, projectTypes);
  const workspaceType = detectWorkspaceType(files, manifests);
  const primaryFramework = isRootCliOrLibrary(manifests, framework, frameworks) ? "unknown" : framework;

  return {
    name: readProjectName(manifests) ?? basename(projectRoot),
    root: projectRoot,
    framework: primaryFramework,
    frameworks,
    language: detectLanguage(files),
    packageManager: detectPackageManager(projectRoot, manifests),
    projectTypes,
    workspaceType,
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
  engines?: unknown;
  contributes?: unknown;
  workspaces?: unknown;
  packageManager?: unknown;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function readPackageManifests(files: ScannedFile[]): PackageManifest[] {
  return files
    .filter((file) => file.path.endsWith("package.json") && isArchitectureSource(file.path))
    .flatMap((file) => {
      try {
        const parsed = parseJsonText(file.content) as Record<string, unknown>;
        return [{
          path: file.path,
          ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
          ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
          bin: parsed.bin,
          main: parsed.main,
          exports: parsed.exports,
          engines: parsed.engines,
          contributes: parsed.contributes,
          workspaces: parsed.workspaces,
          packageManager: parsed.packageManager,
          dependencies: isStringRecord(parsed.dependencies) ? parsed.dependencies : {},
          devDependencies: isStringRecord(parsed.devDependencies) ? parsed.devDependencies : {}
        }];
      } catch {
        return [];
      }
    });
}

/**
 * Whether the ROOT package itself (not any nested workspace member) is
 * shaped like a CLI or a library. Deliberately scoped to the root manifest
 * only — unlike `detectProjectTypes`, which intentionally checks every
 * manifest so `projectTypes` can report "this repo also contains a CLI"
 * as one of several labels. That whole-tree check must not be reused here:
 * a monorepo root (e.g. a private workspace with no bin/main/exports of its
 * own) that merely CONTAINS a CLI subpackage (e.g. packages/cli) is not
 * itself a CLI, and shouldn't have its correctly-detected framework (e.g.
 * an Astro app living in apps/web) blanked out to "unknown" because of it.
 */
function isRootCliOrLibrary(
  manifests: PackageManifest[],
  framework: Framework,
  frameworks: DetectedFramework[]
): boolean {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  if (!rootManifest) return false;

  if (rootManifest.bin) return true;

  // `npm init` writes "main": "index.js" into every package, including plain
  // Express/Next apps. A root that itself declares one of the detected
  // frameworks is that app, not a library, whatever its main/exports say. The
  // primary framework can live elsewhere: in a MERN repo the root is the
  // Express server while React, which wins the frontend slot, is in `frontend/`.
  const candidates = framework === "unknown" ? frameworks : [framework, ...frameworks];
  if (candidates.some((candidate) => declaresFramework(rootManifest, candidate))) return false;

  return Boolean(rootManifest.exports || rootManifest.main);
}

// Runtime dependency whose presence in a manifest means "this package is that app".
const FRAMEWORK_DEPENDENCIES: Record<string, string[]> = {
  nextjs: ["next"],
  nuxt: ["nuxt"],
  sveltekit: ["@sveltejs/kit"],
  astro: ["astro"],
  remix: ["@remix-run/react", "@remix-run/dev", "@remix-run/node", "@remix-run/cloudflare"],
  "react-router": ["@react-router/dev"],
  "tanstack-start": ["@tanstack/react-start", "@tanstack/solid-start", "@tanstack/start"],
  "tanstack-router": ["@tanstack/react-router", "@tanstack/solid-router"],
  expo: ["expo-router", "expo"],
  "solid-start": ["@solidjs/start", "solid-start"],
  qwik: ["@builder.io/qwik-city", "@builder.io/qwik", "@qwik.dev/router", "@qwik.dev/core"],
  angular: ["@angular/core"],
  react: ["react-dom", "react-scripts"],
  vue: ["vue"],
  svelte: ["svelte"],
  nestjs: ["@nestjs/core"],
  fastify: ["fastify"],
  express: ["express"],
  hono: ["hono"],
  elysia: ["elysia"],
  adonisjs: ["@adonisjs/core", "@adonisjs/framework"],
  koa: ["koa"]
};

function declaresFramework(manifest: PackageManifest, framework: Framework): boolean {
  return (FRAMEWORK_DEPENDENCIES[framework] ?? []).some((dependency) =>
    dependency in manifest.dependencies || dependency in manifest.devDependencies
  );
}

function declaresAnyFramework(manifest: PackageManifest): boolean {
  return Object.keys(FRAMEWORK_DEPENDENCIES).some((framework) => declaresFramework(manifest, framework as Framework));
}

function readProjectName(manifests: PackageManifest[]): string | null {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  return rootManifest?.name?.trim() || null;
}

function detectProjectTypes(
  frameworks: DetectedFramework[],
  manifests: PackageManifest[]
): ProjectType[] {
  const types = new Set<ProjectType>();

  if (frameworks.some((f) => FRONTEND_FRAMEWORK_SET.has(f)) || hasDependency(manifests, "astro")) {
    types.add("web-app");
  }
  if (frameworks.some((f) => BACKEND_FRAMEWORK_SET.has(f))) {
    types.add("api-service");
  }
  if (manifests.some((manifest) => manifest.bin)) {
    types.add("node-cli");
  }
  if (manifests.some(isVscodeExtension)) {
    types.add("vscode-extension");
  }
  // A package that ships an app framework with its default "main" is an app,
  // not a library. An editor extension's "main" is its activation entry, not a public API.
  if (manifests.some((manifest) =>
    (manifest.exports || manifest.main)
    && !manifest.bin
    && !declaresAnyFramework(manifest)
    && !isVscodeExtension(manifest)
  )) {
    types.add("library");
  }

  return types.size > 0 ? [...types] : ["unknown"];
}

function isVscodeExtension(manifest: PackageManifest): boolean {
  const engines = manifest.engines;
  const declaresVscodeEngine = typeof engines === "object"
    && engines !== null
    && "vscode" in engines;
  return declaresVscodeEngine || Boolean(manifest.contributes);
}

function selectPrimaryManifest(
  manifests: PackageManifest[],
  projectTypes: ProjectType[]
): PackageManifest | undefined {
  if (projectTypes.includes("node-cli")) {
    return manifests.find((manifest) => manifest.bin);
  }

  return manifests.find((manifest) => manifest.path === "package.json") ?? manifests[0];
}

// Package manifests that live in tooling or sample folders are not workspace
// members: Remix's `remix.init/package.json`, a `scripts/` helper, fixtures.
const NON_MEMBER_MANIFEST_DIR =
  /(^|\/)(?:[^/]+\.init|scripts?|tools?|e2e|cypress|docs?|examples?|fixtures?|templates?|tests?|__tests__|\.[^/]+)(?:\/|$)/i;

const SCAFFOLD_HOOK_MANIFEST = /(^|\/)[^/]+\.init\/package\.json$/;

function detectWorkspaceType(
  files: ScannedFile[],
  manifests: PackageManifest[]
): WorkspaceType {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  const nestedDirs = manifests
    .filter((manifest) => manifest.path !== "package.json")
    .map((manifest) => manifest.path.slice(0, -"/package.json".length));

  // A declared workspace is a monorepo only when it actually has a member.
  // `packages: ["."]` or a lone `onlyBuiltDependencies` key in
  // pnpm-workspace.yaml is just single-package pnpm configuration. Declared
  // members are trusted as written, so `apps/docs` still counts.
  const patterns = [
    ...readManifestWorkspacePatterns(rootManifest?.workspaces),
    ...readPnpmWorkspacePatterns(files.find((file) => file.path === "pnpm-workspace.yaml")?.content)
  ];
  if (patterns.length > 0) {
    return nestedDirs.some((directory) => matchesWorkspacePatterns(directory, patterns))
      ? "monorepo"
      : "single-package";
  }

  // Nothing declared: several manifests still make a multi-package repo
  // (`frontend/` + `backend/`), unless the extra one is tooling or a sample.
  return nestedDirs.some((directory) => !NON_MEMBER_MANIFEST_DIR.test(directory))
    ? "monorepo"
    : "single-package";
}

function readManifestWorkspacePatterns(workspaces: unknown): string[] {
  const list = Array.isArray(workspaces)
    ? workspaces
    : typeof workspaces === "object" && workspaces !== null && "packages" in workspaces
      ? (workspaces as { packages?: unknown }).packages
      : [];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Reads the `packages:` list of pnpm-workspace.yaml without a YAML parser:
 * block items (`- apps/*`) and the inline form (`packages: ["a", "b"]`).
 */
function readPnpmWorkspacePatterns(content: string | undefined): string[] {
  if (!content) return [];

  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");
  const lines = content.split(/\r?\n/);
  const patterns: string[] = [];
  let inPackages = false;

  for (const line of lines) {
    const withoutComment = line.replace(/\s+#.*$/, "");
    if (/^\S/.test(withoutComment)) {
      inPackages = /^packages\s*:/.test(withoutComment);
      const inline = withoutComment.match(/^packages\s*:\s*\[(.*)\]\s*$/);
      if (inline) {
        patterns.push(...inline[1].split(",").map(unquote).filter(Boolean));
        inPackages = false;
      }
      continue;
    }
    const item = inPackages ? withoutComment.match(/^\s+-\s+(.+)$/) : null;
    if (item) patterns.push(unquote(item[1]));
  }

  return patterns;
}

function matchesWorkspacePatterns(directory: string, patterns: string[]): boolean {
  const toRegExp = (pattern: string) => {
    const source = pattern
      .replace(/^\.\//, "")
      .replace(/\/+$/, "")
      .split("/")
      .map((segment) => segment === "**"
        ? ".*"
        : segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
      .join("/");
    return new RegExp(`^${source}$`);
  };

  const included = patterns.filter((pattern) => !pattern.startsWith("!") && pattern !== ".");
  const excluded = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));

  return included.some((pattern) => toRegExp(pattern).test(directory))
    && !excluded.some((pattern) => toRegExp(pattern).test(directory));
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

function detectPackageManager(
  projectRoot: string,
  manifests: PackageManifest[]
): PackageManager {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  const declared = typeof rootManifest?.packageManager === "string"
    ? rootManifest.packageManager.split("@")[0]
    : null;
  if (declared === "pnpm") return "pnpm";
  if (declared === "npm") return "npm";
  if (declared === "yarn") return "yarn";
  if (declared === "bun") return "bun";

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
