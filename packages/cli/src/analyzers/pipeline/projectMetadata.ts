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

export type ProjectLanguage =
  | "typescript"
  | "javascript"
  | "mixed"
  | "php"
  | "python"
  | "ruby"
  | "go"
  | "java"
  | "csharp"
  | "rust"
  | "unknown";

const LANGUAGE_LABELS: Partial<Record<ProjectLanguage, string>> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  php: "PHP",
  csharp: "C#"
};

/** Display name for a detected language: "typescript" → "TypeScript", "csharp" → "C#". */
export function languageLabel(language: ProjectLanguage): string {
  return LANGUAGE_LABELS[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

/** Server-side languages DevMap reads heuristically. Only used to say what a project is NOT JS/TS. */
const OTHER_LANGUAGE_EXTENSIONS: ReadonlyArray<readonly [ProjectLanguage, readonly string[]]> = [
  ["php", [".php"]],
  ["python", [".py"]],
  ["ruby", [".rb"]],
  ["go", [".go"]],
  ["java", [".java"]],
  ["csharp", [".cs"]],
  ["rust", [".rs"]]
];
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";
export type ProjectType = "node-cli" | "web-app" | "api-service" | "library" | "vscode-extension" | "unknown";

export type WorkspaceType = "monorepo" | "single-package";

export type ProjectMetadata = {
  name: string;
  root: string;
  framework: Framework;
  /** The winner of each category (frontend, backend); route detection is gated on it. */
  frameworks: DetectedFramework[];
  /** Every framework the project shows signals for, so a monorepo names all its frontends. Absent in older snapshots. */
  detectedFrameworks?: DetectedFramework[];
  language: ProjectLanguage;
  packageManager: PackageManager;
  projectTypes: ProjectType[];
  workspaceType: WorkspaceType;
  description?: string;
};

/** Every framework to show a reader; falls back to the winners for snapshots written before the field existed. */
export function allFrameworks(project: Pick<ProjectMetadata, "frameworks" | "detectedFrameworks">): DetectedFramework[] {
  return project.detectedFrameworks ?? project.frameworks;
}

export function detectProjectMetadata(
  projectRoot: string,
  framework: Framework,
  files: ScannedFile[],
  frameworks: DetectedFramework[] = framework === "unknown" ? [] : [framework],
  detectedFrameworks: DetectedFramework[] = frameworks
): ProjectMetadata {
  const manifests = readPackageManifests(files);
  const workspacePatterns = readWorkspacePatterns(files, manifests);
  const projectManifests = manifests.filter((manifest) =>
    isProjectManifest(manifest, workspacePatterns, frameworks)
  );
  const projectTypes = detectProjectTypes(frameworks, manifests, projectManifests);
  const primaryManifest = selectPrimaryManifest(manifests, projectTypes);
  const workspaceType: WorkspaceType = workspacePatterns.length > 0 || projectManifests.length > 1
    ? "monorepo"
    : "single-package";
  const primaryFramework = isRootCliOrLibrary(manifests, framework, frameworks) ? "unknown" : framework;

  return {
    name: readProjectName(manifests) ?? basename(projectRoot),
    root: projectRoot,
    framework: primaryFramework,
    frameworks,
    detectedFrameworks,
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
  detected: DetectedFramework[]
): boolean {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  if (!rootManifest) return false;

  if (rootManifest.bin) return true;

  // `npm init` writes "main": "index.js" into every package, including plain
  // Express/Next apps. A root that itself declares the detected framework is
  // that app, not a library, whatever its main/exports say.
  if (framework !== "unknown" && declaresFramework(rootManifest, framework, detected)) return false;

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

function declaresFramework(
  manifest: PackageManifest,
  framework: Framework,
  detected: DetectedFramework[]
): boolean {
  // A server framework that is only a devDependency is test tooling (a mock
  // server) unless production code imports it, which detectFrameworks() already
  // checked: only a detected one may count through devDependencies.
  const declared = BACKEND_FRAMEWORK_SET.has(framework) && !detected.includes(framework as DetectedFramework)
    ? manifest.dependencies
    : { ...manifest.dependencies, ...manifest.devDependencies };
  return (FRAMEWORK_DEPENDENCIES[framework] ?? []).some((dependency) => dependency in declared);
}

function declaresAnyFramework(manifest: PackageManifest, detected: DetectedFramework[]): boolean {
  return Object.keys(FRAMEWORK_DEPENDENCIES).some((framework) =>
    declaresFramework(manifest, framework as Framework, detected)
  );
}

function readProjectName(manifests: PackageManifest[]): string | null {
  const rootManifest = manifests.find((manifest) => manifest.path === "package.json");
  return rootManifest?.name?.trim() || null;
}

function detectProjectTypes(
  frameworks: DetectedFramework[],
  manifests: PackageManifest[],
  projectManifests: PackageManifest[]
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
  // Only the root and real workspace members can make the repo a library: a
  // nested helper package (a template's init script, say) is not something the
  // repo publishes.
  if (projectManifests.some((manifest) =>
    (manifest.exports || manifest.main)
    && !manifest.bin
    && !declaresAnyFramework(manifest, frameworks)
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

const CONVENTIONAL_MEMBER_DIRECTORY = /^(?:apps|packages|libs|services|projects|modules)\//;

function manifestDirectory(path: string): string {
  return path.slice(0, Math.max(0, path.length - "package.json".length - 1));
}

/**
 * Workspace globs the root declares: package.json `workspaces` and the
 * `packages:` list of pnpm-workspace.yaml. pnpm 10 keeps plain settings
 * (`onlyBuiltDependencies`, ...) in that file too, so its mere presence says
 * nothing about a monorepo.
 */
function readWorkspacePatterns(files: ScannedFile[], manifests: PackageManifest[]): string[] {
  const rootWorkspaces = manifests.find((manifest) => manifest.path === "package.json")?.workspaces;
  const fromManifest = Array.isArray(rootWorkspaces)
    ? rootWorkspaces
    : typeof rootWorkspaces === "object" && rootWorkspaces !== null
      && Array.isArray((rootWorkspaces as { packages?: unknown }).packages)
      ? (rootWorkspaces as { packages: unknown[] }).packages
      : [];
  const pnpmFile = files.find((file) => file.path === "pnpm-workspace.yaml");
  const fromPnpm = pnpmFile ? readPnpmWorkspacePackages(pnpmFile.content) : [];

  return [...fromManifest.filter((item): item is string => typeof item === "string"), ...fromPnpm]
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0 && !pattern.startsWith("!") && !isRootPattern(pattern));
}

/** `packages: ["."]` names the root itself, which is the project and not a member of it. */
function isRootPattern(pattern: string): boolean {
  const directory = pattern.replace(/^\.\//, "").replace(/\/+$/, "").replace(/\/package\.json$/, "");
  return directory === "" || directory === ".";
}

function readPnpmWorkspacePackages(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s+)#.*$/, "");
    const header = line.match(/^packages\s*:\s*(.*)$/);
    if (header) {
      const inline = header[1].trim();
      inPackages = inline === "";
      if (inline.startsWith("[")) {
        patterns.push(...inline.replace(/^\[|\]$/g, "").split(",").map(unquote));
      }
      continue;
    }
    if (!inPackages) continue;

    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) patterns.push(unquote(item[1]));
    else if (/^\S/.test(line)) inPackages = false;
  }

  return patterns;
}

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function matchesWorkspacePattern(directory: string, pattern: string): boolean {
  const source = pattern
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/\/package\.json$/, "")
    .split("/")
    .map((segment) => segment === "**"
      ? ".*"
      : segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join("/");
  return new RegExp(`^${source}$`).test(directory);
}

/**
 * The root, a declared or conventionally placed workspace member, or a nested
 * package that is itself an app. A nested package.json that is none of these
 * (a template's init script, a docs helper) is not a package of this project.
 */
function isProjectManifest(
  manifest: PackageManifest,
  patterns: string[],
  detected: DetectedFramework[]
): boolean {
  if (manifest.path === "package.json") return true;
  const directory = manifestDirectory(manifest.path);
  return patterns.some((pattern) => matchesWorkspacePattern(directory, pattern))
    || CONVENTIONAL_MEMBER_DIRECTORY.test(directory)
    || declaresAnyFramework(manifest, detected);
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

  const dominantOther = OTHER_LANGUAGE_EXTENSIONS
    .map(([language, extensions]) => ({
      language,
      count: files.filter((file) => extensions.includes(file.extension)).length
    }))
    .reduce((best, candidate) => (candidate.count > best.count ? candidate : best), { language: "unknown" as ProjectLanguage, count: 0 });

  // A Laravel app with a handful of Vue/JS files is a PHP project, not a JavaScript one.
  if (dominantOther.count > typeScriptFiles + javaScriptFiles) return dominantOther.language;

  if (typeScriptFiles === 0 && javaScriptFiles === 0) return "unknown";
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
