import { Project, ScriptTarget, SyntaxKind } from "ts-morph";
import type { ScannedFile } from "../index.js";
import type { EntityInfo, IEntityExtractor } from "./types.js";
import { resourceEntityName } from "./fallbackExtractor.js";
import { isArchitectureSource } from "../../graph/sourceScope.js";

/**
 * Raw SQL client packages, kept narrow to drivers used without an ORM. A driver under an ORM
 * (e.g. `pg` under Drizzle) is irrelevant: the ORM extractor earlier in the chain wins and
 * this one never runs.
 */
const RAW_SQL_IMPORTS = new Set([
  "pg", "pg-promise",
  "mysql2", "mysql2/promise", "mysql",
  "better-sqlite3", "sqlite3", "node:sqlite",
]);

/** Names that appear in real queries but are not domain entities: DB catalogs and migration bookkeeping. */
const NON_ENTITY_TABLE_NAMES = new Set([
  "information_schema", "pg_catalog", "pg_stat_activity",
  "sqlite_master", "sqlite_sequence", "sqlite_temp_master",
  "migrations", "schema_migrations", "knex_migrations", "_prisma_migrations",
]);

/**
 * English words that follow from/into/update/join in UI copy ("Update your profile",
 * "select a file from your computer") but are never table names. Without them, a project with
 * a raw SQL client plus ordinary UI text yields pseudo-entities like "Your".
 */
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "your", "my", "our", "their", "his", "her", "its",
  "all", "any", "some", "each", "us", "you", "me", "them",
]);

/**
 * Matches `from "pg"`, `require("mysql2")`, etc. Reads raw content because IEntityExtractor only
 * receives `ScannedFile[]`, not parsed imports.
 */
function usesRawSqlClient(content: string): boolean {
  return [...RAW_SQL_IMPORTS].some((pkg) => {
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`from\\s+["']${escaped}["']|require\\(\\s*["']${escaped}["']\\s*\\)`, "i").test(content);
  });
}

// Table names are taken from the keyword that precedes them (`FROM users`); this is not a SQL parser.
//
// String boundaries come from the ts-morph AST, not from pairing quote characters with a regex:
// one apostrophe in a comment ("doesn't") flips the pairing for the rest of the file and merges
// prose and code into a fake string. StringLiteral nodes exclude comments and JSX text.
const SQL_STATEMENT_PATTERN = /\b(?:select|insert|update|delete|with)\b/i;
const TABLE_NAME_PATTERN = /\b(?:from|into|update|join)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi;

// Table identifiers are lowercase/snake_case or, rarely, SCREAMING_CASE. A Title-case word
// (`DevMap`, `Stripe`, `Your`) is a proper noun or sentence start; this covers the brand names
// in help text and UI copy that the stopword list cannot enumerate.
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
    // Unparseable file: contributes no literals.
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

/**
 * Produces name-only pseudo-entities from table names in query strings, for projects with no ORM.
 * Fields and relations stay empty because raw SQL carries no schema metadata.
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
      // `user_roles` is the model `UserRole`, not "User_role".
      const entityName = resourceEntityName(table);
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
