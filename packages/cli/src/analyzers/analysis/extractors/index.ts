import type { ScannedFile } from "../index.js";
import type { RouteInfo } from "../../detectors/index.js";
import type { EntityGraph, EntityInfo, IEntityExtractor, RelationInfo } from "./types.js";
import { PrismaExtractor } from "./prismaExtractor.js";
import { DrizzleExtractor } from "./drizzleExtractor.js";
import { TypeORMExtractor } from "./typeormExtractor.js";
import { MongooseExtractor } from "./mongooseExtractor.js";
import { SQLSchemaExtractor } from "./sqlSchemaExtractor.js";
import { SQLExtractor } from "./sqlExtractor.js";
import { RouteFallbackExtractor } from "./fallbackExtractor.js";

// ---------------------------------------------------------------------------
// Extractor registry
// ---------------------------------------------------------------------------

/**
 * EXTRACTORS — ordered fallback chain, diiterasi dari atas ke bawah.
 *
 * Tambah source baru = append extractor baru ke sini, tanpa ubah logic apapun.
 * Orchestrator stop di extractor pertama yang canHandle() = true DAN extract() non-empty.
 *
 * Order penting: lebih reliable = lebih atas.
 *   1. Prisma    — high confidence, full field + relation data
 *   2. Drizzle   — pgTable/mysqlTable/sqliteTable, columns + references()
 *   3. TypeORM   — @Entity classes, columns + relation decorators
 *   4. Mongoose  — model()/Schema, fields + ref
 *   5. SQL DDL   — CREATE TABLE in .sql migrations (Supabase, Knex, Flyway), columns + FKs
 *   6. SQL       — raw pg/mysql2/better-sqlite3, table names as pseudo-entities
 *                  (no field/relation data — lowest confidence of the schema sources,
 *                  stays last so any schema extractor above gets first refusal)
 */
const EXTRACTORS: IEntityExtractor[] = [
  new PrismaExtractor(),
  new DrizzleExtractor(),
  new TypeORMExtractor(),
  new MongooseExtractor(),
  new SQLSchemaExtractor(),
  new SQLExtractor(),
];

const ROUTE_FALLBACK = new RouteFallbackExtractor();

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * extractEntities — scan files dan build entity graph.
 *
 * Fallback chain:
 *   1. Iterate EXTRACTORS — stop di hasil pertama yang non-empty
 *   2. Kalau semua kosong dan ada routes → route-hint fallback
 *   3. Kalau routes juga kosong → return empty graph
 *
 * Relation graph di-build dari entity fields setelah semua entities terkumpul.
 * Dedup entity dilakukan di sini (bukan di extractor) untuk handle Prisma multi-file schema.
 */
export function extractEntities(
  files: ScannedFile[],
  routes: RouteInfo[] = []
): EntityGraph {
  // --- Schema-based sources ---
  for (const extractor of EXTRACTORS) {
    if (!extractor.canHandle(files)) continue;

    const raw = extractor.extract(files);
    if (raw.length === 0) continue;

    const entities = deduplicateEntities(raw);
    // Prisma declares both sides of a relation, so the graph is derived from its
    // fields. The other sources only know the foreign-key side: their extractor
    // already worked out which side is the "many" one, so that is used as-is.
    const relations = extractor.name === "prisma"
      ? buildRelationGraph(entities)
      : entities.flatMap((entity) => entity.relations).filter(uniqueRelation());

    return {
      entities,
      relations,
      entityNames: entities.map((e) => e.name),
      source: extractor.name as EntityGraph["source"],
    };
  }

  // --- Route fallback: aktif kalau semua schema source kosong ---
  if (routes.length > 0) {
    const entities = ROUTE_FALLBACK.extract(routes);
    if (entities.length > 0) {
      return {
        entities,
        relations: [],
        entityNames: entities.map((e) => e.name),
        source: "route-hint",
      };
    }
  }

  return { entities: [], relations: [], entityNames: [], source: "empty" };
}

// ---------------------------------------------------------------------------
// Relation graph builder
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
      const hasListBack =
        target?.fields.some((f) => f.type === entity.name && f.isList) ?? false;

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
// Helpers
// ---------------------------------------------------------------------------

function uniqueRelation(): (relation: RelationInfo) => boolean {
  const seen = new Set<string>();
  return (relation) => {
    const key = `${relation.from}→${relation.to}:${relation.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

/**
 * deduplicateEntities — filter duplicate entity names.
 * Penting buat Prisma multi-file schema dimana model bisa didefinisi di file terpisah.
 * First-seen wins.
 */
function deduplicateEntities(entities: EntityInfo[]): EntityInfo[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}
