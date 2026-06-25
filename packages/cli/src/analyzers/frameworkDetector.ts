import type { ScannedFile } from "./fileScanner.js";
import { isArchitectureSource } from "./sourceScope.js";

export type Framework = "nextjs" | "react" | "express" | "astro" | "unknown";
export type DetectedFramework = Exclude<Framework, "unknown">;

export function detectFramework(files: ScannedFile[]): Framework {
  return detectFrameworks(files)[0] ?? "unknown";
}

export function detectFrameworks(files: ScannedFile[]): DetectedFramework[] {
  const detected = new Set<DetectedFramework>();

  // Phase 1: dependency manifest — highest confidence signal.
  // package.json is the canonical source of truth for what frameworks are installed.
  for (const dependencies of readManifestDependencies(files)) {
    if ("next" in dependencies) detected.add("nextjs");
    if ("express" in dependencies) detected.add("express");
    if ("astro" in dependencies) detected.add("astro");

    const hasReactRuntime = "react-dom" in dependencies
      || "react-scripts" in dependencies
      || "@vitejs/plugin-react" in dependencies
      || "@vitejs/plugin-react-swc" in dependencies;
    if (
      !("next" in dependencies)
      && !("astro" in dependencies)
      && "react" in dependencies
      && hasReactRuntime
    ) {
      detected.add("react");
    }
  }

  // Phase 2: file structure heuristics — secondary signal.
  // Only used when package.json is absent or incomplete (e.g. monorepo root without deps).
  const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

  // Next.js: next.config.* or App Router / Pages Router file conventions.
  // These patterns are Next.js-specific enough to safely add without gating.
  if (
    files.some((file) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(file.path))
    || sourceFiles.some((file) =>
      /(^|\/)(?:src\/)?app\/(?:.+\/)?(?:page|layout|route)\.[jt]sx?$/.test(file.path)
      || /(^|\/)(?:src\/)?pages\/(?:_app|_document|api\/)/.test(file.path)
    )
  ) {
    detected.add("nextjs");
  }

  // Express: ONLY add via file heuristic if express was already confirmed in package.json.
  //
  // Rationale: `server.ts` and `app.ts` are common filenames in Next.js, NestJS, and vanilla
  // Node projects. Without the dependency gate, a Next.js project with a custom `app.ts`
  // utility file would be misclassified as Express. The dep check is the authoritative signal;
  // the file pattern here is intentionally never used as a standalone trigger.
  //
  // If you need to support projects without package.json (rare), consider adding a stronger
  // file-based signal like scanning for `express()` call sites in the file content.
  if (
    detected.has("express")
    && sourceFiles.some((file) =>
      /(^|\/)(?:src\/)?(?:server|app)\.[cm]?[jt]s$/.test(file.path)
    )
  ) {
    // Already added via deps — this block intentionally left as documentation of the gate.
    // The detected.add("express") already happened above; we don't re-add.
  }

  // Astro: src/pages/*.astro is specific enough to be safe as a standalone signal.
  if (sourceFiles.some((file) => /(^|\/)src\/pages\/.+\.astro$/.test(file.path))) {
    detected.add("astro");
  }

  return FRAMEWORK_ORDER.filter((framework) => detected.has(framework));
}

const FRAMEWORK_ORDER: DetectedFramework[] = ["nextjs", "express", "react", "astro"];

function readManifestDependencies(files: ScannedFile[]): Array<Record<string, string>> {
  return files
    .filter((file) =>
      file.path.endsWith("package.json") && isArchitectureSource(file.path)
    )
    .map((file) => readDependencies(file.content));
}

function readDependencies(content: string): Record<string, string> {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      ...parsed.dependencies,
      ...parsed.devDependencies
    };
  } catch {
    return {};
  }
}
