import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";

export type DatabaseInfo = {
  provider: string;
  files: string[];
};

const DATABASE_SIGNALS: Array<{
  provider: string;
  dependencies: string[];
  paths: RegExp[];
}> = [
  {
    provider: "Prisma",
    dependencies: ["@prisma/client", "prisma"],
    paths: [/(^|\/)schema\.prisma$/, /(^|\/)prisma\//]
  },
  {
    provider: "Drizzle",
    dependencies: ["drizzle-orm"],
    paths: [/(^|\/)drizzle\.config\.[cm]?[jt]s$/, /(^|\/)drizzle\//]
  },
  {
    provider: "Mongoose",
    dependencies: ["mongoose"],
    paths: [/(^|\/)(models?|schemas?)\//]
  },
  {
    provider: "Supabase",
    dependencies: ["@supabase/supabase-js"],
    paths: [/(^|\/)supabase\//]
  }
];

export function detectDatabase(files: ScannedFile[]): DatabaseInfo | undefined {
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));
  const dependencies = readDependencies(scopedFiles);

  for (const signal of DATABASE_SIGNALS) {
    const matchedFiles = scopedFiles
      .filter((file) => signal.paths.some((pattern) => pattern.test(file.path)))
      .map((file) => file.path)
      .sort();
    const dependencyMatch = signal.dependencies.some((dependency) => dependencies.has(dependency));

    if (dependencyMatch || matchedFiles.length > 0) {
      return {
        provider: signal.provider,
        files: matchedFiles
      };
    }
  }

  return undefined;
}

function readDependencies(files: ScannedFile[]): Set<string> {
  const dependencies = new Set<string>();

  for (const file of files.filter((item) => item.path.endsWith("package.json"))) {
    try {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      Object.keys(parsed.dependencies ?? {}).forEach((name) => dependencies.add(name.toLowerCase()));
      Object.keys(parsed.devDependencies ?? {}).forEach((name) => dependencies.add(name.toLowerCase()));
    } catch {
      continue;
    }
  }

  return dependencies;
}
