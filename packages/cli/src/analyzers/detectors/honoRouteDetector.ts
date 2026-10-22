import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import { parseSource, propertyKeyName, stringValue, unwrapExpression } from "./astUtils.js";
import type { RouteInfo } from "./routeDetector.js";
import { joinRoutePaths, resolveImportedFile, sortRoutes } from "./routeUtils.js";

/**
 * Hono apps are plain values, so they are followed the way the runtime builds
 * them instead of by pattern:
 *
 *   const book = new Hono()                       one app per `new Hono()`
 *   book.get('/', h).post('/', h)                 chains hand back the same app
 *   const v1 = app.basePath('/v1')                a view of the same app with a prefix
 *   app.route('/book', book)                      book's routes join app under /book
 *   app.route('/api', api)  // import api from './api'     ...also across files
 *   app.openapi(createRoute({ method, path }), h) @hono/zod-openapi
 *
 *   const users = createRouter()                  a function that returns an app: each call is its own app
 *   registerAuth(app.basePath('/auth'))           a function that registers routes on the app it is given
 *
 * Only apps nobody mounts are walked from the top, so each endpoint is listed
 * once, under its full URL. Handlers must be registered on a value this module
 * can trace to `new Hono()`, `createFactory().createApp()` or a function that
 * returns one; anything else (an app picked from an array, built from options
 * at runtime) is not followed.
 */

const HONO_MODULE = /^(?:hono|hono\/.+|@hono\/.+)$/;
const HONO_CLASSES = new Set(["Hono", "OpenAPIHono"]);
const VERB_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "all"]);

type Mount = { prefix: string; target: HonoApp };
type RawRoute = { path: string; method?: string; file: string };

type HonoApp = {
  routes: RawRoute[];
  mounts: Mount[];
  mounted: boolean;
};

/** A reference to an app, seen through any `basePath()` calls. */
type Handle = { app: HonoApp; base: string };

type FileModel = {
  file: ScannedFile;
  source: ts.SourceFile;
  /** Local names bound to a Hono class from `hono` / `@hono/*`. */
  honoClasses: Set<string>;
  /** Local name → where it was imported from. */
  imports: Map<string, { specifier: string; imported: string }>;
  variables: Map<string, ts.Expression>;
  /** Top-level `function name() {}` declarations. */
  functions: Map<string, ts.FunctionDeclaration>;
  /** Exported name → local variable or function name. */
  exports: Map<string, string>;
  defaultExport?: ts.Expression;
  defaultFunction?: ts.FunctionDeclaration;
};

type Declaration =
  | { kind: "value"; expression: ts.Expression }
  | { kind: "function"; node: ts.FunctionDeclaration }
  | { kind: "param"; fn: ts.SignatureDeclaration; index: number };

/**
 * What a name refers to at the place it is used, innermost scope first. A
 * name that is not declared in the file comes from an import (or a global).
 */
function declarationOf(id: ts.Identifier): Declaration | undefined {
  const name = id.text;
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node)) {
      const index = node.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name);
      if (index >= 0) return { kind: "param", fn: node, index };
    }

    const statements = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) ? node.statements : undefined;
    if (!statements) continue;
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
            return { kind: "value", expression: declaration.initializer };
          }
        }
      } else if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return { kind: "function", node: statement };
      }
    }
  }
  return undefined;
}

/** The value a function hands back: `=> new Hono()` or its last top-level `return`. */
function returnedExpression(fn: ts.FunctionLikeDeclaration): ts.Expression | undefined {
  const body = fn.body;
  if (!body) return undefined;
  if (!ts.isBlock(body)) return body;
  for (let index = body.statements.length - 1; index >= 0; index -= 1) {
    const statement = body.statements[index];
    if (ts.isReturnStatement(statement) && statement.expression) return statement.expression;
  }
  return undefined;
}

export function detectHonoRoutes(
  files: ScannedFile[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const sources = files.filter((file) =>
    isArchitectureSource(file.path) && /\.[cm]?[jt]sx?$/.test(file.path)
  );
  const byPath = new Map(sources.map((file) => [file.path, file]));
  const localPaths = new Set(byPath.keys());

  const models = new Map<string, FileModel>();
  const model = (path: string): FileModel | undefined => {
    const cached = models.get(path);
    if (cached) return cached;
    const file = byPath.get(path);
    if (!file) return undefined;
    const built = buildModel(file);
    models.set(path, built);
    return built;
  };

  const apps = new Map<string, HonoApp>();
  /** Routes a function registers on one of its parameters, replayed at each call. */
  const paramRoutes = new Map<ts.Node, Array<{ index: number; route: RawRoute }>>();
  const handles = new Map<string, Handle | null>();
  const resolving = new Set<string>();

  const appAt = (file: string, node: ts.Node): HonoApp => {
    const key = `${file}@${node.getStart()}-${node.end}`;
    let app = apps.get(key);
    if (!app) {
      app = { routes: [], mounts: [], mounted: false };
      apps.set(key, app);
    }
    return app;
  };

  const resolveImport = (from: string, specifier: string): string | undefined =>
    resolveImportedFile(from, specifier, localPaths, graph);

  /** The file and export an imported name refers to. */
  const importedBinding = (path: string, name: string) => {
    const imported = model(path)?.imports.get(name);
    if (!imported) return undefined;
    const targetPath = resolveImport(path, imported.specifier);
    const target = targetPath ? model(targetPath) : undefined;
    return targetPath && target ? { targetPath, target, imported: imported.imported } : undefined;
  };

  /** Follow identifiers (and imports) until an expression that is not a name. */
  const resolveValue = (
    path: string,
    expression: ts.Expression,
    seen = new Set<string>()
  ): { path: string; expression: ts.Expression } | undefined => {
    const node = unwrapExpression(expression);
    if (!ts.isIdentifier(node)) return { path, expression: node };

    const key = `${path}#${node.getStart()}`;
    if (seen.has(key)) return undefined;
    seen.add(key);

    const declaration = declarationOf(node);
    if (declaration) {
      return declaration.kind === "value" ? resolveValue(path, declaration.expression, seen) : undefined;
    }

    const binding = importedBinding(path, node.text);
    if (!binding) return undefined;
    const { targetPath, target, imported } = binding;

    if (imported === "default") {
      return target.defaultExport ? resolveValue(targetPath, target.defaultExport, seen) : undefined;
    }
    const localName = target.exports.get(imported);
    const initializer = localName ? target.variables.get(localName) : undefined;
    return initializer ? resolveValue(targetPath, initializer, seen) : undefined;
  };

  /** Follow a name to the function it calls, through variables and imports. */
  const resolveFunction = (
    path: string,
    expression: ts.Expression,
    seen = new Set<string>()
  ): { path: string; fn: ts.FunctionLikeDeclaration } | undefined => {
    const node = unwrapExpression(expression);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { path, fn: node };
    if (!ts.isIdentifier(node)) return undefined;

    const key = `${path}#${node.getStart()}`;
    if (seen.has(key)) return undefined;
    seen.add(key);

    const declaration = declarationOf(node);
    if (declaration?.kind === "function") return { path, fn: declaration.node };
    if (declaration?.kind === "value") return resolveFunction(path, declaration.expression, seen);
    if (declaration) return undefined;

    const binding = importedBinding(path, node.text);
    if (!binding) return undefined;
    const { targetPath, target, imported } = binding;

    if (imported === "default") {
      if (target.defaultFunction) return { path: targetPath, fn: target.defaultFunction };
      return target.defaultExport ? resolveFunction(targetPath, target.defaultExport, seen) : undefined;
    }
    const localName = target.exports.get(imported);
    if (!localName) return undefined;
    const declared = target.functions.get(localName);
    if (declared) return { path: targetPath, fn: declared };
    const initializer = target.variables.get(localName);
    return initializer ? resolveFunction(targetPath, initializer, seen) : undefined;
  };

  /** `createFactory()` or a variable holding it. */
  const isFactory = (path: string, expression: ts.Expression): boolean => {
    const resolved = resolveValue(path, expression);
    const node = resolved?.expression;
    return Boolean(node && ts.isCallExpression(node) && /(^|\.)createFactory$/.test(node.expression.getText()));
  };

  /** Which app (and base path) an expression evaluates to, if any. */
  const handleOf = (path: string, expression: ts.Expression): Handle | undefined => {
    const resolved = resolveValue(path, expression);
    if (!resolved) return undefined;

    const node = resolved.expression;
    // `new Hono().basePath("/x")` starts where `new Hono()` does: key on the span.
    const key = `${resolved.path}@${node.getStart()}-${node.end}`;
    const cached = handles.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (resolving.has(key)) return undefined;
    resolving.add(key);

    let handle: Handle | undefined;
    const home = model(resolved.path);

    if (home && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && home.honoClasses.has(node.expression.text)) {
      handle = { app: appAt(resolved.path, node), base: "" };
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const receiver = ts.isPropertyAccessExpression(callee) ? handleOf(resolved.path, callee.expression) : undefined;

      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "createApp" && isFactory(resolved.path, callee.expression)) {
        handle = { app: appAt(resolved.path, node), base: "" };
      } else if (receiver && ts.isPropertyAccessExpression(callee)) {
        handle = callee.name.text === "basePath"
          ? { app: receiver.app, base: joinRoutePaths(receiver.base, stringValue(node.arguments[0]) ?? "") }
          : receiver;
      } else {
        // `createRouter()`: every call is its own app, wrapping what the function builds.
        const target = resolveFunction(resolved.path, callee);
        const returned = target ? returnedExpression(target.fn) : undefined;
        const built = target && returned ? handleOf(target.path, returned) : undefined;
        if (built) {
          const wrapper = appAt(resolved.path, node);
          wrapper.mounts.push({ prefix: "/", target: built.app });
          built.app.mounted = true;
          handle = { app: wrapper, base: built.base };
        }
      }
    }

    resolving.delete(key);
    handles.set(key, handle ?? null);
    return handle;
  };

  /** `{ method, path }` of an `@hono/zod-openapi` route definition. */
  const openApiRoute = (path: string, expression: ts.Expression): { method?: string; path: string } | undefined => {
    const resolved = resolveValue(path, expression);
    let node = resolved?.expression;
    if (node && ts.isCallExpression(node) && node.arguments[0]) {
      node = unwrapExpression(node.arguments[0]);
    }
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined;

    let method: string | undefined;
    let routePath: string | undefined;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyKeyName(property.name);
      if (name === "method") method = stringValue(property.initializer)?.toUpperCase();
      if (name === "path") routePath = stringValue(property.initializer);
    }
    return routePath === undefined ? undefined : { path: routePath, ...(method ? { method } : {}) };
  };

  /** The routes one call registers, relative to `base`; empty when it is not a route call. */
  const routesOf = (path: string, call: ts.CallExpression, method: string, base: string): RawRoute[] => {
    const args = call.arguments;

    if (method === "openapi") {
      const definition = args[0] ? openApiRoute(path, args[0]) : undefined;
      return definition
        ? [{ path: joinRoutePaths(base, openApiPath(definition.path)), ...(definition.method ? { method: definition.method } : {}), file: path }]
        : [];
    }

    if (method === "on") {
      const methods = stringList(args[0]);
      return stringList(args[1]).flatMap((routePath) =>
        (methods.length > 0 ? methods : [undefined]).map((verb) => ({
          path: joinRoutePaths(base, routePath),
          ...(verb ? { method: verb.toUpperCase() } : {}),
          file: path
        })));
    }

    // `c.get('user')` and friends take a key, not a path, but never resolve
    // to an app, so anything that gets here is a route.
    const routePath = stringValue(args[0]);
    if (routePath === undefined) return [];
    return [{
      path: joinRoutePaths(base, routePath),
      ...(method === "all" ? {} : { method: method.toUpperCase() }),
      file: path
    }];
  };

  const isRouteMethod = (method: string) =>
    VERB_METHODS.has(method) || method === "on" || method === "openapi";

  /** `app.get(...).post(...)` where `app` is a parameter of the surrounding function. */
  const parameterReceiver = (expression: ts.Expression): { fn: ts.SignatureDeclaration; index: number } | undefined => {
    let node = unwrapExpression(expression);
    while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isRouteMethod(node.expression.name.text)) {
      node = unwrapExpression(node.expression.expression);
    }
    if (!ts.isIdentifier(node)) return undefined;
    const declaration = declarationOf(node);
    return declaration?.kind === "param" ? { fn: declaration.fn, index: declaration.index } : undefined;
  };

  const candidates = sources.filter((file) => /hono/i.test(file.content));

  // Pass 1: functions that register routes on a parameter, so a call such as
  // `registerUsers(app)` can replay them wherever it happens.
  for (const file of candidates) {
    const current = model(file.path);
    if (!current) continue;

    walk(current.source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      if (!isRouteMethod(method)) return;

      const parameter = parameterReceiver(node.expression.expression);
      if (!parameter || handleOf(file.path, node.expression.expression)) return;

      const found = routesOf(file.path, node, method, "/").filter((route) => /^\/|^\*/.test(route.path.replace(/^\//, "") === "" ? "/" : route.path));
      const key = parameter.fn;
      const list = paramRoutes.get(key) ?? [];
      list.push(...found.map((route) => ({ index: parameter.index, route })));
      paramRoutes.set(key, list);
    });
  }

  // Pass 2: every call is judged on its own. `handleOf` resolves the receiver
  // without side effects, so a chain like `app.get().post()` registers each
  // call once.
  for (const file of candidates) {
    const current = model(file.path);
    if (!current) continue;

    walk(current.source, (node) => {
      if (!ts.isCallExpression(node)) return;

      // registerUsers(app, ...): replay what the function registers on its parameters.
      if (paramRoutes.size > 0 && !ts.isPropertyAccessExpression(node.expression)) {
        const target = resolveFunction(file.path, node.expression);
        const recorded = target ? paramRoutes.get(target.fn) : undefined;
        if (recorded) {
          for (const { index, route } of recorded) {
            const argument = node.arguments[index];
            const handle = argument ? handleOf(file.path, argument) : undefined;
            if (handle) {
              handle.app.routes.push({ ...route, path: joinRoutePaths(handle.base, route.path) });
            }
          }
        }
        return;
      }

      if (!ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      if (!isRouteMethod(method) && method !== "route") return;

      const receiver = handleOf(file.path, node.expression.expression);
      if (!receiver) return;

      if (method === "route") {
        const prefix = stringValue(node.arguments[0]);
        const child = node.arguments[1] ? handleOf(file.path, node.arguments[1]) : undefined;
        if (prefix === undefined || !child || child.app === receiver.app) return;
        child.app.mounted = true;
        receiver.app.mounts.push({ prefix: joinRoutePaths(receiver.base, prefix), target: child.app });
        return;
      }

      receiver.app.routes.push(...routesOf(file.path, node, method, receiver.base));
    });
  }

  const routes = new Map<string, RouteInfo>();
  const emit = (app: HonoApp, prefix: string, trail: Set<HonoApp>): void => {
    if (trail.has(app)) return;
    trail.add(app);

    for (const route of app.routes) {
      const path = honoPath(joinRoutePaths(prefix, route.path));
      const key = `${path}\0${route.file}`;
      const existing = routes.get(key);
      if (existing) {
        if (route.method && existing.methods && !existing.methods.includes(route.method)) {
          existing.methods = [...existing.methods, route.method].sort();
        }
        continue;
      }
      routes.set(key, {
        path,
        file: route.file,
        kind: "api",
        ...(route.method ? { methods: [route.method] } : {})
      });
    }
    for (const mount of app.mounts) emit(mount.target, joinRoutePaths(prefix, mount.prefix), trail);

    trail.delete(app);
  };

  for (const app of apps.values()) {
    if (!app.mounted) emit(app, "/", new Set());
  }

  return sortRoutes([...routes.values()]);
}

function buildModel(file: ScannedFile): FileModel {
  const source = parseSource(file.path, file.content);
  const model: FileModel = {
    file,
    source,
    honoClasses: new Set(),
    imports: new Map(),
    variables: new Map(),
    functions: new Map(),
    exports: new Map()
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringValue(statement.moduleSpecifier);
      const clause = statement.importClause;
      if (!specifier || !clause) continue;

      if (clause.name) model.imports.set(clause.name.text, { specifier, imported: "default" });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          model.imports.set(element.name.text, { specifier, imported });
          if (HONO_MODULE.test(specifier) && HONO_CLASSES.has(imported)) {
            model.honoClasses.add(element.name.text);
          }
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && (statement.name || hasModifier(statement, ts.SyntaxKind.DefaultKeyword))) {
      if (statement.name) model.functions.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) model.defaultFunction = statement;
      else if (statement.name && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        model.exports.set(statement.name.text, statement.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        model.variables.set(declaration.name.text, declaration.initializer);
        if (exported) model.exports.set(declaration.name.text, declaration.name.text);
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      model.defaultExport = statement.expression;
    } else if (
      ts.isExportDeclaration(statement)
      && !statement.moduleSpecifier
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (element.name.text === "default") {
          const initializer = model.variables.get(local);
          if (initializer) model.defaultExport = initializer;
        } else {
          model.exports.set(element.name.text, local);
        }
      }
    }
  }

  return model;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** `'GET'` or `['GET', 'POST']`. */
function stringList(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  const unwrapped = unwrapExpression(node);
  const single = stringValue(unwrapped);
  if (single !== undefined) return [single];
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.flatMap((element) => stringValue(element) ?? []);
  }
  return [];
}

/** OpenAPI writes `/users/{id}`; Hono routes use `/users/:id`. */
function openApiPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** `:id{[0-9]+}` is a constrained param; show it as `:id`. */
function honoPath(path: string): string {
  return path.replace(/(:[A-Za-z_]\w*)\{[^}]*\}/g, "$1");
}
