import type { ScannedFile } from "../index.js";
import { singularize } from "./fallbackExtractor.js";
import { buildRelations } from "./prismaExtractor.js";
import type { EntityInfo, FieldInfo, IEntityExtractor } from "./types.js";

const TABLE_BUILDERS = "pgTable|mysqlTable|sqliteTable|singlestoreTable|mssqlTable|cockroachTable";
const TABLE_CALL = new RegExp(`(?:export\\s+)?const\\s+(\\w+)\\s*=\\s*(?:${TABLE_BUILDERS})\\s*\\(`, "g");
const TABLE_CALL_PRESENT = new RegExp(`\\b(?:${TABLE_BUILDERS})\\s*\\(`);
const SOURCE_FILE = /\.[cm]?[jt]s$/;
const REFERENCES = /\.references\(\s*\([^)]*\)\s*(?::[^=]+?)?=>\s*(\w+)\s*\./;
const RELATIONS_CALL = /\brelations\s*\(\s*(\w+)\s*,/g;
const RELATION_LINK = /\b(one|many)\s*\(\s*(\w+)/g;

type Column = {
  name: string;
  type: string;
  optional: boolean;
  unique: boolean;
  references?: string;
};

type Table = {
  variable: string;
  sqlName?: string;
  columns: Column[];
};

type RelationDeclaration = {
  variable: string;
  links: Array<{ kind: "one" | "many"; target: string }>;
};

/**
 * Reads Drizzle ORM schemas (`pgTable`, `mysqlTable`, `sqliteTable`, ...) from TypeScript/JavaScript.
 * Relations come from `.references(() => table.id)` foreign keys and `relations()` declarations.
 */
export class DrizzleExtractor implements IEntityExtractor {
  readonly name = "drizzle";

  canHandle(files: ScannedFile[]): boolean {
    return files.some(isDrizzleSchemaFile);
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const tables: Table[] = [];
    const declarations: RelationDeclaration[] = [];

    for (const file of files) {
      if (!isDrizzleSchemaFile(file)) continue;
      const text = stripComments(file.content);
      tables.push(...parseTables(text));
      declarations.push(...parseRelationDeclarations(text));
    }

    return buildRelations(toEntities(tables, declarations));
  }
}

function isDrizzleSchemaFile(file: ScannedFile): boolean {
  return SOURCE_FILE.test(file.path)
    && file.content.includes("drizzle-orm")
    && TABLE_CALL_PRESENT.test(file.content);
}

function toEntities(tables: Table[], declarations: RelationDeclaration[]): EntityInfo[] {
  const entityByVariable = new Map(tables.map((table) => [table.variable, entityName(table)]));
  const entities = new Map<string, EntityInfo>();
  const variableOf = new Map<string, string>();

  for (const table of tables) {
    const name = entityByVariable.get(table.variable)!;
    if (entities.has(name)) continue;
    entities.set(name, { name, fields: [], relations: [], source: "drizzle" });
    variableOf.set(name, table.variable);
  }

  for (const table of tables) {
    const name = entityByVariable.get(table.variable)!;
    const entity = entities.get(name);
    if (!entity || variableOf.get(name) !== table.variable) continue;

    for (const column of table.columns) {
      entity.fields.push({
        name: column.name,
        type: column.type,
        isRelation: false,
        isList: false,
        isOptional: column.optional
      });

      const targetName = column.references ? entityByVariable.get(column.references) : undefined;
      const target = targetName ? entities.get(targetName) : undefined;
      if (!target || target === entity) continue;

      entity.fields.push({
        name: column.name.replace(/Id$/, "") || column.name,
        type: target.name,
        isRelation: true,
        isList: false,
        isOptional: column.optional
      });
      target.fields.push({
        name: table.variable,
        type: name,
        isRelation: true,
        isList: !column.unique,
        isOptional: false
      });
    }
  }

  for (const declaration of declarations) {
    const ownerName = entityByVariable.get(declaration.variable);
    const owner = ownerName ? entities.get(ownerName) : undefined;
    if (!owner) continue;

    for (const link of declaration.links) {
      const targetName = entityByVariable.get(link.target);
      if (!targetName || targetName === owner.name || !entities.has(targetName)) continue;
      const isList = link.kind === "many";
      if (owner.fields.some((field) => field.isRelation && field.type === targetName && field.isList === isList)) continue;
      owner.fields.push(relationField(link.target, targetName, isList));
    }
  }

  return [...entities.values()];
}

function relationField(name: string, type: string, isList: boolean): FieldInfo {
  return { name, type, isRelation: true, isList, isOptional: !isList };
}

/** `staff_invitation` → "StaffInvitation", `users` → "User"; the SQL name wins over the variable name (`usersTable`). */
function entityName(table: Table): string {
  const source = table.sqlName ?? table.variable;
  const words = source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean);
  if (words.length === 0) return table.variable;
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

function parseTables(text: string): Table[] {
  const tables: Table[] = [];

  for (const match of text.matchAll(TABLE_CALL)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = findClosing(text, open);
    if (close < 0) continue;

    const args = text.slice(open + 1, close);
    const objectStart = args.indexOf("{");
    if (objectStart < 0) continue;
    const objectEnd = findClosing(args, objectStart);
    if (objectEnd < 0) continue;

    const sqlName = /^\s*(['"`])([\w.-]+)\1/.exec(args)?.[2];
    tables.push({
      variable: match[1],
      ...(sqlName ? { sqlName } : {}),
      columns: parseColumns(args.slice(objectStart + 1, objectEnd))
    });
  }

  return tables;
}

function parseColumns(body: string): Column[] {
  const columns: Column[] = [];

  for (const segment of splitTopLevel(body)) {
    const match = /^\s*(\w+)\s*:\s*([\s\S]+)$/.exec(segment);
    if (!match) continue;
    const expression = match[2];
    const references = REFERENCES.exec(expression)?.[1];

    columns.push({
      name: match[1],
      type: /^\s*(\w+)\s*\(/.exec(expression)?.[1] ?? "unknown",
      optional: !/\.notNull\s*\(/.test(expression) && !/\.primaryKey\s*\(/.test(expression),
      unique: /\.unique\s*\(/.test(expression),
      ...(references ? { references } : {})
    });
  }

  return columns;
}

function parseRelationDeclarations(text: string): RelationDeclaration[] {
  const declarations: RelationDeclaration[] = [];

  for (const match of text.matchAll(RELATIONS_CALL)) {
    const open = text.indexOf("(", match.index ?? 0);
    const close = open < 0 ? -1 : findClosing(text, open);
    if (close < 0) continue;

    const links = [...text.slice(open, close).matchAll(RELATION_LINK)]
      .map((link) => ({ kind: link[1] as "one" | "many", target: link[2] }));
    declarations.push({ variable: match[1], links });
  }

  return declarations;
}

// ---------------------------------------------------------------------------
// Source scanning: just enough JS lexing to find balanced brackets and split on
// commas without being fooled by strings or comments.
// ---------------------------------------------------------------------------

function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else {
      out += char;
    }
  }

  return out;
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set(Object.values(OPENERS));

/** Index of the bracket that closes the one at `open`, or -1 when the source ends first. */
function findClosing(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char in OPENERS) depth++;
    else if (CLOSERS.has(char) && --depth === 0) return i;
  }

  return -1;
}

/** Splits an object literal body on the commas that are not nested in brackets or strings. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];

    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char in OPENERS) depth++;
    else if (CLOSERS.has(char)) depth--;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(body.slice(start));
  return parts;
}
