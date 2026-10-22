import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { parseSource, propertyKeyName, stringValue, unwrapExpression } from "./astUtils.js";
import { resolveImportedFile } from "./routeUtils.js";

/**
 * What a route detector needs to follow a name across files: where an
 * identifier was imported from, what a file exports, and the expression a
 * variable was initialised with. Everything is read from the syntax tree.
 */

export type Import = { specifier: string; imported: string };

export type ModuleInfo = {
  path: string;
  source: ts.SourceFile;
  /** Local name → what it was imported (or `require`d) as. `imported` is `default`, `*` or a name. */
  imports: Map<string, Import>;
  /** Top-level variable name → initializer. */
  variables: Map<string, ts.Expression>;
  /** Top-level function name → function. */
  functions: Map<string, ts.FunctionLikeDeclaration>;
  /** Top-level enum name → declaration. */
  enums: Map<string, ts.EnumDeclaration>;
  /** Exported name → local name. */
  exports: Map<string, string>;
  /** `export { a } from "./x"`, `export { default as a } from "./x"`. */
  reexports: Map<string, Import>;
  /** `export default new Router()`: the expression, when it is not just a name. */
  defaultExpression?: ts.Expression;
};

export type Binding = {
  module: ModuleInfo;
  /** The local name, or `default` for an anonymous default export. */
  name: string;
  initializer?: ts.Expression;
  fn?: ts.FunctionLikeDeclaration;
  enumDeclaration?: ts.EnumDeclaration;
};

export type ModuleIndex = {
  get(path: string): ModuleInfo | undefined;
  /** Follow `name` as used in `from`: a local variable or function, or an import resolved through other files. */
  resolve(from: string, name: string): Binding | undefined;
  /** The text an expression evaluates to when it is built from literals, constants, enums and `+` / templates. */
  stringOf(expression: ts.Expression | undefined, module: ModuleInfo): string | undefined;
  resolveSpecifier(from: string, specifier: string): string | undefined;
};

export function createModuleIndex(files: ScannedFile[], graph?: Record<string, string[]>): ModuleIndex {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const localPaths = new Set(byPath.keys());
  const cache = new Map<string, ModuleInfo | undefined>();

  const get = (path: string): ModuleInfo | undefined => {
    if (cache.has(path)) return cache.get(path);
    const file = byPath.get(path);
    const module = file && /\.[cm]?[jt]sx?$/.test(path) ? readModule(path, file.content) : undefined;
    cache.set(path, module);
    return module;
  };

  const resolveSpecifier = (from: string, specifier: string) =>
    resolveImportedFile(from, specifier, localPaths, graph);

  const own = (module: ModuleInfo, name: string): Binding | undefined => {
    const initializer = module.variables.get(name);
    const fn = module.functions.get(name);
    const enumDeclaration = module.enums.get(name);
    if (!initializer && !fn && !enumDeclaration) return undefined;
    return {
      module, name,
      ...(initializer ? { initializer } : {}),
      ...(fn ? { fn } : {}),
      ...(enumDeclaration ? { enumDeclaration } : {})
    };
  };

  const exported = (path: string, name: string, depth: number): Binding | undefined => {
    const module = get(path);
    if (!module || depth > 5) return undefined;

    if (name === "default" && module.defaultExpression) {
      return { module, name: "default", initializer: module.defaultExpression };
    }
    const local = module.exports.get(name);
    if (local) return resolve(path, local, depth + 1);

    const reexport = module.reexports.get(name);
    if (reexport) {
      const target = resolveSpecifier(path, reexport.specifier);
      return target ? exported(target, reexport.imported, depth + 1) : undefined;
    }
    return undefined;
  };

  const resolve = (from: string, name: string, depth = 0): Binding | undefined => {
    const module = get(from);
    if (!module || depth > 5) return undefined;

    const direct = own(module, name);
    if (direct) return direct;

    const imported = module.imports.get(name);
    if (!imported || imported.imported === "*") return undefined;
    const target = resolveSpecifier(from, imported.specifier);
    return target ? exported(target, imported.imported, depth + 1) : undefined;
  };

  const stringOf = (expression: ts.Expression | undefined, module: ModuleInfo, depth = 0): string | undefined => {
    if (!expression || depth > 8) return undefined;
    const node = unwrapExpression(expression);

    const literal = stringValue(node);
    if (literal !== undefined) return literal;

    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const value = stringOf(span.expression, module, depth + 1);
        if (value === undefined) return undefined;
        text += value + span.literal.text;
      }
      return text;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = stringOf(node.left, module, depth + 1);
      const right = stringOf(node.right, module, depth + 1);
      return left !== undefined && right !== undefined ? left + right : undefined;
    }

    if (ts.isIdentifier(node)) {
      const binding = resolve(module.path, node.text);
      return binding?.initializer ? stringOf(binding.initializer, binding.module, depth + 1) : undefined;
    }

    // `PATHS.users` where PATHS is an object literal, an `as const` object or an enum.
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = resolve(module.path, node.expression.text);
      const member = node.name.text;
      if (binding?.enumDeclaration) {
        const entry = binding.enumDeclaration.members.find((item) => ts.isIdentifier(item.name) && item.name.text === member);
        return entry?.initializer ? stringOf(entry.initializer, binding.module, depth + 1) : undefined;
      }
      const object = binding?.initializer ? unwrapExpression(binding.initializer) : undefined;
      if (binding && object && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (ts.isPropertyAssignment(property) && propertyKeyName(property.name) === member) {
            return stringOf(property.initializer, binding.module, depth + 1);
          }
        }
      }
    }
    return undefined;
  };

  return {
    get,
    resolve: (from, name) => resolve(from, name),
    stringOf: (expression, module) => stringOf(expression, module),
    resolveSpecifier
  };
}

export function readModule(path: string, content: string): ModuleInfo {
  const source = parseSource(path, content);
  const module: ModuleInfo = {
    path,
    source,
    imports: new Map(),
    variables: new Map(),
    functions: new Map(),
    enums: new Map(),
    exports: new Map(),
    reexports: new Map()
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) readImport(statement, module);
    else if (ts.isVariableStatement(statement)) readVariables(statement, module);
    else if (ts.isFunctionDeclaration(statement) && statement.name) {
      module.functions.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        module.exports.set(
          hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name.text,
          statement.name.text
        );
      }
    } else if (ts.isEnumDeclaration(statement)) {
      module.enums.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) module.exports.set(statement.name.text, statement.name.text);
    } else if (ts.isExportDeclaration(statement)) readExportDeclaration(statement, module);
    else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const value = unwrapExpression(statement.expression);
      if (ts.isIdentifier(value)) module.exports.set("default", value.text);
      else module.defaultExpression = value;
    } else if (ts.isExportAssignment(statement)) {
      // module.exports-style `export = router`
      const value = unwrapExpression(statement.expression);
      if (ts.isIdentifier(value)) module.exports.set("default", value.text);
    }
  }

  readCommonJsExports(source, module);
  return module;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function readImport(statement: ts.ImportDeclaration, module: ModuleInfo): void {
  const specifier = stringValue(statement.moduleSpecifier);
  const clause = statement.importClause;
  if (!specifier || !clause) return;

  if (clause.name) module.imports.set(clause.name.text, { specifier, imported: "default" });
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      module.imports.set(element.name.text, { specifier, imported: (element.propertyName ?? element.name).text });
    }
  } else if (bindings && ts.isNamespaceImport(bindings)) {
    module.imports.set(bindings.name.text, { specifier, imported: "*" });
  }
}

function readVariables(statement: ts.VariableStatement, module: ModuleInfo): void {
  const exportedDeclaration = hasModifier(statement, ts.SyntaxKind.ExportKeyword);

  for (const declaration of statement.declarationList.declarations) {
    if (!declaration.initializer) continue;
    const initializer = unwrapExpression(declaration.initializer);

    if (ts.isIdentifier(declaration.name)) {
      const required = requiredSpecifier(initializer);
      if (required) {
        module.imports.set(declaration.name.text, { specifier: required.specifier, imported: required.member ?? "default" });
      } else {
        module.variables.set(declaration.name.text, initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          module.functions.set(declaration.name.text, initializer);
        }
      }
      if (exportedDeclaration) module.exports.set(declaration.name.text, declaration.name.text);
    } else if (ts.isObjectBindingPattern(declaration.name)) {
      // const { Router } = require("@koa/router")
      const required = requiredSpecifier(initializer);
      if (!required || required.member) continue;
      for (const element of declaration.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const imported = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
        module.imports.set(element.name.text, { specifier: required.specifier, imported });
      }
    }
  }
}

/** `require("x")`, `require("x").member`, `require("x").default`. */
function requiredSpecifier(expression: ts.Expression): { specifier: string; member?: string } | undefined {
  const node = unwrapExpression(expression);

  if (ts.isPropertyAccessExpression(node)) {
    const inner = requiredSpecifier(node.expression);
    if (!inner || inner.member) return undefined;
    return node.name.text === "default" ? inner : { ...inner, member: node.name.text };
  }
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "require"
    && node.arguments.length === 1
  ) {
    const specifier = stringValue(node.arguments[0]);
    return specifier ? { specifier } : undefined;
  }
  return undefined;
}

function readExportDeclaration(statement: ts.ExportDeclaration, module: ModuleInfo): void {
  const clause = statement.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return;
  const from = stringValue(statement.moduleSpecifier);

  for (const element of clause.elements) {
    const local = (element.propertyName ?? element.name).text;
    if (from) module.reexports.set(element.name.text, { specifier: from, imported: local });
    else module.exports.set(element.name.text, local);
  }
}

/** `module.exports = router`, `exports.router = router`. */
function readCommonJsExports(source: ts.SourceFile, module: ModuleInfo): void {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const target = expression.left.getText();
    const value = unwrapExpression(expression.right);

    if (target === "module.exports") {
      if (ts.isIdentifier(value)) module.exports.set("default", value.text);
      else module.defaultExpression = value;
    } else {
      const match = /^(?:module\.)?exports\.(\w+)$/.exec(target);
      if (match && ts.isIdentifier(value)) module.exports.set(match[1], value.text);
    }
  }
}

/** Visit every node under `node` except function-likes that declare `shadowed` as a parameter. */
export function walkOutsideShadow(node: ts.Node, shadowed: string | undefined, visit: (node: ts.Node) => boolean | void): void {
  const step = (current: ts.Node): void => {
    if (visit(current) === false) return;
    ts.forEachChild(current, (child) => {
      if (
        shadowed
        && ts.isFunctionLike(child)
        && child.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === shadowed)
      ) {
        return;
      }
      step(child);
    });
  };
  step(node);
}

/** True when an enclosing function declares a parameter called `name`, so `name` is not the outer binding. */
export function isShadowed(node: ts.Node, name: string): boolean {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (
      ts.isFunctionLike(parent)
      && parent.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name)
    ) {
      return true;
    }
  }
  return false;
}
