import type { ScannedFile } from "../index.js";
import type { RouteInfo } from "../../detectors/index.js";
import type { EntityGraph, EntityInfo, IEntityExtractor, RelationInfo } from "./types.js";
import { PrismaExtractor } from "./prismaExtractor.js";
import { DrizzleExtractor } from "./drizzleExtractor.js";
import { SQLExtractor } from "./sqlExtractor.js";
import { RouteFallbackExtractor } from "./fallbackExtractor.js";

/**
 * Fallback chain, tried top to bottom; the first extractor with `canHandle()` true and a
 * non-empty `extract()` wins. Order is by reliability, most reliable first:
 * Prisma (fields and relations), Drizzle (fields and foreign keys), then SQL (table names only),
 * which stays last so any ORM extractor gets first refusal. New sources slot in above SQL.
 */
const EXTRACTORS: IEntityExtractor[] = [
  new PrismaExtractor(),
  new DrizzleExtractor(),
  // new TypeORMExtractor(),
  // new MongooseExtractor(),
  new SQLExtractor(),
];

const ROUTE_FALLBACK = new RouteFallbackExtractor();

/**
 * Runs the EXTRACTORS chain, then falls back to route-derived entity names, then to an empty graph.
 * Entities are deduplicated here rather than in the extractors because a Prisma multi-file
 * schema can define a model twice.
 */
export function extractEntities(
  files: ScannedFile[],
  routes: RouteInfo[] = []
): EntityGraph {
  for (const extractor of EXTRACTORS) {
    if (!extractor.canHandle(files)) continue;

    const raw = extractor.extract(files);
    if (raw.length === 0) continue;

    const entities = deduplicateEntities(raw);
    const relations = buildRelationGraph(entities);

    return {
      entities,
      relations,
      entityNames: entities.map((e) => e.name),
      source: extractor.name as EntityGraph["source"],
    };
  }

  // Only reached when every schema source came back empty.
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

/**
 * Derives relations from relation fields: `B[]` is one-to-many, `B` is one-to-one, and `B[]`
 * on both sides is many-to-many (stored once per pair).
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

      // The B→A side of a many-to-many was already added while processing A→B.
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

/** First definition of a name wins. */
function deduplicateEntities(entities: EntityInfo[]): EntityInfo[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}
