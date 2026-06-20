import type { ScannedFile } from "./fileScanner.js";
import { isArchitectureSource } from "./sourceScope.js";

export type Framework = "nextjs" | "react" | "express" | "unknown";

export function detectFramework(files: ScannedFile[]): Framework {
  const dependencies = readAllDependencies(files);
  const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

  if (
    "next" in dependencies
    || files.some((file) => /^next\.config\.[cm]?[jt]s$/.test(file.path))
    || sourceFiles.some((file) =>
      /^(?:src\/)?app\/(?:.+\/)?(?:page|layout|route)\.[jt]sx?$/.test(file.path)
      || /^(?:src\/)?pages\/(?:_app|_document|api\/)/.test(file.path)
    )
  ) {
    return "nextjs";
  }

  if (
    "express" in dependencies
    || sourceFiles.some((file) => /^(?:src\/)?(?:server|app)\.[cm]?[jt]s$/.test(file.path))
  ) {
    return "express";
  }

  const hasReactRuntime = "react-dom" in dependencies
    || "react-scripts" in dependencies
    || "@vitejs/plugin-react" in dependencies
    || "@vitejs/plugin-react-swc" in dependencies;
  const hasReactSource = sourceFiles.some((file) =>
    /\.[jt]sx$/.test(file.path)
    || /(?:from\s+["']react["']|from\s+["']react-dom(?:\/client)?["']|require\(["']react["']\))/.test(file.content)
  );

  if ("react" in dependencies && hasReactRuntime && hasReactSource) {
    return "react";
  }

  return "unknown";
}

function readAllDependencies(files: ScannedFile[]): Record<string, string> {
  return files
    .filter((file) => file.path.endsWith("package.json"))
    .reduce((dependencies, file) => ({
      ...dependencies,
      ...readDependencies(file.content)
    }), {} as Record<string, string>);
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
