import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import { isChainTop, stringValue, unwindChain, unwrapExpression, walk } from "./astUtils.js";
import { createModuleIndex, isShadowed, type ModuleIndex, type ModuleInfo } from "./moduleBindings.js";
import type { RouteInfo } from "./routeDetector.js";
import { joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * Koa has no router of its own; the routes come from `@koa/router` /
 * `koa-router` instances (or `koa-route` helpers):
 *
 *   const users = new Router({ prefix: "/users" });
 *   users.get("/:id", show).post("/", create);
 *   api.use("/v1", users.routes());       // nested: the child's routes sit under /v1
 *   app.use(api.routes());                // the application: not a router, so `api` is a root
 *   app.use(mount("/admin", admin.routes()))   // koa-mount
 *
 * An instance that another router mounts is walked from that mount, so each
 * endpoint is listed once under its full URL.
 */

const ROUTER_MODULES = new Set(["@koa/router", "koa-router"]);
const GATE = /["'](?:@koa\/router|koa-router|koa-route)["']/;

const METHODS = new Map<string, string | undefined>([
  ["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"],
  ["delete", "DELETE"], ["del", "DELETE"], ["options", "OPTIONS"], ["head", "HEAD"],
  ["all", undefined]
]);

type Instance = { key: string; module: ModuleInfo; prefix: string };
type Registration = { module: ModuleInfo; calls: ReturnType<typeof unwindChain>["calls"] };

export function detectKoaRoutes(files: ScannedFile[], graph?: Record<string, string[]>): RouteInfo[] {
  const gated = files.filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file.path) && isArchitectureSource(file.path) && GATE.test(file.content));
  if (gated.length === 0) return [];

  const index = createModuleIndex(files, graph);
  const instances = new Map<string, Instance>();
  const registrations = new Map<string, Registration[]>();
  const mounted = new Set<string>();
  const outerBase = new Map<string, string>();
  const routes = new Map<string, RouteInfo>();

  const importedAs = (module: ModuleInfo, matches: (specifier: string, imported: string) => boolean): Set<string> =>
    new Set([...module.imports].filter(([, value]) => matches(value.specifier, value.imported)).map(([name]) => name));

  const routerNames = (module: ModuleInfo) =>
    importedAs(module, (specifier, imported) => ROUTER_MODULES.has(specifier) && (imported === "default" || imported === "Router"));

  const instanceOf = (expression: ts.Expression, module: ModuleInfo, depth = 0): Instance | undefined => {
    if (depth > 6) return undefined;
    const node = unwrapExpression(expression);

    const create = (call: ts.NewExpression | ts.CallExpression): Instance | undefined => {
      if (!isRouterFactory(call.expression, module)) return undefined;
      const key = `${module.path}:${call.pos}`;
      let instance = instances.get(key);
      if (!instance) {
        instance = { key, module, prefix: optionsPrefix(call.arguments?.[0], module, index) };
        instances.set(key, instance);
      }
      return instance;
    };

    if (ts.isNewExpression(node)) return create(node);
    if (ts.isCallExpression(node)) {
      const { root } = unwindChain(node);
      return root === node ? create(node) : instanceOf(root, module, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const binding = index.resolve(module.path, node.text);
      return binding?.initializer ? instanceOf(binding.initializer, binding.module, depth + 1) : undefined;
    }
    return undefined;
  };

  /** `Router`, or `require("@koa/router")` called in place: `require("@koa/router")()`. */
  const isRouterFactory = (callee: ts.Expression, module: ModuleInfo): boolean => {
    const node = unwrapExpression(callee);
    if (ts.isIdentifier(node)) return routerNames(module).has(node.text);
    return ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
      && ROUTER_MODULES.has(stringValue(node.arguments[0]) ?? "");
  };

  /** `child.routes()` / `child.middleware()` as an argument. */
  const mountedChild = (argument: ts.Expression, module: ModuleInfo): Instance | undefined => {
    const node = unwrapExpression(argument);
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && (node.expression.name.text === "routes" || node.expression.name.text === "middleware")
    ) {
      return instanceOf(node.expression.expression, module);
    }
    return undefined;
  };

  const routeNames = new Map<string, Set<string>>();
  for (const file of gated) {
    const module = index.get(file.path);
    if (module) {
      routeNames.set(file.path, importedAs(module, (specifier) => specifier === "koa-route"));
    }
  }

  const emit = (module: ModuleInfo, base: string, path: string, method: string | undefined): void => {
    const full = joinRoutePaths(base, path);
    routes.set(`${method ?? "*"} ${full} ${module.path}`, {
      path: full,
      file: module.path,
      kind: "api",
      ...(method ? { methods: [method] } : {})
    });
  };

  // Pass 1: chains per router, `.prefix()`, nesting and koa-mount.
  for (const file of gated) {
    const module = index.get(file.path);
    if (!module) continue;
    const mountNames = importedAs(module, (specifier) => specifier === "koa-mount");

    walk(module.source, (node) => {
      if (!ts.isCallExpression(node)) return;

      if (ts.isIdentifier(node.expression) && mountNames.has(node.expression.text) && node.arguments.length >= 2) {
        const prefix = index.stringOf(node.arguments[0], module);
        const child = mountedChild(node.arguments[1], module);
        if (prefix !== undefined && child) outerBase.set(child.key, prefix);
      }

      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "use") {
        const parent = instanceOf(node.expression.expression, module);
        if (parent) {
          for (const argument of node.arguments) {
            const child = mountedChild(argument, module);
            if (child) mounted.add(child.key);
          }
        }
      }

      if (!isChainTop(node)) return;
      const { root, calls } = unwindChain(node);
      if (calls.length === 0) return;
      if (ts.isIdentifier(root) && isShadowed(node, root.text)) return;

      // koa-route: app.use(route.get("/pets", list))
      if (ts.isIdentifier(root) && routeNames.get(file.path)?.has(root.text)) {
        const [call] = calls;
        if (METHODS.has(call.name)) {
          const path = index.stringOf(call.args[0], module);
          if (path !== undefined) emit(module, "/", path, METHODS.get(call.name));
        }
        return;
      }

      const instance = instanceOf(root, module);
      if (!instance) return;
      for (const call of calls) {
        if (call.name === "prefix") {
          const added = index.stringOf(call.args[0], module);
          if (added !== undefined) instance.prefix = joinRoutePaths(instance.prefix, added);
        }
      }
      const list = registrations.get(instance.key) ?? [];
      list.push({ module, calls });
      registrations.set(instance.key, list);
    });
  }

  const stack = new Set<string>();

  const mount = (instance: Instance, base: string): void => {
    if (stack.has(instance.key)) return;
    stack.add(instance.key);
    const here = joinRoutePaths(base, instance.prefix);
    for (const { module, calls } of registrations.get(instance.key) ?? []) {
      for (const call of calls) {
        if (METHODS.has(call.name)) {
          for (const path of pathsOf(call.args, module, index)) emit(module, here, path, METHODS.get(call.name));
        } else if (call.name === "use") {
          const path = index.stringOf(call.args[0], module);
          for (const argument of call.args) {
            const child = mountedChild(argument, module);
            if (child) mount(child, path === undefined ? here : joinRoutePaths(here, path));
          }
        }
      }
    }
    stack.delete(instance.key);
  };

  for (const instance of instances.values()) {
    if (!mounted.has(instance.key)) mount(instance, outerBase.get(instance.key) ?? "/");
  }

  return sortRoutes([...routes.values()]);
}

/** `router.get("/a", h)`, `router.get("name", "/a", h)`, `router.get(["/a", "/b"], h)`. */
function pathsOf(args: readonly ts.Expression[], module: ModuleInfo, index: ModuleIndex): string[] {
  const first = args[0] ? unwrapExpression(args[0]) : undefined;
  if (!first) return [];

  if (ts.isArrayLiteralExpression(first)) {
    return first.elements.flatMap((element) => index.stringOf(element, module) ?? []);
  }
  const path = index.stringOf(first, module);
  if (path === undefined) return [];

  const second = args[1] ? index.stringOf(args[1], module) : undefined;
  return [second !== undefined ? second : path];
}

function optionsPrefix(options: ts.Expression | undefined, module: ModuleInfo, index: ModuleIndex): string {
  if (!options || !ts.isObjectLiteralExpression(options)) return "";
  for (const property of options.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "prefix") {
      return index.stringOf(property.initializer, module) ?? "";
    }
    // `{ prefix }`
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "prefix") {
      return index.stringOf(property.name, module) ?? "";
    }
  }
  return "";
}
