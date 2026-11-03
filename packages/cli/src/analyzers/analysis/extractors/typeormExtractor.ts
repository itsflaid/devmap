import { Node, type ClassDeclaration, type PropertyDeclaration } from "ts-morph";
import type { ScannedFile } from "../index.js";
import { attachRelations, filesMentioning, unquote, withSourceFile } from "./astSupport.js";
import type { EntityInfo, FieldInfo, IEntityExtractor, RelationInfo } from "./types.js";

type RelationDecorator = "OneToMany" | "ManyToOne" | "ManyToMany" | "OneToOne";
const RELATION_DECORATORS = new Set<string>(["OneToMany", "ManyToOne", "ManyToMany", "OneToOne"]);

const COLUMN_DECORATORS = new Set([
  "Column", "PrimaryColumn", "PrimaryGeneratedColumn", "CreateDateColumn", "UpdateDateColumn",
  "DeleteDateColumn", "VersionColumn", "ObjectIdColumn", "VirtualColumn", "Generated"
]);

/**
 * TypeORMExtractor — reads `@Entity()` classes: columns from the column
 * decorators, relations from `@OneToMany` / `@ManyToOne` / `@ManyToMany` /
 * `@OneToOne` and the class they point at through `() => Target`.
 */
export class TypeORMExtractor implements IEntityExtractor {
  readonly name = "typeorm";

  canHandle(files: ScannedFile[]): boolean {
    return filesMentioning(files, /@Entity\s*\(/).length > 0;
  }

  extract(files: ScannedFile[]): EntityInfo[] {
    const entities: EntityInfo[] = [];
    const relations: RelationInfo[] = [];

    for (const file of filesMentioning(files, /@Entity\s*\(/)) {
      const parsed = withSourceFile(file, (source) =>
        source.getClasses()
          .filter((declaration) => declaration.getDecorator("Entity"))
          .map((declaration) => readEntityClass(declaration))
      );
      for (const { entity, links } of parsed) {
        entities.push(entity);
        relations.push(...links);
      }
    }

    return attachRelations(entities, relations);
  }
}

function readEntityClass(declaration: ClassDeclaration): { entity: EntityInfo; links: RelationInfo[] } {
  const name = entityName(declaration.getName() ?? "Anonymous");
  const fields: FieldInfo[] = [];
  const links: RelationInfo[] = [];

  for (const property of declaration.getProperties()) {
    const decorators = property.getDecorators().map((decorator) => decorator.getName());

    const relationName = decorators.find((decorator) => RELATION_DECORATORS.has(decorator));
    if (relationName) {
      const className = relationTarget(property, relationName);
      if (!className) continue;
      const target = entityName(className);

      const isList = relationName === "OneToMany" || relationName === "ManyToMany";
      fields.push({
        name: property.getName(),
        type: target,
        isRelation: true,
        isList,
        isOptional: property.hasQuestionToken() || isNullable(property)
      });
      links.push(relationLink(name, target, relationName as RelationDecorator));
      continue;
    }

    if (decorators.some((decorator) => COLUMN_DECORATORS.has(decorator))) {
      fields.push({
        name: property.getName(),
        type: columnType(property),
        isRelation: false,
        isList: false,
        isOptional: property.hasQuestionToken() || isNullable(property)
      });
    }
  }

  return { entity: { name, fields, relations: [], source: "typeorm" }, links };
}

/** `() => Post`, `type => Post`, `() => Post | null` → "Post"; a string target → its text. */
function relationTarget(property: PropertyDeclaration, decoratorName: string): string | undefined {
  const argument = property.getDecorator(decoratorName)?.getArguments()[0];
  if (!argument) return undefined;

  if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) {
    const body = Node.isArrowFunction(argument) ? argument.getBody().getText() : argument.getBodyText() ?? "";
    const match = body.match(/^\s*\{?\s*(?:return\s+)?\(?\s*([A-Za-z_$][\w$]*)/);
    return match?.[1];
  }
  if (Node.isStringLiteral(argument)) return unquote(argument.getText());
  return undefined;
}

function relationLink(owner: string, target: string, decorator: RelationDecorator): RelationInfo {
  switch (decorator) {
    case "OneToMany": return { from: owner, to: target, kind: "one-to-many" };
    // The side holding the foreign key is the "many": the target owns it.
    case "ManyToOne": return { from: target, to: owner, kind: "one-to-many" };
    case "ManyToMany": return { from: owner, to: target, kind: "many-to-many" };
    case "OneToOne": return { from: owner, to: target, kind: "one-to-one" };
  }
}

function isNullable(property: PropertyDeclaration): boolean {
  const typeText = property.getTypeNode()?.getText() ?? "";
  if (/\|\s*(?:null|undefined)\b/.test(typeText)) return true;

  return property.getDecorators().some((decorator) =>
    decorator.getArguments().some((argument) => /\bnullable\s*:\s*true\b/.test(argument.getText()))
  );
}

function columnType(property: PropertyDeclaration): string {
  const typeNode = property.getTypeNode()?.getText();
  if (typeNode) return typeNode.replace(/\s*\|\s*(?:null|undefined)\b/g, "").trim();

  const explicit = property.getDecorators()
    .flatMap((decorator) => decorator.getArguments())
    .map((argument) => argument.getText().match(/\btype\s*:\s*["'`]?([\w ]+)["'`]?/)?.[1])
    .find(Boolean);
  return explicit ?? "unknown";
}

/** `UserEntity` → `User`: the suffix is a naming convention, not part of the domain name. */
function entityName(className: string): string {
  return className.replace(/(?<=.)Entity$/, "");
}
