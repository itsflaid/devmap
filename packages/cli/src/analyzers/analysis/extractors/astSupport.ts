import { Node, Project, ScriptTarget, type SourceFile } from "ts-morph";
import type { ScannedFile } from "../index.js";
import { isArchitectureSource } from "../../graph/index.js";
import type { EntityInfo, RelationInfo } from "./types.js";

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

const project = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, target: ScriptTarget.ES2022 }
});

/** Production script files that mention one of the needles. Cheap pre-filter before parsing. */
export function filesMentioning(files: ScannedFile[], needles: RegExp): ScannedFile[] {
  return files.filter((file) =>
    SCRIPT_EXTENSIONS.has(file.extension)
    && !file.path.endsWith(".d.ts")
    && isArchitectureSource(file.path)
    && needles.test(file.content)
  );
}

/**
 * Parses a file into a throwaway in-memory source file. A file ts-morph cannot
 * parse contributes nothing, like a file with no matching declarations.
 */
export function withSourceFile<T>(file: ScannedFile, read: (source: SourceFile) => T[]): T[] {
  let source: SourceFile | undefined;
  try {
    source = project.createSourceFile("__entity-scan.tsx", file.content, { overwrite: true });
    return read(source);
  } catch {
    return [];
  } finally {
    if (source) project.removeSourceFile(source);
  }
}

/** `'name'`, `"name"` and `` `name` `` property keys, without the quotes. */
export function unquote(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, "");
}

export function stringValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

/** Looks through `( ... )`, `as X` and `satisfies X` wrappers. */
export function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current
    && (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isSatisfiesExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * Keeps one relation per (from, to, kind), hands each entity the relations it
 * takes part in, and counts many-to-many only once per pair.
 */
export function attachRelations(entities: EntityInfo[], relations: RelationInfo[]): EntityInfo[] {
  const names = new Set(entities.map((entity) => entity.name));
  const seen = new Set<string>();
  const unique: RelationInfo[] = [];

  for (const relation of relations) {
    if (relation.from === relation.to) continue;
    if (!names.has(relation.from) || !names.has(relation.to)) continue;

    const key = relation.kind === "many-to-many"
      ? `${[relation.from, relation.to].sort().join("↔")}:${relation.kind}`
      : `${relation.from}→${relation.to}:${relation.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(relation);
  }

  return entities.map((entity) => ({
    ...entity,
    relations: unique.filter((relation) => relation.from === entity.name || relation.to === entity.name)
  }));
}
