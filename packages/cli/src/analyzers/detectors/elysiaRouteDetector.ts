import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import { isChainTop, unwindChain, unwrapExpression, walk } from "./astUtils.js";
import { createModuleIndex, isShadowed, walkOutsideShadow, type ModuleIndex, type ModuleInfo } from "./moduleBindings.js";
import type { RouteInfo } from "./routeDetector.js";
import { joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * Elysia apps are chains of calls on an instance:
 *
 *   new Elysia({ prefix: "/users" }).get("/:id", h).post("/", h)
 *   app.group("/v1", (app) => app.get("/ping", h))
 *   app.guard({ beforeHandle }, (app) => app.get("/me", h))
 *   app.use(users)                        // a plugin instance, mounted at its own prefix
 *
 * Each `new Elysia()` is one instance. Calls on it are collected wherever they
 * are written (the initializer chain, later `users.get(...)` statements, other
 * files that import it), and an instance that something mounts with `.use()`
 * is walked from that mount, so every endpoint is listed once under its full URL.
 */

const ELYSIA_MODULE = /["']elysia["']/;

const METHODS = new Map<string, string | undefined>([
  ["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"],
  ["delete", "DELETE"], ["options", "OPTIONS"], ["head", "HEAD"],
  ["all", undefined], ["ws", "WS"]
]);

type Instance = { key: string; module: ModuleInfo; prefix: string };
type Registration = { module: ModuleInfo; calls: ReturnType<typeof unwindChain>["calls"] };

export function detectElysiaRoutes(files: ScannedFile[], graph?: Record<string, string[]>): RouteInfo[] {
  const gated = files.filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file.path) && isArchitectureSource(file.path) && ELYSIA_MODULE.test(file.content));
  if (gated.length === 0) return [];

  const index = createModuleIndex(files, graph);
  const instances = new Map<string, Instance>();
  const registrations = new Map<string, Registration[]>();
  const mounted = new Set<string>();
  const routes = new Map<string, RouteInfo>();

  const classNames = (module: ModuleInfo): Set<string> => new Set(
    [...module.imports].filter(([, value]) => value.specifier === "elysia" && value.imported === "Elysia").map(([name]) => name)
  );

  const instanceOf = (expression: ts.Expression, module: ModuleInfo, depth = 0): Instance | undefined => {
    if (depth > 6) return undefined;
    const node = unwrapExpression(expression);

    if (ts.isNewExpression(node)) {
      if (!ts.isIdentifier(node.expression) || !classNames(module).has(node.expression.text)) return undefined;
      const key = `${module.path}:${node.pos}`;
      let instance = instances.get(key);
      if (!instance) {
        instance = { key, module, prefix: prefixOf(node, module, index) };
        instances.set(key, instance);
      }
      return instance;
    }

    if (ts.isCallExpression(node)) {
      const { root } = unwindChain(node);
      return root === node ? undefined : instanceOf(root, module, depth + 1);
    }

    if (ts.isIdentifier(node)) {
      const binding = index.resolve(module.path, node.text);
      return binding?.initializer ? instanceOf(binding.initializer, binding.module, depth + 1) : undefined;
    }
    return undefined;
  };

  // Pass 1: every chain rooted at an instance, wherever it is written.
  for (const file of gated) {
    const module = index.get(file.path);
    if (!module) continue;

    walk(module.source, (node) => {
      if (!ts.isCallExpression(node)) return;

      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "use" && node.arguments[0]) {
        const plugin = instanceOf(node.arguments[0], module);
        if (plugin) mounted.add(plugin.key);
      }

      if (!isChainTop(node)) return;
      const { root, calls } = unwindChain(node);
      if (calls.length === 0) return;
      if (ts.isIdentifier(root) && isShadowed(node, root.text)) return;

      const instance = instanceOf(root, module);
      if (!instance) return;
      const list = registrations.get(instance.key) ?? [];
      list.push({ module, calls });
      registrations.set(instance.key, list);
    });
  }

  const emit = (module: ModuleInfo, base: string, path: string, method: string | undefined): void => {
    const full = joinRoutePaths(base, path);
    const route: RouteInfo = { path: full, file: module.path, kind: "api", ...(method ? { methods: [method] } : {}) };
    routes.set(`${method ?? "*"} ${full} ${module.path}`, route);
  };

  const stack = new Set<string>();

  const mount = (instance: Instance, base: string): void => {
    if (stack.has(instance.key)) return;
    stack.add(instance.key);
    const here = joinRoutePaths(base, instance.prefix);
    for (const registration of registrations.get(instance.key) ?? []) {
      processCalls(registration.calls, registration.module, here);
    }
    stack.delete(instance.key);
  };

  const processFunction = (fn: ts.FunctionLikeDeclaration, module: ModuleInfo, base: string): void => {
    const first = fn.parameters[0];
    if (!first || !ts.isIdentifier(first.name) || !fn.body) return;
    const param = first.name.text;

    walkOutsideShadow(fn.body, param, (node) => {
      if (!ts.isCallExpression(node) || !isChainTop(node)) return;
      const { root, calls } = unwindChain(node);
      if (calls.length > 0 && ts.isIdentifier(root) && root.text === param) {
        processCalls(calls, module, base);
        return false;
      }
    });
  };

  const processCalls = (calls: Registration["calls"], module: ModuleInfo, base: string): void => {
    for (const call of calls) {
      if (METHODS.has(call.name)) {
        const path = index.stringOf(call.args[0], module);
        if (path !== undefined) emit(module, base, path, METHODS.get(call.name));
      } else if (call.name === "route") {
        const method = index.stringOf(call.args[0], module)?.toUpperCase();
        const path = index.stringOf(call.args[1], module);
        if (path !== undefined) emit(module, base, path, method);
      } else if (call.name === "group") {
        const prefix = index.stringOf(call.args[0], module);
        const callback = [...call.args].reverse().find(isFunctionExpression);
        if (prefix !== undefined && callback) processFunction(callback, module, joinRoutePaths(base, prefix));
      } else if (call.name === "guard") {
        const callback = call.args.find(isFunctionExpression);
        if (callback) processFunction(callback, module, base);
      } else if (call.name === "use" && call.args[0]) {
        usePlugin(call.args[0], module, base);
      }
    }
  };

  const usePlugin = (argument: ts.Expression, module: ModuleInfo, base: string): void => {
    const plugin = instanceOf(argument, module);
    if (plugin) return mount(plugin, base);

    const node = unwrapExpression(argument);
    if (isFunctionExpression(node)) return processFunction(node, module, base);
    if (ts.isIdentifier(node)) {
      const binding = index.resolve(module.path, node.text);
      if (binding?.fn) processFunction(binding.fn, binding.module, base);
    }
  };

  for (const instance of instances.values()) {
    if (!mounted.has(instance.key)) mount(instance, "/");
  }

  return sortRoutes([...routes.values()]);
}

function isFunctionExpression(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** `new Elysia({ prefix: "/users" })` */
function prefixOf(node: ts.NewExpression, module: ModuleInfo, index: ModuleIndex): string {
  const options = node.arguments?.[0];
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
