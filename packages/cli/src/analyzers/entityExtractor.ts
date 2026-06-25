import type { ScannedFile } from "./fileScanner.js";
import type { RouteInfo } from "./routeDetector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityInfo = {
  name: string;
  fields: FieldInfo[];
  relations: RelationInfo[];
  source: "prisma" | "route-hint";
};

export type FieldInfo = {
  name: string;
  type: string;
  isRelation: boolean;
  isList: boolean;
  isOptional: boolean;
};

export type RelationInfo = {
  from: string;
  to: string;
  kind: "one-to-one" | "one-to-many" | "many-to-many";
};

export type EntityGraph = {
  entities: EntityInfo[];
  relations: RelationInfo[];
  /** Flat list of entity names — shortcut buat featureDetector & capabilityDetector */
  entityNames: string[];
  /** Where entities came from — consumers dapat tau seberapa reliable data ini */
  source: "prisma" | "route-hint" | "empty";
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * extractEntities — scan files dan build entity graph.
 *
 * Fallback chain (ready multi-source, tambah source baru = tambah 1 if block):
 *   1. Prisma schema (.prisma)      → high confidence, full field + relation data
 *   2. [future] Drizzle schema      → parseDrizzleSchema()
 *   3. [future] TypeORM @Entity     → parseTypeORMEntities()
 *   4. [future] Mongoose Schema     → parseMongooseSchema()
 *   5. Route segments (fallback)    → low confidence, entity names only, no fields
 *
 * Route fallback hanya aktif kalau SEMUA schema-based sources gagal / tidak ditemukan.
 * Ini memastikan project tanpa ORM tetap dapat entity hints daripada kosong.
 */
export function extractEntities(
  files: ScannedFile[],
  routes: RouteInfo[] = []
): EntityGraph {
  const allEntities: EntityInfo[] = [];

  // --- Schema-based sources (ordered by reliability) ---

  for (const file of files) {
    // Source 1: Prisma
    if (file.path.endsWith(".prisma")) {
      allEntities.push(...parsePrismaSchema(file.content));
      continue;
    }

    // Source 2: Drizzle — future
    // if (isDrizzleSchemaFile(file)) {
    //   allEntities.push(...parseDrizzleSchema(file.content));
    //   continue;
    // }

    // Source 3: TypeORM — future
    // if (isTypeORMEntityFile(file, analysis)) {
    //   allEntities.push(...parseTypeORMEntities(file.content));
    //   continue;
    // }

    // Source 4: Mongoose — future
    // if (isMongooseSchemaFile(file)) {
    //   allEntities.push(...parseMongooseSchema(file.content));
    //   continue;
    // }
  }

  // Deduplicate — Prisma supports multi-file schema via `prisma/` folder
  const seen = new Set<string>();
  const entities = allEntities.filter((entity) => {
    if (seen.has(entity.name)) return false;
    seen.add(entity.name);
    return true;
  });

  // --- Route fallback: aktif kalau semua schema source kosong ---
  if (entities.length === 0 && routes.length > 0) {
    const hintEntities = extractEntityHintsFromRoutes(routes);
    return {
      entities: hintEntities,
      relations: [],
      entityNames: hintEntities.map((e) => e.name),
      source: "route-hint"
    };
  }

  if (entities.length === 0) {
    return { entities: [], relations: [], entityNames: [], source: "empty" };
  }

  const relations = buildRelationGraph(entities);

  return {
    entities,
    relations,
    entityNames: entities.map((e) => e.name),
    source: "prisma"
  };
}

// ---------------------------------------------------------------------------
// Source 1: Prisma parser
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

  let modelMatch = modelPattern.exec(content);
  while (modelMatch) {
    const name = modelMatch[1];
    const body = modelMatch[2];
    const fields = parsePrismaFields(body);

    entities.push({ name, fields, relations: [], source: "prisma" });
    modelMatch = modelPattern.exec(content);
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

  let fieldMatch = fieldPattern.exec(body);
  while (fieldMatch) {
    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2];
    const isList = Boolean(fieldMatch[3]);
    const isOptional = Boolean(fieldMatch[4]);

    // Skip attribute lines yang lolos regex
    if (fieldName.startsWith("@")) {
      fieldMatch = fieldPattern.exec(body);
      continue;
    }

    // Tipe kapital + bukan scalar Prisma = relasi ke entity lain
    const isRelation = isCapitalized(fieldType) && !PRISMA_SCALAR_TYPES.has(fieldType);

    fields.push({ name: fieldName, type: fieldType, isRelation, isList, isOptional });
    fieldMatch = fieldPattern.exec(body);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Relationship graph builder
// ---------------------------------------------------------------------------

/**
 * buildRelationGraph — derive semua relasi dari field isRelation = true.
 *
 * Rules:
 *   A.b  B[]   = one-to-many (A has many B)
 *   A.b  B     = one-to-one
 *   A.b  B[] + B.a A[] = many-to-many
 *
 * Duplicate guard: many-to-many A↔B hanya disimpan sekali.
 */
function buildRelationGraph(entities: EntityInfo[]): RelationInfo[] {
  const relations: RelationInfo[] = [];
  const entitySet = new Set(entities.map((e) => e.name));

  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.isRelation || !entitySet.has(field.type)) continue;

      const target = entities.find((e) => e.name === field.type);
      const hasListBack = target?.fields.some(
        (f) => f.type === entity.name && f.isList
      ) ?? false;

      let kind: RelationInfo["kind"];
      if (field.isList && hasListBack) {
        kind = "many-to-many";
      } else if (field.isList) {
        kind = "one-to-many";
      } else {
        kind = "one-to-one";
      }

      // Skip duplicate many-to-many (B→A sudah masuk waktu proses A→B)
      const isDuplicate = relations.some(
        (r) =>
          r.kind === "many-to-many" &&
          ((r.from === entity.name && r.to === field.type) ||
            (r.from === field.type && r.to === entity.name))
      );

      if (!isDuplicate) {
        relations.push({ from: entity.name, to: field.type, kind });
      }
    }
  }

  return relations;
}

// ---------------------------------------------------------------------------
// Fallback: route segment hints
// ---------------------------------------------------------------------------

/**
 * extractEntityHintsFromRoutes — kalau tidak ada schema, derive entity names
 * dari URL segments sebagai best-effort fallback.
 *
 * /api/snippets        → "Snippet"
 * /api/workspaces/[id] → "Workspace"
 * /api/collections     → "Collection"
 *
 * Confidence: low — hanya dapat names, zero field/relation data.
 * Tapi tetap berguna buat capabilityDetector dan domain inference.
 *
 * Filter:
 * - Skip segments pendek (≤2 char): "v1", "id" dll
 * - Skip dynamic segments: [id], [slug], [...catchall]
 * - Skip common non-entity prefixes: "api", "v1", "v2", "public", "internal"
 * - Singularize: "snippets" → "Snippet", "workspaces" → "Workspace"
 * - Capitalize first letter
 */
function extractEntityHintsFromRoutes(routes: RouteInfo[]): EntityInfo[] {
  const entityNames = new Set<string>();

  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean);

    for (const segment of segments) {
      // Skip dynamic segments
      if (segment.startsWith("[")) continue;
      // Skip short / common non-entity segments
      if (segment.length <= 2) continue;
      if (ROUTE_NON_ENTITY_SEGMENTS.has(segment.toLowerCase())) continue;

      const entityName = singularize(segment);
      entityNames.add(entityName);
    }
  }

  return [...entityNames].map((name) => ({
    name,
    fields: [],
    relations: [],
    source: "route-hint" as const
  }));
}

/**
 * singularize — simple English singularization untuk route segments.
 * Cukup buat common REST conventions, bukan full NLP.
 *
 * "snippets" → "Snippet"
 * "categories" → "Category"
 * "replies" → "Reply"
 * "workspaces" → "Workspace"
 * "media" → "Media"  (irregular, gak diubah)
 */
function singularize(word: string): string {
  const lower = word.toLowerCase();

  // Irregular: udah singular atau non-countable
  if (IRREGULAR_SINGULAR.has(lower)) {
    return capitalize(IRREGULAR_SINGULAR.get(lower) ?? lower);
  }

  // "categories" → "category", "replies" → "reply"
  if (lower.endsWith("ies")) {
    return capitalize(lower.slice(0, -3) + "y");
  }
  // "statuses" → "status", "addresses" → "address"
  if (lower.endsWith("sses") || lower.endsWith("xes") || lower.endsWith("ches") || lower.endsWith("ses")) {
    return capitalize(lower.slice(0, -2));
  }
  // "workspaces", "snippets", "collections"
  if (lower.endsWith("s") && !lower.endsWith("ss")) {
    return capitalize(lower.slice(0, -1));
  }

  return capitalize(lower);
}

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1);
}

function isCapitalized(str: string): boolean {
  return str.length > 0 && str[0] === str[0].toUpperCase() && str[0] !== str[0].toLowerCase();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRISMA_SCALAR_TYPES = new Set([
  "String", "Boolean", "Int", "BigInt", "Float",
  "Decimal", "DateTime", "Json", "Bytes",
  // Prisma-specific
  "ObjectId",
]);

const ROUTE_NON_ENTITY_SEGMENTS = new Set([
  "api", "v1", "v2", "v3",
  "public", "internal", "private",
  "auth", "oauth", "callback",
  "health", "ping", "status",
  "static", "assets", "files",
  "me", "self",
]);

const IRREGULAR_SINGULAR = new Map([
  ["media", "media"],
  ["data", "data"],
  ["people", "person"],
  ["children", "child"],
  ["teeth", "tooth"],
  ["feet", "foot"],
  ["mice", "mouse"],
  ["geese", "goose"],
]);
