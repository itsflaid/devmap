import type { ScannedFile } from "../index.js";
import type { EntityInfo, FieldInfo, RelationInfo, IEntityExtractor } from "./types.js";

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
    const allEntities: EntityInfo[] = [];

    for (const file of files) {
      if (!file.path.endsWith(".prisma")) continue;
      allEntities.push(...parsePrismaSchema(file.content));
    }

    // Build relations after all entities are parsed.
    // We need the full entity name set to distinguish relations from scalars
    // and to determine relation direction (one-to-many vs many-to-one).
    return buildRelations(allEntities);
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
 *     rooms     Room[]              ← relation one-to-many (User owns Rooms)
 *     workspace Workspace?          ← relation one-to-one optional
 *     userId    String              ← FK scalar, bukan relasi langsung
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

    // relations di-populate di buildRelations() setelah semua entity ter-parse
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
// Relation builder
//
// Prisma relasi selalu bidirectional — kedua sisi model punya field relasi.
// Kita derive arah relasi dari field type modifier:
//
//   User { rooms Room[] }   → User has many Room  → one-to-many (User → Room)
//   Room { user User }      → Room belongs to User → many-to-one (Room → User)
//   User { profile Profile? } → one-to-one optional
//
// Strategy: iterate tiap entity, cari field yang isRelation.
//   - Field isList (Type[])  → from: thisEntity, to: fieldType, kind: one-to-many
//   - Field !isList + optional → from: thisEntity, to: fieldType, kind: one-to-one
//   - Field !isList + required → many-to-one (FK holder) — kita skip ini karena
//     sisi lain (the "one") sudah generate one-to-many dari perspektifnya.
//
// Dedup: pakai Set string key biar relasi yang sama dari kedua sisi tidak double.
//
// Self-referential relations (Message → Message via sourceMessage/reminders):
//   Field bertipe sama dengan entity sendiri → skip, ini bukan cross-entity relation.
// ---------------------------------------------------------------------------

function buildRelations(entities: EntityInfo[]): EntityInfo[] {
  const entityNames = new Set(entities.map((e) => e.name));
  const seenRelations = new Set<string>();
  const allRelations: RelationInfo[] = [];

  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.isRelation) continue;
      if (!entityNames.has(field.type)) continue;

      // Skip self-referential — e.g. Message.sourceMessage: Message?
      // These are valid Prisma patterns but not cross-entity ownership relations
      if (field.type === entity.name) continue;

      if (field.isList) {
        // Type[] → one-to-many: this entity owns many of field.type
        // e.g. User.rooms Room[] → User → Room (one-to-many)
        const key = `${entity.name}→${field.type}:one-to-many`;
        if (!seenRelations.has(key)) {
          seenRelations.add(key);
          allRelations.push({ from: entity.name, to: field.type, kind: "one-to-many" });
        }
      } else {
        // Type or Type? (non-list) → this entity holds the FK (many-to-one side)
        // We skip many-to-one here — the one-to-many from the parent already covers it.
        // Exception: if there is NO corresponding list field on the other side,
        // this might be a one-to-one — add it as such.
        const otherEntity = entities.find((e) => e.name === field.type);
        if (!otherEntity) continue;

        const otherSideHasList = otherEntity.fields.some(
          (f) => f.isRelation && f.type === entity.name && f.isList
        );

        if (!otherSideHasList) {
          // No list on the other side → one-to-one
          // Use alphabetical order to deduplicate bidirectional one-to-one fields
          const [a, b] = [entity.name, field.type].sort();
          const key = `${a}↔${b}:one-to-one`;
          if (!seenRelations.has(key)) {
            seenRelations.add(key);
            allRelations.push({ from: entity.name, to: field.type, kind: "one-to-one" });
          }
        }
        // If other side has list → many-to-one, already handled from the list side → skip
      }
    }
  }

  // Attach relations back to each entity
  return entities.map((entity) => ({
    ...entity,
    relations: allRelations.filter(
      (r) => r.from === entity.name || r.to === entity.name
    ),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCapitalized(str: string): boolean {
  return str.length > 0 && str[0] === str[0].toUpperCase() && str[0] !== str[0].toLowerCase();
}
