import type { ScannedFile } from "../index.js";
import { isArchitectureSource } from "../../graph/index.js";
import { attachRelations } from "./astSupport.js";
import { resourceEntityName } from "./fallbackExtractor.js";
import type { EntityInfo, FieldInfo, IEntityExtractor, RelationInfo } from "./types.js";

const BOOKKEEPING_TABLES = new Set([
  "migrations", "schema_migrations", "knex_migrations", "knex_migrations_lock",
  "_prisma_migrations", "__drizzle_migrations", "schemaversion", "sequelizemeta", "typeorm_metadata"
]);

const CREATE_TABLE = /create\s+(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(/gi;
// `unique text` or `check int` are columns; `UNIQUE (a, b)`, `KEY idx (a)` and `CHECK (a > 0)` are constraints.
const TABLE_CONSTRAINT =
  /^(?:constraint\b|primary\s+key\b|foreign\s+key\b|(?:unique|fulltext|spatial)(?:\s+(?:key|index))?\s*(?:\w+\s*)?\(|(?:key|index)\s+\w+\s*\(|check\s*\(|exclude\s+(?:using\b|\()|like\s+[\w."`]+\s*$)/i;

/**
 * SQLSchemaExtractor — reads `CREATE TABLE` statements from `.sql` files
 * (Supabase migrations, Knex/postgrator/Flyway scripts, schema dumps). Unlike
 * the query-string extractor it sees real columns and foreign keys.
 */
export class SQLSchemaExtractor implements IEntityExtractor {
  readonly name = "sql";

  canHandle(files: ScannedFile[]): boolean {
    return sqlFiles(files).some((file) => /create\s+(?:\w+\s+)?table/i.test(file.content));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const tables = new Map<string, { fields: FieldInfo[]; references: Array<{ field: string; table: string }> }>();

    for (const file of sqlFiles(files)) {
      for (const table of readCreateStatements(stripComments(file.content))) {
        if (BOOKKEEPING_TABLES.has(table.name.toLowerCase())) continue;
        if (!tables.has(table.name)) tables.set(table.name, { fields: table.fields, references: table.references });
      }
    }

    const links: RelationInfo[] = [];
    const entityNameByTable = new Map([...tables.keys()].map((table) => [table, resourceEntityName(table)]));

    const entities: EntityInfo[] = [...tables].map(([tableName, table]) => {
      const entity = entityNameByTable.get(tableName) as string;
      const fields = table.fields.map((field) => {
        const reference = table.references.find((item) => item.field === field.name);
        const target = reference ? entityNameByTable.get(reference.table) : undefined;
        if (!target || target === entity) return field;

        // The table holding the foreign key is the "many" side.
        links.push({ from: target, to: entity, kind: "one-to-many" });
        return { ...field, type: target, isRelation: true };
      });
      return { name: entity, fields, relations: [], source: "sql" as const };
    });

    return attachRelations(entities, links);
  }
}

function sqlFiles(files: ScannedFile[]): ScannedFile[] {
  return files.filter((file) => file.extension === ".sql" && isArchitectureSource(file.path));
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function readCreateStatements(sql: string): Array<{
  name: string;
  fields: FieldInfo[];
  references: Array<{ field: string; table: string }>;
}> {
  const tables: ReturnType<typeof readCreateStatements> = [];
  CREATE_TABLE.lastIndex = 0;

  let match = CREATE_TABLE.exec(sql);
  while (match) {
    const body = readBalanced(sql, match.index + match[0].length);
    const name = tableName(match[1]);
    if (body !== undefined && name) {
      const parsed = readColumns(body);
      tables.push({ name, ...parsed });
      CREATE_TABLE.lastIndex = match.index + match[0].length + body.length;
    }
    match = CREATE_TABLE.exec(sql);
  }

  return tables;
}

/** Text between the already-open parenthesis and its matching close. */
function readBalanced(sql: string, start: number): string | undefined {
  let depth = 1;
  let quote: string | undefined;

  for (let index = start; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(start, index);
    }
  }
  return undefined;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function readColumns(body: string): {
  fields: FieldInfo[];
  references: Array<{ field: string; table: string }>;
} {
  const fields: FieldInfo[] = [];
  const references: Array<{ field: string; table: string }> = [];

  for (const part of splitTopLevel(body)) {
    const foreignKey = part.match(/foreign\s+key\s*\(\s*([^)]+?)\s*\)\s*references\s+([\w."`\[\]]+)/i);
    if (foreignKey) {
      references.push({ field: identifier(foreignKey[1].split(",")[0]), table: tableName(foreignKey[2]) });
      continue;
    }
    if (TABLE_CONSTRAINT.test(part)) continue;

    const column = part.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\w]+(?:\s*\([^)]*\))?(?:\s*\[\])?)/);
    if (!column) continue;

    const name = identifier(column[1]);
    const inlineReference = part.match(/\breferences\s+([\w."`\[\]]+)/i);
    if (inlineReference) references.push({ field: name, table: tableName(inlineReference[1]) });

    const required = /\bnot\s+null\b/i.test(part) || /\bprimary\s+key\b/i.test(part);
    fields.push({ name, type: column[2].trim(), isRelation: false, isList: false, isOptional: !required });
  }

  return { fields, references };
}

function identifier(raw: string): string {
  return raw.trim().replace(/^["`\[]|["`\]]$/g, "");
}

/** `public.users` / `"public"."users"` → `users`. */
function tableName(raw: string): string {
  return identifier(raw.split(".").pop() ?? raw);
}
