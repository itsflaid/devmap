import type { ScannedFile } from "../index.js";
import type { RouteInfo } from "../../detectors/index.js";

export type EntityInfo = {
  name: string;
  fields: FieldInfo[];
  relations: RelationInfo[];
  source: "prisma" | "drizzle" | "sql" | "route-hint";
  /**
   * Files the entity was found in. Set when the source has no filename convention to match on
   * (a "verses" table queried in `src/routes/quran.ts` has no `verse.ts`); takes priority over
   * name-based file matching.
   */
  sourceFiles?: string[];
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
  /** Flat list of entity names, for featureDetector and capabilityDetector. */
  entityNames: string[];
  /** Where the entities came from, so consumers can judge how reliable they are. */
  source: "prisma" | "drizzle" | "sql" | "route-hint" | "empty";
};

/** One entity source (Prisma, Drizzle, ...). The orchestrator in `index.ts` stops at the first non-empty result. */
export interface IEntityExtractor {
  /** Also becomes `EntityGraph.source`, so it must match one of that union's members. */
  readonly name: string;

  /** Cheap relevance check, called before `extract()` so inapplicable extractors are skipped. */
  canHandle(files: ScannedFile[]): boolean;

  /** Only called when `canHandle()` is true. Returns `[]` when nothing is found, so the chain moves on. */
  extract(files: ScannedFile[]): EntityInfo[];
}

/**
 * Separate from IEntityExtractor because its input is `RouteInfo[]`, not `ScannedFile[]`.
 * Only used when every IEntityExtractor returned nothing.
 */
export interface IRouteFallbackExtractor {
  readonly name: string;
  extract(routes: RouteInfo[]): EntityInfo[];
}
