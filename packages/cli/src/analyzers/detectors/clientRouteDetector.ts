import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import { importCallSpecifier, parseSource, propertyKeyName, stringValue, unwrapExpression, walk } from "./astUtils.js";
import type { RouteInfo } from "./routeDetector.js";
import { dropShadowedLayouts, joinRoutePaths, resolveImportedFile, sortRoutes } from "./routeUtils.js";

/**
 * Routes of single-page apps, where the URL table is code instead of folders:
 *
 *   React Router / Solid Router / wouter   <Route path="teams/:id" element={<Team />}> trees,
 *                                          createBrowserRouter([{ path, element, children }])
 *   Vue Router                             createRouter({ routes: [{ path, component, children }] })
 *   TanStack Router (code-based)           createRoute({ getParentRoute, path })
 *   svelte-spa-router                      { '/about': About }
 *
 * Nested paths are composed the way the routers compose them (a child path is
 * relative unless it starts with `/`), a layout with no path adds nothing, and
 * the listed file is the component when it can be found, else the file that
 * declares the route.
 */

const ROUTER_MODULES =
  /["'](?:react-router(?:-dom)?|@remix-run\/router|@solidjs\/router|wouter(?:-preact)?|vue-router|@tanstack\/(?:react|solid)-router|svelte-spa-router)["']/;

// A route table is often its own file that only imports the page components
// and the router's route type.
const ROUTE_TYPES = /\b(?:RouteRecordRaw|RouteObject|RouteConfig|createBrowserRouter|createHashRouter)\b/;

const LAZY_WRAPPERS = new Set(["lazy", "defineAsyncComponent", "loadable", "dynamic"]);

type Component = { name?: string; specifier?: string };

type RouteEntry = {
  path: string;
  isIndex: boolean;
  isLayout: boolean;
  component: Component;
  definedIn: string;
};

export function detectClientRoutes(
  files: ScannedFile[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const localPaths = new Set(files.map((file) => file.path));
  const entries: Array<RouteEntry & { file: string }> = [];

  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path) || !isArchitectureSource(file.path)) continue;
    if (!ROUTER_MODULES.test(file.content) && !ROUTE_TYPES.test(file.content)) continue;

    const source = parseSource(file.path, file.content);
    const model = readFileModel(source);

    const found = [
      ...readJsxRoutes(source, file.path, model),
      ...readObjectRoutes(source, file.path),
      ...readTanStackRoutes(source, file.path, model),
      ...readSvelteSpaRoutes(source, file.path, file.content)
    ];

    for (const entry of found) {
      entries.push({ ...entry, file: locateComponent(entry, model, localPaths, graph) });
    }
  }

  const unique = new Map<string, (typeof entries)[number]>();
  for (const entry of dropShadowedLayouts(entries)) {
    unique.set(`${entry.path}\0${entry.file}`, entry);
  }

  return sortRoutes([...unique.values()].map((entry) => ({
    path: entry.path,
    file: entry.file,
    kind: "page" as const
  })));
}

// ------------------------------------------------------------------- model

type FileModel = {
  /** Local name → module specifier. */
  imports: Map<string, string>;
  /** Local name → lazy-loaded specifier (`const Home = lazy(() => import("./Home"))`). */
  lazy: Map<string, string>;
  variables: Map<string, ts.Expression>;
};

function readFileModel(source: ts.SourceFile): FileModel {
  const model: FileModel = { imports: new Map(), lazy: new Map(), variables: new Map() };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringValue(statement.moduleSpecifier);
      const clause = statement.importClause;
      if (!specifier || !clause) continue;
      if (clause.name) model.imports.set(clause.name.text, specifier);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) model.imports.set(element.name.text, specifier);
      }
    }
  }

  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!model.variables.has(node.name.text)) model.variables.set(node.name.text, node.initializer);
      const lazy = lazySpecifier(node.initializer);
      if (lazy) model.lazy.set(node.name.text, lazy);
    }
  });

  return model;
}

/** `lazy(() => import("./x"))`, `defineAsyncComponent(() => import("./x"))`. */
function lazySpecifier(expression: ts.Expression): string | undefined {
  const node = unwrapExpression(expression);
  if (!ts.isCallExpression(node)) return undefined;
  const callee = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
  if (!LAZY_WRAPPERS.has(callee) || !node.arguments[0]) return undefined;
  return importCallSpecifier(node.arguments[0]);
}

function locateComponent(
  entry: RouteEntry,
  model: FileModel,
  localPaths: Set<string>,
  graph?: Record<string, string[]>
): string {
  const specifier = entry.component.specifier
    ?? (entry.component.name
      ? model.lazy.get(entry.component.name) ?? model.imports.get(entry.component.name)
      : undefined);
  const resolved = specifier
    ? resolveImportedFile(entry.definedIn, specifier, localPaths, graph)
    : undefined;
  return resolved ?? entry.definedIn;
}

// -------------------------------------------------------------- path rules

function composePath(base: string, path: string | undefined, isIndex: boolean): string {
  if (isIndex || path === undefined || path === "") return base;
  if (path === "*") return joinRoutePaths(base, "*");
  return path.startsWith("/") ? joinRoutePaths(path) : joinRoutePaths(base, path);
}

// ---------------------------------------------------- React Router: JSX tree

const WRAPPER_TAG = /(?:Route|Guard|Protected|Auth|Private|Suspense|Provider|Boundary)/;
const ROUTE_TAG = /^(?:\w+\.)?\w*Route$/;

function readJsxRoutes(source: ts.SourceFile, definedIn: string, model: FileModel): RouteEntry[] {
  const entries: RouteEntry[] = [];

  const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement): string =>
    (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
  const attributesOf = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties;

  const visit = (node: ts.Node, base: string): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && ROUTE_TAG.test(tagName(node))) {
      let path: string | undefined;
      let isIndex = false;
      let component: Component = {};

      for (const attribute of attributesOf(node)) {
        if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
        const key = attribute.name.text;
        const value = attribute.initializer;

        if (key === "path") path = jsxString(value);
        else if (key === "index") isIndex = !(value && ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.FalseKeyword);
        else if (key === "element" || key === "Component" || key === "component" || key === "render") {
          component = componentFromJsxValue(value) ?? component;
        } else if (key === "lazy") {
          const specifier = value && ts.isJsxExpression(value) && value.expression
            ? importCallSpecifier(value.expression) : undefined;
          if (specifier) component = { specifier };
        }
      }

      const children: readonly ts.JsxChild[] = ts.isJsxElement(node) ? node.children : [];
      // `<Route path="/x"><Home /></Route>` (React Router 5, wouter): the child is the page.
      if (!component.name && !component.specifier) {
        const child = children.filter(isJsxNode).find((item) => !ROUTE_TAG.test(tagName(item)));
        if (child) component = { name: tagName(child) };
      }

      const full = composePath(base, path, isIndex);
      const hasRouteChildren = children.filter(isJsxNode).some((item) => ROUTE_TAG.test(tagName(item)));
      const hasOwnUrl = path !== undefined || isIndex;

      if (hasOwnUrl && (component.name || component.specifier)) {
        entries.push({ path: full, isIndex, isLayout: hasRouteChildren, component, definedIn });
      }

      ts.forEachChild(node, (child) => visit(child, full));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, base));
  };

  visit(source, "/");
  return entries.filter((entry) => entry.path !== "" && !isOnlyWildcardFallback(entry));
}

/** A lone `*` fallback is a 404 page, not a screen of the app. */
function isOnlyWildcardFallback(entry: RouteEntry): boolean {
  return entry.path === "/*" && !entry.isLayout && /^(?:NotFound|Error|NoMatch|Missing)/i.test(entry.component.name ?? "");
}

function isJsxNode(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

function jsxString(value: ts.JsxAttribute["initializer"]): string | undefined {
  if (!value) return undefined;
  if (ts.isStringLiteral(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression) return stringValue(unwrapExpression(value.expression));
  return undefined;
}

/** `element={<Home />}`, `Component={Home}`, `component={Home}`. */
function componentFromJsxValue(value: ts.JsxAttribute["initializer"]): Component | undefined {
  if (!value || !ts.isJsxExpression(value) || !value.expression) return undefined;
  return componentFromExpression(value.expression);
}

function componentFromExpression(expression: ts.Expression): Component | undefined {
  const node = unwrapExpression(expression);

  if (ts.isIdentifier(node)) return { name: node.text };
  if (ts.isJsxSelfClosingElement(node)) return { name: node.tagName.getText() };
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText();
    // <PrivateRoute><Dashboard /></PrivateRoute>, <Suspense><Home /></Suspense>: the page is inside.
    if (WRAPPER_TAG.test(tag)) {
      const inner = node.children.find(isJsxNode);
      if (inner) return componentFromExpression(inner);
    }
    return { name: tag };
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const specifier = importCallSpecifier(node);
    if (specifier) return { specifier };
    // `() => <Home />`
    let rendered: Component | undefined;
    walk(node, (child) => {
      if (!rendered && (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child))) {
        rendered = { name: (ts.isJsxElement(child) ? child.openingElement.tagName : child.tagName).getText() };
      }
    });
    return rendered;
  }
  if (ts.isCallExpression(node)) {
    // lazy(() => import("./x")) written inline, markRaw(Home), shallowRef(Home)
    const specifier = importCallSpecifier(node);
    if (specifier) return { specifier };
    const argument = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
    if (argument && ts.isIdentifier(argument)) return { name: argument.text };
  }
  return undefined;
}

// -------------------------------- React Router data routers / Vue Router

type RouteObject = {
  path?: string;
  isIndex: boolean;
  component: Component;
  children?: ts.ArrayLiteralExpression;
  /** Redirect and nothing to render. */
  redirectOnly: boolean;
};

const COMPONENT_KEYS = new Set(["element", "Component", "component", "components", "lazy", "view"]);
const ROUTE_HINT_KEYS = new Set([...COMPONENT_KEYS, "children", "loader", "redirect", "redirectTo", "name", "meta", "index"]);

function readRouteObject(node: ts.ObjectLiteralExpression): RouteObject | undefined {
  let path: string | undefined;
  let isIndex = false;
  let component: Component = {};
  let children: ts.ArrayLiteralExpression | undefined;
  let redirect = false;
  let hint = false;

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const key = propertyKeyName(property.name);
    if (!key) continue;
    if (ROUTE_HINT_KEYS.has(key)) hint = true;

    if (ts.isShorthandPropertyAssignment(property)) {
      if (COMPONENT_KEYS.has(key)) component = { name: key };
      continue;
    }

    const value = unwrapExpression(property.initializer);
    if (key === "path") path = stringValue(value);
    else if (key === "index") isIndex = value.kind === ts.SyntaxKind.TrueKeyword;
    else if (key === "children" && ts.isArrayLiteralExpression(value)) children = value;
    else if (key === "redirect" || key === "redirectTo") redirect = true;
    else if (key === "lazy") {
      const specifier = importCallSpecifier(value);
      if (specifier) component = { specifier };
    } else if (key === "components" && ts.isObjectLiteralExpression(value)) {
      // Vue named views: { default: Home, sidebar: Nav }
      const defaultView = value.properties.find((item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) && propertyKeyName(item.name) === "default");
      component = (defaultView && componentFromExpression(defaultView.initializer)) ?? component;
    } else if (COMPONENT_KEYS.has(key)) {
      component = componentFromExpression(value) ?? component;
    }
  }

  if (!hint || (path === undefined && !isIndex && !children)) return undefined;
  // Vue Router: a leaf with an empty path is its parent's index page. With
  // children it is a pathless layout, so it stays a layout.
  if (path === "" && !children) isIndex = true;

  return { path, isIndex, component, children, redirectOnly: redirect && !component.name && !component.specifier };
}

function readObjectRoutes(source: ts.SourceFile, definedIn: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const handled = new Set<ts.Node>();

  const process = (array: ts.ArrayLiteralExpression, base: string): void => {
    handled.add(array);

    for (const element of array.elements) {
      const item = unwrapExpression(element);
      if (!ts.isObjectLiteralExpression(item)) continue;
      const route = readRouteObject(item);
      if (!route) continue;

      const full = composePath(base, route.path, route.isIndex);
      const hasOwnUrl = route.path !== undefined || route.isIndex;
      const renders = route.component.name !== undefined || route.component.specifier !== undefined;

      if (hasOwnUrl && renders && !route.redirectOnly) {
        entries.push({ path: full, isIndex: route.isIndex, isLayout: Boolean(route.children?.elements.length), component: route.component, definedIn });
      }
      if (route.children) process(route.children, full);
    }
  };

  walk(source, (node) => {
    if (!ts.isArrayLiteralExpression(node) || handled.has(node)) return;
    const looksLikeRoutes = node.elements.some((element) => {
      const item = unwrapExpression(element);
      return ts.isObjectLiteralExpression(item) && readRouteObject(item) !== undefined;
    });
    // An array that is the `children` of a route object is reached through its parent.
    if (looksLikeRoutes && !isChildrenOfRoute(node)) process(node, "/");
  });

  return entries;
}

function isChildrenOfRoute(array: ts.ArrayLiteralExpression): boolean {
  const parent = array.parent;
  if (!ts.isPropertyAssignment(parent) || propertyKeyName(parent.name) !== "children") return false;
  const owner = parent.parent;
  return ts.isObjectLiteralExpression(owner)
    && owner.parent !== undefined
    && ts.isArrayLiteralExpression(owner.parent);
}

// ------------------------------------------------- TanStack code-based routes

type CodeRoute = { variable: string; path?: string; parent?: string; component: Component; isIndex: boolean };

function readTanStackRoutes(source: ts.SourceFile, definedIn: string, model: FileModel): RouteEntry[] {
  const routes = new Map<string, CodeRoute>();

  for (const [variable, initializer] of model.variables) {
    const call = unwrapExpression(initializer);
    if (!ts.isCallExpression(call)) continue;

    const callee = call.expression.getText();
    const isRoot = /\bcreateRootRoute(?:WithContext)?\b/.test(callee);
    if (!isRoot && !/(^|\.)create(?:Lazy)?Route$/.test(callee)) continue;

    const options = findOptionsObject(call);
    if (!options) {
      if (isRoot) routes.set(variable, { variable, component: {}, isIndex: false });
      continue;
    }

    let path: string | undefined;
    let parent: string | undefined;
    let component: Component = {};
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = propertyKeyName(property.name);
      const value = unwrapExpression(property.initializer);
      if (key === "path") path = stringValue(value);
      else if (key === "component") component = componentFromExpression(value) ?? component;
      else if (key === "getParentRoute") parent = parentOf(value);
    }

    routes.set(variable, { variable, path, parent: isRoot ? undefined : parent, component, isIndex: path === "/" });
  }

  const entries: RouteEntry[] = [];
  const fullPath = (route: CodeRoute, seen = new Set<string>()): string => {
    if (seen.has(route.variable)) return "/";
    seen.add(route.variable);
    const parent = route.parent ? routes.get(route.parent) : undefined;
    const base = parent ? fullPath(parent, seen) : "/";
    return route.path === undefined ? base : joinRoutePaths(base, route.path);
  };

  const parents = new Set([...routes.values()].map((route) => route.parent).filter(Boolean));

  for (const route of routes.values()) {
    // The root route and pathless layouts have no URL of their own.
    if (route.path === undefined || !route.parent) continue;
    entries.push({
      path: fullPath(route),
      isIndex: route.isIndex,
      isLayout: parents.has(route.variable),
      component: route.component,
      definedIn
    });
  }

  return entries;
}

/** The `{ ... }` of `createRoute({ ... })`, also behind `createRootRouteWithContext<T>()({ ... })`. */
function findOptionsObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const first = call.arguments[0] ? unwrapExpression(call.arguments[0]) : undefined;
  return first && ts.isObjectLiteralExpression(first) ? first : undefined;
}

/** `() => rootRoute` */
function parentOf(value: ts.Expression): string | undefined {
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    const body = ts.isBlock(value.body)
      ? value.body.statements.find(ts.isReturnStatement)?.expression
      : value.body;
    const target = body ? unwrapExpression(body) : undefined;
    if (target && ts.isIdentifier(target)) return target.text;
  }
  return undefined;
}

// ------------------------------------------------------- svelte-spa-router

function readSvelteSpaRoutes(
  source: ts.SourceFile,
  definedIn: string,
  content: string
): RouteEntry[] {
  if (!/["']svelte-spa-router["']/.test(content)) return [];
  const entries: RouteEntry[] = [];

  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const pairs = node.properties.filter((property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property)
      && (propertyKeyName(property.name) ?? "").startsWith("/")
      && ts.isIdentifier(unwrapExpression(property.initializer)));
    if (pairs.length === 0 || pairs.length !== node.properties.length) return;

    for (const pair of pairs) {
      const path = propertyKeyName(pair.name) as string;
      const name = (unwrapExpression(pair.initializer) as ts.Identifier).text;
      entries.push({ path: path === "" ? "/" : path, isIndex: false, isLayout: false, component: { name }, definedIn });
    }
  });

  return entries;
}
