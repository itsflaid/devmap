import { Node, SyntaxKind, type ObjectLiteralExpression, type SourceFile } from "ts-morph";
import type { ScannedFile } from "../index.js";
import { attachRelations, filesMentioning, stringValue, unquote, unwrap, withSourceFile } from "./astSupport.js";
import type { EntityInfo, FieldInfo, IEntityExtractor, RelationInfo } from "./types.js";

const MONGOOSE_SIGNAL = /\bmongoose\b|\bSchema\s*\(/;

/**
 * MongooseExtractor — reads `mongoose.model("Name", schema)` and the
 * `new Schema({ ... })` it is built from. A field's `ref: "Other"` is the
 * relation; a schema used as a sub-document is not an entity of its own.
 */
export class MongooseExtractor implements IEntityExtractor {
  readonly name = "mongoose";

  canHandle(files: ScannedFile[]): boolean {
    return filesMentioning(files, MONGOOSE_SIGNAL).some((file) => /\bmodel\s*[<(]/.test(file.content));
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const entities: EntityInfo[] = [];
    const relations: RelationInfo[] = [];

    for (const file of filesMentioning(files, MONGOOSE_SIGNAL)) {
      const parsed = withSourceFile(file, readModels);
      for (const { entity, links } of parsed) {
        entities.push(entity);
        relations.push(...links);
      }
    }

    return attachRelations(entities, relations);
  }
}

function readModels(source: SourceFile): Array<{ entity: EntityInfo; links: RelationInfo[] }> {
  const schemas = new Map<string, ObjectLiteralExpression>();
  for (const declaration of source.getVariableDeclarations()) {
    const definition = schemaDefinition(declaration.getInitializer());
    if (definition) schemas.set(declaration.getName(), definition);
  }

  const models: Array<{ entity: EntityInfo; links: RelationInfo[] }> = [];
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== "model" && !callee.endsWith(".model")) continue;

    const [nameArgument, schemaArgument] = call.getArguments();
    const name = stringValue(nameArgument);
    if (!name) continue;

    const definition = Node.isIdentifier(schemaArgument)
      ? schemas.get(schemaArgument.getText())
      : schemaDefinition(schemaArgument);
    if (!definition) continue;

    models.push(readModel(name, definition));
  }

  return models;
}

/** The object literal of `new Schema({...})`, `new mongoose.Schema({...})` or `Schema({...})`. */
function schemaDefinition(node: Node | undefined): ObjectLiteralExpression | undefined {
  const expression = unwrap(node);
  if (!expression || !(Node.isNewExpression(expression) || Node.isCallExpression(expression))) return undefined;
  if (!/(?:^|\.)Schema$/.test(expression.getExpression().getText())) return undefined;

  const definition = unwrap(expression.getArguments()[0]);
  return definition && Node.isObjectLiteralExpression(definition) ? definition : undefined;
}

function readModel(name: string, definition: ObjectLiteralExpression): { entity: EntityInfo; links: RelationInfo[] } {
  const fields: FieldInfo[] = [];
  const links: RelationInfo[] = [];

  for (const property of definition.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const field = readField(unquote(property.getName()), property.getInitializer());
    fields.push(field.info);

    for (const reference of field.references) {
      // The document holding a direct reference is the "many" side of the link;
      // an array of references, or references inside an embedded list, are owned by it.
      links.push(field.info.isRelation && !field.info.isList
        ? { from: reference, to: name, kind: "one-to-many" }
        : { from: name, to: reference, kind: "one-to-many" });
    }
  }

  return { entity: { name, fields, relations: [], source: "mongoose" }, links };
}

function readField(name: string, initializer: Node | undefined): { info: FieldInfo; references: string[] } {
  const value = unwrap(initializer);
  const info: FieldInfo = { name, type: "Mixed", isRelation: false, isList: false, isOptional: true };
  if (!value) return { info, references: [] };

  if (Node.isArrayLiteralExpression(value)) {
    const inner = readField(name, value.getElements()[0]);
    return { info: { ...inner.info, isList: true, isOptional: true }, references: inner.references };
  }

  if (Node.isObjectLiteralExpression(value)) {
    const options = new Map<string, Node | undefined>();
    for (const property of value.getProperties()) {
      if (Node.isPropertyAssignment(property)) options.set(unquote(property.getName()), property.getInitializer());
    }

    const reference = stringValue(options.get("ref"));
    const typeNode = options.get("type");

    // No `type` and no `ref`: an inline sub-document such as `{ name: String, product: { ref: "Product" } }`.
    if (!reference && !typeNode) {
      const nested = [...options].flatMap(([key, child]) => readField(key, child).references);
      return { info: { ...info, type: "Subdocument" }, references: nested };
    }

    const inner = typeNode ? readField(name, typeNode) : undefined;
    const target = reference ?? inner?.references[0];
    const required = options.get("required")?.getText() === "true"
      || /^\[\s*true\b/.test(options.get("required")?.getText() ?? "");

    return {
      info: {
        name,
        type: target ?? inner?.info.type ?? "Mixed",
        isRelation: Boolean(target),
        isList: inner?.info.isList ?? false,
        isOptional: !required
      },
      references: target ? [target] : []
    };
  }

  return { info: { ...info, type: value.getText().replace(/^(?:mongoose\.)?(?:Schema\.Types\.)?/, "") }, references: [] };
}
