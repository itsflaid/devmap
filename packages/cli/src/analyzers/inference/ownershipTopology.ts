import type { EntityGraph, RelationInfo } from "../analysis/index.js";

export type OwnershipPattern =
  | "single_user_isolated"
  | "shared_access"
  | "direct_messaging"
  | "unclear";

const CROSS_USER_FIELD_NAMES = [
  "participants", "members", "invitedby", "sharedwith", "sharedby",
  "recipientid", "senderid", "collaborators", "inviteeid", "inviterid",
];

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/g, "").toLowerCase();
}

export function classifyOwnershipTopology(
  entityGraph: EntityGraph,
  relations: RelationInfo[]
): {
  pattern: OwnershipPattern;
  crossUserFields: string[];
  evidence: string[];
} {
  const crossUserFields: string[] = [];
  const evidence: string[] = [];

  const userEntityName = entityGraph.entities.find(
    (e) => e.name.toLowerCase() === "user"
  )?.name ?? "User";

  for (const entity of entityGraph.entities) {
    for (const field of entity.fields) {
      const normalized = normalizeFieldName(field.name);
      if (CROSS_USER_FIELD_NAMES.includes(normalized)) {
        crossUserFields.push(`${entity.name}.${field.name}`);
        evidence.push(`field:${entity.name}.${field.name}`);
      }
    }
  }

  const multiUserRelations = relations.filter(
    (r) => r.kind === "many-to-many"
      && (r.from === userEntityName || r.to === userEntityName)
  );

  if (multiUserRelations.length > 0) {
    evidence.push(`many-to-many:${userEntityName} ↔ ${multiUserRelations.map(r => r.from === userEntityName ? r.to : r.from).join(", ")}`);
  }

  const userFksInEntity = new Map<string, string[]>();
  for (const entity of entityGraph.entities) {
    if (entity.name === userEntityName) continue;
    const userFks = entity.fields
      .filter((f) => f.type === userEntityName || f.type === "String" || f.type === "Int")
      .filter((f) => /(id|Id)$/.test(f.name))
      .filter((f) => normalizeFieldName(f.name).includes(normalizeFieldName(userEntityName)));
    if (userFks.length >= 2) {
      userFksInEntity.set(entity.name, userFks.map(f => f.name));
    }
  }

  for (const [entity, fks] of userFksInEntity) {
    evidence.push(`multi-fk:${entity} has ${fks.length} FK to User (${fks.join(", ")})`);
  }

  const directMsgEntities = [...userFksInEntity.entries()]
    .filter(([_, fks]) => {
      const lowerFks = fks.map(f => normalizeFieldName(f));
      return lowerFks.some(f => f.includes("sender") || f.includes("recipient"));
    })
    .map(([entity]) => entity);

  if (directMsgEntities.length > 0) {
    evidence.push(`direct_messaging:${directMsgEntities.join(", ")}`);
  }

  let pattern: OwnershipPattern;
  if (directMsgEntities.length > 0 && crossUserFields.length > 0) {
    pattern = "direct_messaging";
  } else if (multiUserRelations.length > 0 || crossUserFields.length > 0) {
    pattern = "shared_access";
  } else if (entityGraph.entities.length > 1 && multiUserRelations.length === 0 && crossUserFields.length === 0) {
    pattern = "single_user_isolated";
  } else {
    pattern = "unclear";
  }

  return { pattern, crossUserFields, evidence };
}
