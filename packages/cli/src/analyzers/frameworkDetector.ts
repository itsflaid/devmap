import type { ScannedFile } from "./fileScanner.js";
import { isArchitectureSource } from "./sourceScope.js";

export type Framework = "nextjs" | "express" | "unknown";

export function detectFramework(files: ScannedFile[]): Framework {
  const packageJson = files.find((file) => file.path === "package.json");
  const dependencies = packageJson ? readDependencies(packageJson.content) : {};
  const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

  if (
    "next" in dependencies
    || sourceFiles.some((file) => /^(?:src\/)?(?:app|pages)\//.test(file.path))
  ) {
    return "nextjs";
  }

  if (
    "express" in dependencies
    || sourceFiles.some((file) => /^(?:src\/)?(?:server|app)\.[cm]?[jt]s$/.test(file.path))
  ) {
    return "express";
  }

  return "unknown";
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
