import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import { importCallSpecifier, propertyKeyName, stringValue, unwrapExpression, walk } from "./astUtils.js";
import { createModuleIndex, type ModuleInfo } from "./moduleBindings.js";
import type { RouteInfo } from "./routeDetector.js";
import { dropShadowedLayouts, joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * Angular routes are arrays of `{ path, component }` objects:
 *
 *   export const routes: Routes = [
 *     { path: "", component: HomeComponent },
 *     { path: "users/:id", loadComponent: () => import("./user").then((m) => m.UserComponent) },
 *     { path: "admin", loadChildren: () => import("./admin/admin.routes").then((m) => m.ADMIN_ROUTES) },
 *     { path: "docs", component: DocsShell, children: [{ path: "intro", component: Intro }] },
 *     { path: "old", redirectTo: "new" },
 *     { path: "**", component: NotFound }
 *   ];
 *
 * `children` and `loadChildren` (a routes file, or an NgModule whose routing
 * module calls `RouterModule.forChild`) compose their path onto the parent's.
 * Redirects render nothing and are not listed; a shell route with an empty
 * path gives way to the index route at the same URL. The listed file is the
 * component, resolved through its import or lazy `import()`.
 */

const ROUTER_MODULE = /["']@angular\/router["']/;
const HINT_KEYS = new Set([
  "component", "loadComponent", "loadChildren", "children", "redirectTo",
  "canActivate", "canActivateChild", "canMatch", "canDeactivate", "resolve", "title", "data", "pathMatch", "outlet"
]);

type RouteArray = { module: ModuleInfo; node: ts.ArrayLiteralExpression; name?: string };

type Entry = { path: string; file: string; isIndex: boolean; isLayout: boolean };

export function detectAngularRoutes(files: ScannedFile[], graph?: Record<string, string[]>): RouteInfo[] {
  const gated = files.filter((file) =>
    /\.ts$/.test(file.path) && isArchitectureSource(file.path) && ROUTER_MODULE.test(file.content));
  if (gated.length === 0) return [];

  const index = createModuleIndex(files, graph);
  const cache = new Map<string, RouteArray[]>();

  /** Route arrays declared in a file. Lazy route files often skip the `@angular/router` import, so any file can be asked. */
  const arraysIn = (path: string): RouteArray[] => {
    const cached = cache.get(path);
    if (cached) return cached;
    const found: RouteArray[] = [];
    const module = /\.ts$/.test(path) ? index.get(path) : undefined;
    if (module) {
      walk(module.source, (node) => {
        if (ts.isArrayLiteralExpression(node) && looksLikeRoutes(node) && !isChildrenOfRoute(node)) {
          found.push({ module, node, name: declaredName(node) });
        }
      });
    }
    cache.set(path, found);
    return found;
  };

  const arrays = new Map<string, RouteArray[]>(
    gated.map((file) => [file.path, arraysIn(file.path)] as [string, RouteArray[]]).filter(([, list]) => list.length > 0)
  );

  /** Route arrays a `loadChildren` loads: the named export, else the file's arrays, else its routing module's. */
  const lazyTargets = (module: ModuleInfo, loader: ts.Expression): RouteArray[] => {
    const specifier = importCallSpecifier(loader);
    const target = specifier ? index.resolveSpecifier(module.path, specifier) : undefined;
    if (!target) return [];

    const member = memberName(loader);
    const pick = (path: string): RouteArray[] => {
      const here = arraysIn(path);
      const named = member && member !== "default" ? here.filter((entry) => entry.name === member) : [];
      return named.length > 0 ? named : here;
    };

    const direct = pick(target);
    if (direct.length > 0) return direct;
    return (graph?.[target] ?? []).flatMap(pick);
  };

  // Arrays that some route loads lazily are walked from there, with their prefix.
  const lazy = new Set<ts.ArrayLiteralExpression>();
  for (const list of arrays.values()) {
    for (const entry of list) {
      walk(entry.node, (node) => {
        if (!ts.isObjectLiteralExpression(node)) return;
        const loader = propertyValue(node, "loadChildren");
        if (loader) for (const target of lazyTargets(entry.module, loader)) lazy.add(target.node);
      });
    }
  }

  const entries: Entry[] = [];
  const stack = new Set<ts.ArrayLiteralExpression>();

  const locate = (module: ModuleInfo, component: ts.Expression | undefined, loader: ts.Expression | undefined): string => {
    const specifier = loader
      ? importCallSpecifier(loader)
      : component && ts.isIdentifier(unwrapExpression(component))
        ? module.imports.get((unwrapExpression(component) as ts.Identifier).text)?.specifier
        : undefined;
    return (specifier ? index.resolveSpecifier(module.path, specifier) : undefined) ?? module.path;
  };

  const walkArray = (module: ModuleInfo, array: ts.ArrayLiteralExpression, base: string): void => {
    if (stack.has(array)) return;
    stack.add(array);

    for (const element of array.elements) {
      const item = unwrapExpression(element);
      if (!ts.isObjectLiteralExpression(item)) continue;

      const path = index.stringOf(propertyValue(item, "path"), module);
      if (path === undefined) continue;
      const full = path === "" ? base : joinRoutePaths(base, path);

      const component = propertyValue(item, "component");
      const loadComponent = propertyValue(item, "loadComponent");
      const children = propertyValue(item, "children");
      const loadChildren = propertyValue(item, "loadChildren");
      const hasChildren = Boolean(children || loadChildren);

      if (component || loadComponent) {
        entries.push({
          path: full,
          file: locate(module, component, loadComponent),
          isIndex: path === "" && !hasChildren,
          isLayout: hasChildren
        });
      }

      if (children && ts.isArrayLiteralExpression(unwrapExpression(children))) {
        walkArray(module, unwrapExpression(children) as ts.ArrayLiteralExpression, full);
      }
      if (loadChildren) {
        for (const target of lazyTargets(module, loadChildren)) walkArray(target.module, target.node, full);
      }
    }

    stack.delete(array);
  };

  for (const list of arrays.values()) {
    for (const entry of list) {
      if (!lazy.has(entry.node)) walkArray(entry.module, entry.node, "/");
    }
  }

  const unique = new Map<string, Entry>();
  for (const entry of dropShadowedLayouts(entries)) unique.set(`${entry.path}\0${entry.file}`, entry);

  return sortRoutes([...unique.values()].map((entry) => ({ path: entry.path, file: entry.file, kind: "page" as const })));
}

function propertyValue(node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && propertyKeyName(property.name) === key) {
      return unwrapExpression(property.initializer);
    }
  }
  return undefined;
}

/** An array holding at least one `{ path: "...", <route key> }` object. */
function looksLikeRoutes(array: ts.ArrayLiteralExpression): boolean {
  return array.elements.some((element) => {
    const item = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(item) || propertyValue(item, "path") === undefined) return false;
    return item.properties.some((property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
      && HINT_KEYS.has(propertyKeyName(property.name) ?? ""));
  });
}

function isChildrenOfRoute(array: ts.ArrayLiteralExpression): boolean {
  const parent = array.parent;
  return ts.isPropertyAssignment(parent) && propertyKeyName(parent.name) === "children";
}

/** `export const ADMIN_ROUTES: Routes = [...]` */
function declaredName(array: ts.ArrayLiteralExpression): string | undefined {
  let parent: ts.Node = array.parent;
  while (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : undefined;
}

/** `() => import("./x").then((m) => m.ADMIN_ROUTES)` → `ADMIN_ROUTES`. */
function memberName(loader: ts.Expression): string | undefined {
  let found: string | undefined;
  walk(loader, (node) => {
    if (found || !ts.isArrowFunction(node) || node.parameters.length !== 1) return;
    const parameter = node.parameters[0].name;
    const body = unwrapExpression(node.body as ts.Expression);
    if (
      ts.isIdentifier(parameter)
      && ts.isPropertyAccessExpression(body)
      && ts.isIdentifier(body.expression)
      && body.expression.text === parameter.text
    ) {
      found = body.name.text;
    }
  });
  return found;
}
