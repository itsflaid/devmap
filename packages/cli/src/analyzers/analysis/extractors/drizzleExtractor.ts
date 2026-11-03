import { Node, SyntaxKind, type CallExpression, type ObjectLiteralExpression, type SourceFile } from "ts-morph";
import type { ScannedFile } from "../index.js";
import { attachRelations, filesMentioning, stringValue, unquote, unwrap, withSourceFile } from "./astSupport.js";
import { resourceEntityName } from "./fallbackExtractor.js";
import type { EntityInfo, FieldInfo, IEntityExtractor, RelationInfo } from "./types.js";

const TABLE_FACTORY = /^(?:pg|mysql|sqlite|singlestore)Table$|\.table$/;
const DRIZZLE_SIGNAL = /\b(?:pg|mysql|sqlite|singlestore)Table\b|drizzle-orm/;

type TableDeclaration = {
  variable: string;
  entity: string;
  fields: FieldInfo[];
  /** Foreign keys written as `.references(() => other.id)`, by target table variable. */
  references: Array<{ field: string; targetVariable: string }>;
};

/**
 * DrizzleExtractor — reads `pgTable` / `mysqlTable` / `sqliteTable` declarations.
 * Columns come from the column builders (`text("email").notNull()`), foreign
 * keys from `.references(() => users.id)` and `relations(users, ({ many }) => …)`.
 */
export class DrizzleExtractor implements IEntityExtractor {
  readonly name = "drizzle";

  canHandle(files: ScannedFile[]): boolean {
    return filesMentioning(files, DRIZZLE_SIGNAL).some((file) => /\b(?:pg|mysql|sqlite|singlestore)Table\s*\(|\.table\s*\(/.test(file.content));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const tables: TableDeclaration[] = [];
    const listings: Array<{ owner: string; field: string; target: string; many: boolean }> = [];

    for (const file of filesMentioning(files, DRIZZLE_SIGNAL)) {
      tables.push(...withSourceFile(file, readTables));
      listings.push(...withSourceFile(file, readRelationHelpers));
    }

    const entityByVariable = new Map(tables.map((table) => [table.variable, table.entity]));
    const links: RelationInfo[] = [];

    const entities: EntityInfo[] = tables.map((table) => {
      const fields = table.fields.map((field) => {
        const reference = table.references.find((item) => item.field === field.name);
        const target = reference ? entityByVariable.get(reference.targetVariable) : undefined;
        if (!target) return field;

        // The table holding the foreign key is the "many" side.
        links.push({ from: target, to: table.entity, kind: "one-to-many" });
        return { ...field, type: target, isRelation: true };
      });

      for (const listing of listings.filter((item) => item.owner === table.variable)) {
        const target = entityByVariable.get(listing.target);
        if (!target) continue;
        fields.push({ name: listing.field, type: target, isRelation: true, isList: listing.many, isOptional: !listing.many });
        if (listing.many) links.push({ from: table.entity, to: target, kind: "one-to-many" });
      }

      return { name: table.entity, fields, relations: [], source: "drizzle" as const };
    });

    return attachRelations(entities, links);
  }
}

function readTables(source: SourceFile): TableDeclaration[] {
  const tables: TableDeclaration[] = [];

  for (const declaration of source.getVariableDeclarations()) {
    const call = unwrap(declaration.getInitializer());
    if (!call || !Node.isCallExpression(call) || !TABLE_FACTORY.test(call.getExpression().getText())) continue;

    const [nameArgument, columnsArgument] = call.getArguments();
    const tableName = stringValue(nameArgument);
    const { columns, builder } = columnDefinition(columnsArgument);
    if (!tableName || !columns) continue;

    const fields: FieldInfo[] = [];
    const references: TableDeclaration["references"] = [];

    for (const property of columns.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;

      const fieldName = unquote(property.getName());
      const column = readColumn(property.getInitializer(), builder);
      fields.push({ name: fieldName, type: column.type, isRelation: false, isList: false, isOptional: !column.required });
      if (column.referencesVariable) references.push({ field: fieldName, targetVariable: column.referencesVariable });
    }

    tables.push({
      variable: declaration.getName(),
      entity: resourceEntityName(tableName),
      fields,
      references
    });
  }

  return tables;
}

/**
 * Columns are an object literal, or a callback receiving the column builders:
 * `pgTable("post", (t) => ({ id: t.uuid() }))`. In that form `builder` is `t`.
 */
function columnDefinition(argument: Node | undefined): { columns?: ObjectLiteralExpression; builder?: string } {
  const value = unwrap(argument);
  if (!value) return {};
  if (Node.isObjectLiteralExpression(value)) return { columns: value };
  if (!Node.isArrowFunction(value) && !Node.isFunctionExpression(value)) return {};

  const builder = value.getParameters()[0]?.getName();
  const body = unwrap(value.getBody());
  const returned = body && Node.isBlock(body)
    ? unwrap(body.getFirstDescendantByKind(SyntaxKind.ReturnStatement)?.getExpression())
    : body;

  return returned && Node.isObjectLiteralExpression(returned)
    ? { columns: returned, ...(builder ? { builder } : {}) }
    : {};
}

/** `text("email").notNull().unique()` → type `text`, required. */
function readColumn(
  initializer: Node | undefined,
  builder?: string
): { type: string; required: boolean; referencesVariable?: string } {
  let type = "unknown";
  let required = false;
  let referencesVariable: string | undefined;

  let current = unwrap(initializer);
  while (current && Node.isCallExpression(current)) {
    const callee = current.getExpression();

    if (Node.isPropertyAccessExpression(callee)) {
      const method = callee.getName();
      // `t.uuid()`: the call on the builder parameter names the column type.
      if (builder && callee.getExpression().getText() === builder) {
        type = method;
        break;
      }
      if (method === "notNull" || method === "primaryKey") required = true;
      if (method === "references") referencesVariable = referencedVariable(current);
      current = unwrap(callee.getExpression());
      continue;
    }

    if (Node.isIdentifier(callee)) type = callee.getText();
    break;
  }

  return { type, required, ...(referencesVariable ? { referencesVariable } : {}) };
}

/** `.references(() => users.id)` → "users". */
function referencedVariable(call: CallExpression): string | undefined {
  const argument = call.getArguments()[0];
  if (!argument || !Node.isArrowFunction(argument)) return undefined;
  return argument.getBody().getText().match(/^\(?\s*([A-Za-z_$][\w$]*)\s*\./)?.[1];
}

/** `relations(users, ({ many, one }) => ({ posts: many(posts) }))` */
function readRelationHelpers(source: SourceFile): Array<{ owner: string; field: string; target: string; many: boolean }> {
  const found: Array<{ owner: string; field: string; target: string; many: boolean }> = [];

  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "relations") continue;

    const [ownerArgument, builder] = call.getArguments();
    if (!ownerArgument || !builder || !Node.isArrowFunction(builder)) continue;

    const body = unwrap(builder.getBody());
    if (!body || !Node.isObjectLiteralExpression(body)) continue;

    for (const property of body.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;

      const relation = unwrap(property.getInitializer());
      if (!relation || !Node.isCallExpression(relation)) continue;

      const kind = relation.getExpression().getText();
      const target = relation.getArguments()[0]?.getText();
      if ((kind === "many" || kind === "one") && target) {
        found.push({ owner: ownerArgument.getText(), field: unquote(property.getName()), target, many: kind === "many" });
      }
    }
  }

  return found;
}
