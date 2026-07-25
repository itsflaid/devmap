import type { ScannedFile } from "../index.js";
import type { EntityInfo, IEntityExtractor } from "./types.js";
import { singularize } from "./fallbackExtractor.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Raw SQL client packages. Deliberately narrow — these are the drivers
 * actually used without an ORM layer on top. Drivers that only ever show up
 * *underneath* an ORM (e.g. `pg` used by Drizzle) don't matter here: if an
 * ORM extractor higher in the EXTRACTORS chain already found entities, this
 * one never runs at all (orchestrator stops at first non-empty result).
 */
const RAW_SQL_IMPORTS = new Set([
  "pg", "pg-promise",
  "mysql2", "mysql2/promise", "mysql",
  "better-sqlite3", "sqlite3", "node:sqlite",
]);

/**
 * Table-like names that show up in real query strings but aren't domain
 * entities — internal Postgres/SQLite catalogs and migration bookkeeping.
 */
const NON_ENTITY_TABLE_NAMES = new Set([
  "information_schema", "pg_catalog", "pg_stat_activity",
  "sqlite_master", "sqlite_sequence", "sqlite_temp_master",
  "migrations", "schema_migrations", "knex_migrations", "_prisma_migrations",
]);

/**
 * Matches `from "pg"`, `require("mysql2")`, `require('better-sqlite3')`, etc.
 * Content-based rather than relying on parsed imports, since IEntityExtractor
 * only receives raw ScannedFile[] — same approach as the AI Integration
 * content fallback in featureDetector.ts.
 */
function usesRawSqlClient(content: string): boolean {
  return [...RAW_SQL_IMPORTS].some((pkg) => {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`from\\s+["']${escaped}["']|require\\(\\s*["']${escaped}["']\\s*\\)`, "i").test(content);
  });
}

/**
 * Pull table names out of query strings/template literals via the SQL
 * keywords that precede a table name in the vast majority of real queries.
 * This is intentionally not a SQL parser — just enough to turn
 * `SELECT * FROM users` into a "users" pseudo-entity.
 */
const STRING_LITERAL_PATTERN = /`([^`]*)`|"([^"]*)"|'([^']*)'/g;
const SQL_STATEMENT_PATTERN = /\b(?:select|insert|update|delete|with)\b/i;
const TABLE_NAME_PATTERN = /\b(?:from|into|update|join)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi;

function extractTableNames(content: string): string[] {
  const names = new Set<string>();

  let stringMatch = STRING_LITERAL_PATTERN.exec(content);
  while (stringMatch) {
    // Only look inside string/template literals that read as an actual SQL
    // statement — this is what keeps `import { Pool } from "pg"` from ever
    // being mistaken for a query (the literal "pg" has no SELECT/INSERT/etc).
    const literal = stringMatch[1] ?? stringMatch[2] ?? stringMatch[3] ?? "";
    if (SQL_STATEMENT_PATTERN.test(literal)) {
      TABLE_NAME_PATTERN.lastIndex = 0;
      let tableMatch = TABLE_NAME_PATTERN.exec(literal);
      while (tableMatch) {
        const table = tableMatch[1].toLowerCase();
        if (!NON_ENTITY_TABLE_NAMES.has(table)) {
          names.add(table);
        }
        tableMatch = TABLE_NAME_PATTERN.exec(literal);
      }
    }
    stringMatch = STRING_LITERAL_PATTERN.exec(content);
  }

  return [...names];
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * SQLExtractor — the "[future] SQL" slot already reserved in
 * extractors/index.ts. Produces pseudo-entities (name only, no fields or
 * relations — raw SQL has no schema metadata to read the way Prisma does)
 * from table names referenced in query strings, for projects with no ORM.
 */
export class SQLExtractor implements IEntityExtractor {
  readonly name = "sql";

  canHandle(files: ScannedFile[]): boolean {
    return files.some((file) => usesRawSqlClient(file.content));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const filesByTable = new Map<string, Set<string>>();

    for (const file of files) {
      for (const table of extractTableNames(file.content)) {
        const fileSet = filesByTable.get(table) ?? new Set<string>();
        fileSet.add(file.path);
        filesByTable.set(table, fileSet);
      }
    }

    const filesByEntityName = new Map<string, Set<string>>();
    for (const [table, tableFiles] of filesByTable) {
      const entityName = singularize(table);
      const existing = filesByEntityName.get(entityName) ?? new Set<string>();
      for (const file of tableFiles) existing.add(file);
      filesByEntityName.set(entityName, existing);
    }

    return [...filesByEntityName.entries()].map(([name, sourceFiles]) => ({
      name,
      fields: [],
      relations: [],
      source: "sql" as const,
      sourceFiles: [...sourceFiles].sort()
    }));
  }
}
