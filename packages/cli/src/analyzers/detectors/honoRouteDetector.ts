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
 * Only apps nobody mounts are walked from the top, so each endpoint is listed
 * once, under its full URL. Handlers must be registered on a value this module
 * can trace to `new Hono()`: apps built by a factory function are not followed.
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
  /** Exported name → local variable name. */
  exports: Map<string, string>;
  defaultExport?: ts.Expression;
};

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

  /** Follow identifiers (and imports) until an expression that is not a name. */
  const resolveValue = (
    path: string,
    expression: ts.Expression,
    seen = new Set<string>()
  ): { path: string; expression: ts.Expression } | undefined => {
    const node = unwrapExpression(expression);
    if (!ts.isIdentifier(node)) return { path, expression: node };

    const key = `${path}#${node.text}`;
    if (seen.has(key)) return undefined;
    seen.add(key);

    const current = model(path);
    if (!current) return undefined;

    const local = current.variables.get(node.text);
    if (local) return resolveValue(path, local, seen);

    const imported = current.imports.get(node.text);
    if (!imported) return undefined;
    const targetPath = resolveImport(path, imported.specifier);
    const target = targetPath ? model(targetPath) : undefined;
    if (!targetPath || !target) return undefined;

    if (imported.imported === "default") {
      return target.defaultExport ? resolveValue(targetPath, target.defaultExport, seen) : undefined;
    }
    const localName = target.exports.get(imported.imported);
    const initializer = localName ? target.variables.get(localName) : undefined;
    return initializer ? resolveValue(targetPath, initializer, seen) : undefined;
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
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === "createApp" && /\bcreateFactory\b/.test(node.expression.expression.getText())) {
        handle = { app: appAt(resolved.path, node), base: "" };
      } else {
        const receiver = handleOf(resolved.path, node.expression.expression);
        if (receiver) {
          handle = method === "basePath"
            ? { app: receiver.app, base: joinRoutePaths(receiver.base, stringValue(node.arguments[0]) ?? "") }
            : receiver;
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

  const candidates = sources.filter((file) => /hono/i.test(file.content));

  // Every call is judged on its own: `handleOf` resolves the receiver without
  // side effects, so a chain like `app.get().post()` registers each call once.
  for (const file of candidates) {
    const current = model(file.path);
    if (!current) continue;

    walk(current.source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      const isVerb = VERB_METHODS.has(method);
      if (!isVerb && method !== "on" && method !== "route" && method !== "openapi") return;

      const receiver = handleOf(file.path, node.expression.expression);
      if (!receiver) return;
      const args = node.arguments;

      if (method === "route") {
        const prefix = stringValue(args[0]);
        const child = args[1] ? handleOf(file.path, args[1]) : undefined;
        if (prefix === undefined || !child || child.app === receiver.app) return;
        child.app.mounted = true;
        receiver.app.mounts.push({ prefix: joinRoutePaths(receiver.base, prefix), target: child.app });
        return;
      }

      if (method === "openapi") {
        const definition = args[0] ? openApiRoute(file.path, args[0]) : undefined;
        if (!definition) return;
        receiver.app.routes.push({
          path: joinRoutePaths(receiver.base, openApiPath(definition.path)),
          ...(definition.method ? { method: definition.method } : {}),
          file: file.path
        });
        return;
      }

      if (method === "on") {
        const methods = stringList(args[0]);
        const paths = stringList(args[1]);
        for (const path of paths) {
          for (const verb of methods.length > 0 ? methods : [undefined]) {
            receiver.app.routes.push({
              path: joinRoutePaths(receiver.base, path),
              ...(verb ? { method: verb.toUpperCase() } : {}),
              file: file.path
            });
          }
        }
        return;
      }

      // `c.get('user')` and friends take a key, not a path, but never resolve
      // to an app, so anything that gets here is a route.
      const path = stringValue(args[0]);
      if (path === undefined) return;
      receiver.app.routes.push({
        path: joinRoutePaths(receiver.base, path),
        ...(method === "all" ? {} : { method: method.toUpperCase() }),
        file: file.path
      });
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
