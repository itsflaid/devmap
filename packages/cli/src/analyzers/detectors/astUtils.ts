import { ts } from "ts-morph";

/** Parse one source file without building a ts-morph Project. */
export function parseSource(path: string, content: string): ts.SourceFile {
  const kind = /\.tsx$/.test(path)
    ? ts.ScriptKind.TSX
    : /\.jsx$/.test(path)
    ? ts.ScriptKind.JSX
    : /\.[cm]?js$/.test(path)
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  return ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
}

/** The text of a plain string or an interpolation-free template literal. */
export function stringValue(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return undefined;
}

/** Strip `( )`, `as T`, `satisfies T`, `x!` and `await` wrappers. */
export function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isAwaitExpression(current)
      || ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Name of a property key written as an identifier or a string. */
export function propertyKeyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}
