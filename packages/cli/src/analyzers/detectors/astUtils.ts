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

/** `() => import("./x")` or `import("./x")`: the specifier of the first dynamic import inside. */
export function importCallSpecifier(expression: ts.Node): string | undefined {
  let found: string | undefined;
  walk(expression, (node) => {
    if (
      found === undefined
      && ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      found = stringValue(node.arguments[0]);
    }
  });
  return found;
}

export type ChainCall = { name: string; args: readonly ts.Expression[]; node: ts.CallExpression };

/**
 * Unwind `root.a(x).b(y)` into the root expression and the calls in source
 * order. A call whose callee is not `something.name` ends the chain, and the
 * expression holding it is the root.
 */
export function unwindChain(expression: ts.Expression): { root: ts.Expression; calls: ChainCall[] } {
  const calls: ChainCall[] = [];
  let current = unwrapExpression(expression);

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    calls.push({ name: current.expression.name.text, args: current.arguments, node: current });
    current = unwrapExpression(current.expression.expression);
  }

  return { root: current, calls: calls.reverse() };
}

/** The outermost call of a chain: the parent is not another call on its result. */
export function isChainTop(node: ts.CallExpression): boolean {
  const parent = node.parent;
  return !(
    ts.isPropertyAccessExpression(parent)
    && parent.expression === node
    && ts.isCallExpression(parent.parent)
    && parent.parent.expression === parent
  );
}

/** A route path written as a plain string. */
export function pathArgument(node: ts.Expression | undefined): string | undefined {
  return node ? stringValue(unwrapExpression(node)) : undefined;
}
