import type { ScannedFile } from "../index.js";
import type { EntityInfo, FieldInfo, RelationInfo, IEntityExtractor } from "./types.js";

/**
 * Prisma built-in scalar types: a field of one of these types is never a relation.
 * https://www.prisma.io/docs/orm/reference/prisma-schema-reference#model-field-scalar-types
 */
const PRISMA_SCALAR_TYPES = new Set([
  "String", "Boolean", "Int", "BigInt", "Float",
  "Decimal", "DateTime", "Json", "Bytes",
  "ObjectId",
]);

/**
 * Parses every `.prisma` file, since Prisma 5+ allows a multi-file schema in a `prisma/` folder.
 * Duplicate models are dropped by the orchestrator in `index.ts`, not here.
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

    // Needs every model across all files: a relation target may be defined in another file.
    return buildRelations(allEntities);
  }
}

function parsePrismaSchema(content: string): EntityInfo[] {
  const entities: EntityInfo[] = [];

  // Non-greedy so one match cannot span two models; the closing brace must start a line.
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm;

  let match = modelPattern.exec(content);
  while (match) {
    const name = match[1];
    const body = match[2];
    const fields = parsePrismaFields(body);

    // Filled by buildRelations() once all entities are parsed.
    entities.push({ name, fields, relations: [], source: "prisma" });
    match = modelPattern.exec(content);
  }

  return entities;
}

function parsePrismaFields(body: string): FieldInfo[] {
  const fields: FieldInfo[] = [];

  // `name Type[]? @attrs`; lines starting with `//` or `@@` never match because `\w+` excludes them.
  const fieldPattern = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?/gm;

  let match = fieldPattern.exec(body);
  while (match) {
    const fieldName = match[1];
    const fieldType = match[2];
    const isList = Boolean(match[3]);
    const isOptional = Boolean(match[4]);

    // Defensive: `\w+` cannot match a leading `@`, so this never fires.
    if (fieldName.startsWith("@")) {
      match = fieldPattern.exec(body);
      continue;
    }

    // Capitalized non-scalar is a model or enum; buildRelations() drops enums by checking model names.
    const isRelation = isCapitalized(fieldType) && !PRISMA_SCALAR_TYPES.has(fieldType);

    fields.push({ name: fieldName, type: fieldType, isRelation, isList, isOptional });
    match = fieldPattern.exec(body);
  }

  return fields;
}

/**
 * Prisma relations are declared on both models, so direction comes from the list modifier:
 * a `Type[]` field gives one-to-many from the owner. A non-list field is the many-to-one side
 * and is skipped when the other model has the list; with no list on the other side it is
 * one-to-one. Self-references are skipped. Each relation is recorded once.
 */
export function buildRelations(entities: EntityInfo[]): EntityInfo[] {
  const entityNames = new Set(entities.map((e) => e.name));
  const seenRelations = new Set<string>();
  const allRelations: RelationInfo[] = [];

  for (const entity of entities) {
    for (const field of entity.fields) {
      if (!field.isRelation) continue;
      if (!entityNames.has(field.type)) continue;

      // Self-references (e.g. `parent Comment?`) are not cross-entity ownership.
      if (field.type === entity.name) continue;

      if (field.isList) {
        const key = `${entity.name}→${field.type}:one-to-many`;
        if (!seenRelations.has(key)) {
          seenRelations.add(key);
          allRelations.push({ from: entity.name, to: field.type, kind: "one-to-many" });
        }
      } else {
        // Non-list side holds the FK. The parent's list field already yields the one-to-many,
        // so only a field with no list counterpart is kept, as one-to-one.
        const otherEntity = entities.find((e) => e.name === field.type);
        if (!otherEntity) continue;

        const otherSideHasList = otherEntity.fields.some(
          (f) => f.isRelation && f.type === entity.name && f.isList
        );

        if (!otherSideHasList) {
          // Sorted pair, so both sides of a one-to-one produce the same key.
          const [a, b] = [entity.name, field.type].sort();
          const key = `${a}↔${b}:one-to-one`;
          if (!seenRelations.has(key)) {
            seenRelations.add(key);
            allRelations.push({ from: entity.name, to: field.type, kind: "one-to-one" });
          }
        }
      }
    }
  }

  return entities.map((entity) => ({
    ...entity,
    relations: allRelations.filter(
      (r) => r.from === entity.name || r.to === entity.name
    ),
  }));
}

function isCapitalized(str: string): boolean {
  return str.length > 0 && str[0] === str[0].toUpperCase() && str[0] !== str[0].toLowerCase();
}
