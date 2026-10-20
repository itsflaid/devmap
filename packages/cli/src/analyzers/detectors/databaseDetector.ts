import { parseJsonText, type ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";

export type DatabaseInfo = {
  /** The main data layer: ORM/BaaS first, then drivers. */
  provider: string;
  files: string[];
  /** Other data stores the project also depends on (e.g. Redis next to Prisma). */
  additional?: string[];
};

type DatabaseSignal = {
  provider: string;
  /**
   * `driver` talks to a database an ORM/BaaS already sits on, so it only
   * shows up as an extra store when nothing higher-level was found.
   */
  kind: "orm" | "baas" | "driver" | "cache";
  dependencies: string[];
  /** Specific enough to count with no matching dependency. */
  paths: RegExp[];
  /** Only name this provider's files once a dependency confirms it. */
  weakPaths?: RegExp[];
};

// Order is priority: the first match becomes `provider`, later matches become
// `additional`. ORMs and backend-as-a-service describe an app's data model
// better than the driver underneath them, and a cache is never the main store.
const DATABASE_SIGNALS: DatabaseSignal[] = [
  {
    provider: "Prisma",
    kind: "orm",
    dependencies: ["@prisma/client", "prisma"],
    paths: [/(^|\/)schema\.prisma$/, /(^|\/)prisma\//]
  },
  {
    provider: "Drizzle",
    kind: "orm",
    dependencies: ["drizzle-orm"],
    paths: [/(^|\/)drizzle\.config\.[cm]?[jt]s$/, /(^|\/)drizzle\//]
  },
  {
    provider: "TypeORM",
    kind: "orm",
    dependencies: ["typeorm", "@nestjs/typeorm"],
    paths: [],
    weakPaths: [/\.entity\.[cm]?[jt]s$/]
  },
  {
    provider: "Sequelize",
    kind: "orm",
    dependencies: ["sequelize", "sequelize-typescript", "@nestjs/sequelize"],
    paths: [/(^|\/)\.sequelizerc$/],
    weakPaths: [/(^|\/)(models?|migrations)\//]
  },
  {
    provider: "MikroORM",
    kind: "orm",
    dependencies: ["@mikro-orm/core"],
    paths: [],
    weakPaths: [/\.entity\.[cm]?[jt]s$/]
  },
  {
    provider: "Kysely",
    kind: "orm",
    dependencies: ["kysely"],
    paths: []
  },
  {
    provider: "Knex",
    kind: "orm",
    dependencies: ["knex"],
    paths: [/(^|\/)knexfile\.[cm]?[jt]s$/],
    weakPaths: [/(^|\/)migrations\//]
  },
  {
    provider: "Mongoose",
    kind: "orm",
    dependencies: ["mongoose", "@nestjs/mongoose", "@typegoose/typegoose"],
    paths: [],
    // `models/` and `schemas/` exist in every kind of project; only name them
    // as Mongoose files when mongoose is actually installed.
    weakPaths: [/(^|\/)(models?|schemas?)\//]
  },
  {
    provider: "Supabase",
    kind: "baas",
    dependencies: ["@supabase/supabase-js", "@supabase/ssr"],
    paths: [/(^|\/)supabase\//]
  },
  {
    provider: "Firebase",
    kind: "baas",
    dependencies: ["firebase", "firebase-admin", "@firebase/firestore"],
    paths: [/(^|\/)firestore\.rules$/]
  },
  {
    provider: "Convex",
    kind: "baas",
    dependencies: ["convex"],
    paths: [/(^|\/)convex\/schema\.[cm]?[jt]s$/]
  },
  {
    provider: "PocketBase",
    kind: "baas",
    dependencies: ["pocketbase"],
    paths: []
  },
  {
    provider: "MongoDB (native driver)",
    kind: "driver",
    dependencies: ["mongodb"],
    paths: []
  },
  {
    provider: "PostgreSQL (raw SQL)",
    kind: "driver",
    dependencies: ["pg", "pg-promise", "postgres", "@neondatabase/serverless", "@vercel/postgres"],
    paths: []
  },
  {
    provider: "MySQL (raw SQL)",
    kind: "driver",
    dependencies: ["mysql2", "mysql", "@planetscale/database"],
    paths: []
  },
  {
    provider: "SQLite (raw SQL)",
    kind: "driver",
    dependencies: ["better-sqlite3", "sqlite3", "sqlite", "@libsql/client"],
    paths: []
  },
  {
    provider: "Redis",
    kind: "cache",
    dependencies: ["redis", "ioredis", "@upstash/redis"],
    paths: []
  }
];

export function detectDatabase(files: ScannedFile[]): DatabaseInfo | undefined {
  const scopedFiles = files.filter((file) => isArchitectureSource(file.path));
  const dependencies = readDependencies(scopedFiles);

  const matches: Array<{ provider: string; kind: DatabaseSignal["kind"]; files: string[] }> = [];

  for (const signal of DATABASE_SIGNALS) {
    const dependencyMatch = signal.dependencies.some((dependency) => dependencies.has(dependency));
    const patterns = dependencyMatch ? [...signal.paths, ...(signal.weakPaths ?? [])] : signal.paths;

    const matchedFiles = scopedFiles
      .filter((file) => patterns.some((pattern) => pattern.test(file.path)))
      .map((file) => file.path)
      .sort();

    if (dependencyMatch || matchedFiles.length > 0) {
      matches.push({ provider: signal.provider, kind: signal.kind, files: matchedFiles });
    }
  }

  // A cache is a store worth listing next to a database, never the database.
  const primaryIndex = matches.findIndex((match) => match.kind !== "cache");
  if (primaryIndex === -1) return undefined;

  const primary = matches[primaryIndex];
  const rest = matches.filter((_, index) => index !== primaryIndex);

  const primaryIsDriver = primary.kind === "driver";
  const others = rest.filter((match) => match.kind !== "driver" || primaryIsDriver);

  return {
    provider: primary.provider,
    files: primary.files,
    ...(others.length > 0 ? { additional: others.map((match) => match.provider) } : {})
  };
}

function readDependencies(files: ScannedFile[]): Set<string> {
  const dependencies = new Set<string>();

  for (const file of files.filter((item) => item.path.endsWith("package.json"))) {
    try {
      const parsed = parseJsonText(file.content) as {
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
