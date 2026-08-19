import { Project, ScriptTarget, SyntaxKind } from "ts-morph";
import type { ScannedFile } from "../index.js";
import type { EntityInfo, IEntityExtractor } from "./types.js";
import { singularize } from "./fallbackExtractor.js";
import { isArchitectureSource } from "../../graph/index.js";

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
 * Common English function words that land right after from/into/update/join
 * in ordinary UI copy — "Update your profile", "select a file from your
 * computer" — but are never real table names. Without this, any project with
 * a raw SQL client anywhere and normal SaaS/checkout copy elsewhere (confirm
 * dialogs, toasts, form hints) produces bogus pseudo-entities like "Your".
 */
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "your", "my", "our", "their", "his", "her", "its",
  "all", "any", "some", "each", "us", "you", "me", "them",
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
 * Pull table names out of query strings via the SQL keywords that precede a
 * table name in the vast majority of real queries. This is intentionally not
 * a SQL parser — just enough to turn `SELECT * FROM users` into a "users"
 * pseudo-entity.
 *
 * String *boundaries* come from a real AST (ts-morph — already a dependency,
 * already used the same way in tsMorphAnalyzer.ts), not from regex-pairing
 * quote characters. A naive `"([^"]*)"` scan pairs the Nth quote with the
 * (N+1)th regardless of which statement they actually belong to, so a single
 * apostrophe in a comment ("doesn't", "it's") throws off parity for
 * everything after it — silently merging JSDoc prose and unrelated code into
 * one fake "string" that gets scanned for SQL-shaped phrases. AST nodes don't
 * have that failure mode: a StringLiteral node is exactly the source text
 * between one real quote pair, comments and JSX text are different node
 * kinds entirely, so this can't happen.
 */
const SQL_STATEMENT_PATTERN = /\b(?:select|insert|update|delete|with)\b/i;
const TABLE_NAME_PATTERN = /\b(?:from|into|update|join)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi;

// Real table identifiers are lowercase/snake_case (`users`, `order_items`) or,
// rarely, SCREAMING_CASE. A captured word that starts with a capital letter
// followed by a lowercase letter (`DevMap`, `Stripe`, `Your`) reads as a
// proper noun or a sentence's first word, not a table — the residual gap
// after the stopword list, which can only ever cover words we thought to
// list, not arbitrary product/brand names in CLI help text or UI copy.
const TITLE_CASE_PATTERN = /^[A-Z][a-z]/;
const SQL_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const literalProject = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, target: ScriptTarget.ES2022 }
});

function stringLiteralsIn(content: string): string[] {
  const literals: string[] = [];
  try {
    const sourceFile = literalProject.createSourceFile("__sql-scan.tsx", content, { overwrite: true });
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      literals.push(node.getLiteralText());
    }
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
      literals.push(node.getLiteralText());
    }
    literalProject.removeSourceFile(sourceFile);
  } catch {
    // Best-effort: a file ts-morph can't parse just contributes no literals,
    // same as a file with no SQL-shaped strings at all.
  }
  return literals;
}

function extractTableNames(file: ScannedFile): string[] {
  const names = new Set<string>();
  if (!SQL_SOURCE_EXTENSIONS.has(file.extension)) return [];

  for (const literal of stringLiteralsIn(file.content)) {
    if (!SQL_STATEMENT_PATTERN.test(literal)) continue;
    TABLE_NAME_PATTERN.lastIndex = 0;
    let tableMatch = TABLE_NAME_PATTERN.exec(literal);
    while (tableMatch) {
      const raw = tableMatch[1];
      const table = raw.toLowerCase();
      if (!NON_ENTITY_TABLE_NAMES.has(table) && !ENGLISH_STOPWORDS.has(table) && !TITLE_CASE_PATTERN.test(raw)) {
        names.add(table);
      }
      tableMatch = TABLE_NAME_PATTERN.exec(literal);
    }
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
    return files.some((file) => isArchitectureSource(file.path) && usesRawSqlClient(file.content));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const filesByTable = new Map<string, Set<string>>();
    const sourceFiles = files.filter((file) => isArchitectureSource(file.path));

    for (const file of sourceFiles) {
      for (const table of extractTableNames(file)) {
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
