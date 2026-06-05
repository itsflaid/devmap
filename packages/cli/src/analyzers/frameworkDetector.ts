import type { ScannedFile } from "./fileScanner.js";

export type Framework = "nextjs" | "express" | "unknown";

export function detectFramework(files: ScannedFile[]): Framework {
  const packageJson = files.find((file) => file.path === "package.json");
  const dependencies = packageJson ? readDependencies(packageJson.content) : {};

  if ("next" in dependencies || files.some((file) => file.path.startsWith("app/"))) {
    return "nextjs";
  }

  if ("express" in dependencies || files.some((file) => /(^|\/)(server|app)\.[cm]?[jt]s$/.test(file.path))) {
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
