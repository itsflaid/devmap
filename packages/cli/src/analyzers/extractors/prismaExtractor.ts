import type { ScannedFile } from "../fileScanner.js";
import type { EntityInfo, FieldInfo, IEntityExtractor } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Tipe scalar bawaan Prisma — kalau field typenya ini, bukan relasi ke entity lain.
 * https://www.prisma.io/docs/orm/reference/prisma-schema-reference#model-field-scalar-types
 */
const PRISMA_SCALAR_TYPES = new Set([
  "String", "Boolean", "Int", "BigInt", "Float",
  "Decimal", "DateTime", "Json", "Bytes",
  // Prisma-specific (MongoDB)
  "ObjectId",
]);

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * PrismaExtractor — parse satu atau lebih .prisma files jadi list EntityInfo.
 *
 * Prisma supports multi-file schema via `prisma/` folder (Prisma 5+), jadi
 * extract() iterate semua .prisma files dan merge hasilnya.
 * Dedup dilakukan di orchestrator, bukan di sini.
 */
export class PrismaExtractor implements IEntityExtractor {
  readonly name = "prisma";

  canHandle(files: ScannedFile[]): boolean {
    return files.some((f) => f.path.endsWith(".prisma"));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const entities: EntityInfo[] = [];

    for (const file of files) {
      if (!file.path.endsWith(".prisma")) continue;
      entities.push(...parsePrismaSchema(file.content));
    }

    return entities;
  }
}

// ---------------------------------------------------------------------------
// Parser internals
// ---------------------------------------------------------------------------

/**
 * parsePrismaSchema — parse schema.prisma content jadi list EntityInfo.
 *
 * Prisma model syntax:
 *   model User {
 *     id        String     @id @default(cuid())
 *     email     String     @unique
 *     snippets  Snippet[]              ← relation one-to-many
 *     workspace Workspace?             ← relation one-to-one optional
 *     authorId  String                 ← FK scalar, bukan relasi langsung
 *   }
 */
function parsePrismaSchema(content: string): EntityInfo[] {
  const entities: EntityInfo[] = [];

  // Match tiap model block — non-greedy biar gak overlap antar model
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm;

  let match = modelPattern.exec(content);
  while (match) {
    const name = match[1];
    const body = match[2];
    const fields = parsePrismaFields(body);

    entities.push({ name, fields, relations: [], source: "prisma" });
    match = modelPattern.exec(content);
  }

  return entities;
}

/**
 * parsePrismaFields — extract field list dari body satu model block.
 *
 * Skip:
 * - Baris kosong
 * - Comment (//)
 * - Block attributes (@@index, @@unique, @@map)
 * - Inline attributes (@id, @default, dll) yang somehow lolos
 */
function parsePrismaFields(body: string): FieldInfo[] {
  const fields: FieldInfo[] = [];

  // fieldName  FieldType[]?  @attributes...
  // Capture: (1) fieldName, (2) fieldType, (3) [], (4) ?
  const fieldPattern = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?/gm;

  let match = fieldPattern.exec(body);
  while (match) {
    const fieldName = match[1];
    const fieldType = match[2];
    const isList = Boolean(match[3]);
    const isOptional = Boolean(match[4]);

    // Skip attribute lines yang lolos regex
    if (fieldName.startsWith("@")) {
      match = fieldPattern.exec(body);
      continue;
    }

    // Tipe kapital + bukan scalar Prisma = relasi ke entity lain
    const isRelation = isCapitalized(fieldType) && !PRISMA_SCALAR_TYPES.has(fieldType);

    fields.push({ name: fieldName, type: fieldType, isRelation, isList, isOptional });
    match = fieldPattern.exec(body);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCapitalized(str: string): boolean {
  return str.length > 0 && str[0] === str[0].toUpperCase() && str[0] !== str[0].toLowerCase();
}
