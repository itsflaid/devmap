import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { isArchitectureSource } from "../graph/index.js";
import {
  importCallSpecifier, isChainTop, stringValue, unwindChain, unwrapExpression,
  type ChainCall
} from "./astUtils.js";
import { createModuleIndex, isShadowed, walkOutsideShadow, type ModuleIndex, type ModuleInfo } from "./moduleBindings.js";
import type { RouteInfo } from "./routeDetector.js";
import { joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * AdonisJS declares every URL in `start/routes.ts` (or files it imports):
 *
 *   router.get("/", [HomeController, "index"])
 *   router.group(() => { ... }).prefix("/api")
 *   router.resource("posts", PostsController).apiOnly()
 *   router.on("/").render("pages/home")
 *
 * Groups compose their prefix, `resource()` expands to the REST actions it
 * registers (minus `apiOnly`, `only` and `except`), and the listed file is the
 * controller that handles the route when it can be found.
 */

const ROUTER_MODULES = new Set(["@adonisjs/core/services/router", "@ioc:Adonis/Core/Route"]);
const GATE = /@adonisjs\/core\/services\/router|@ioc:Adonis\/Core\/Route|\buse\(\s*["']Route["']\s*\)/;

const VERBS = new Map<string, string | undefined>([
  ["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"], ["delete", "DELETE"], ["any", undefined]
]);

type Action = { name: string; methods: string[]; path: string };

const RESOURCE_ACTIONS: Action[] = [
  { name: "index", methods: ["GET"], path: "" },
  { name: "create", methods: ["GET"], path: "/create" },
  { name: "store", methods: ["POST"], path: "" },
  { name: "show", methods: ["GET"], path: "/:id" },
  { name: "edit", methods: ["GET"], path: "/:id/edit" },
  { name: "update", methods: ["PATCH", "PUT"], path: "/:id" },
  { name: "destroy", methods: ["DELETE"], path: "/:id" }
];

// What a handler that answers with a page calls.
const PAGE_SIGNAL = /\b(?:view|inertia)\.render|\brenderInertia\b|\.view\.render|\bview\.make\b|\binertia\.render\b|<!doctype|<html\b|<body\b/i;

export function detectAdonisRoutes(files: ScannedFile[], graph?: Record<string, string[]>): RouteInfo[] {
  const gated = files.filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file.path) && isArchitectureSource(file.path) && GATE.test(file.content));
  if (gated.length === 0) return [];

  const index = createModuleIndex(files, graph);
  const routes = new Map<string, RouteInfo>();
  const paths = files.map((file) => file.path);

  for (const file of gated) {
    const module = index.get(file.path);
    if (!module) continue;

    // v6 / v5 import the router; v4 reads it from the container: `const Route = use("Route")`.
    const names = new Set(
      [...module.imports].filter(([, value]) => ROUTER_MODULES.has(value.specifier)).map(([name]) => name)
    );
    for (const [name, initializer] of module.variables) {
      if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "use"
        && stringValue(initializer.arguments[0]) === "Route") {
        names.add(name);
      }
    }
    if (names.size === 0) continue;

    const visit = (scope: ts.Node, base: string): void => {
      const step = (node: ts.Node): boolean | void => {
        if (!ts.isCallExpression(node) || !isChainTop(node)) return;
        const { root, calls } = unwindChain(node);
        if (calls.length === 0 || !ts.isIdentifier(root) || !names.has(root.text) || isShadowed(node, root.text)) return;
        processChain(calls, base);
        return false;
      };
      walkOutsideShadow(scope, undefined, step);
    };

    const emit = (base: string, path: string, methods: string[] | undefined, handler: Handler): void => {
      const full = joinRoutePaths(base, path);
      const kind = handler.kind ?? classify(full, methods, handler.signal);
      const sorted = methods ? [...methods].sort() : undefined;
      routes.set(`${sorted?.join(",") ?? "*"} ${full} ${handler.file}`, {
        path: full,
        file: handler.file,
        kind,
        ...(sorted ? { methods: sorted } : {})
      });
    };

    const processChain = (calls: ChainCall[], base: string): void => {
      for (let i = 0; i < calls.length; i += 1) {
        const call = calls[i];
        let end = i + 1;
        while (end < calls.length && !isPrimary(calls[end].name)) end += 1;
        const modifiers = calls.slice(i + 1, end);

        if (call.name === "group") {
          const callback = call.args.find((arg) => ts.isArrowFunction(unwrapExpression(arg)) || ts.isFunctionExpression(unwrapExpression(arg)));
          const prefix = modifiers.filter((item) => item.name === "prefix").map((item) => index.stringOf(item.args[0], module) ?? "").join("/");
          const body = callback && (unwrapExpression(callback) as ts.ArrowFunction | ts.FunctionExpression).body;
          if (body) visit(body, joinRoutePaths(base, prefix));
        } else if (VERBS.has(call.name)) {
          const path = index.stringOf(call.args[0], module);
          if (path !== undefined) {
            const method = VERBS.get(call.name);
            emit(base, path, method ? [method] : undefined, handlerOf(call.args[1], module, index, paths));
          }
        } else if (call.name === "route") {
          const path = index.stringOf(call.args[0], module);
          const methods = methodList(call.args[1]);
          if (path !== undefined) emit(base, path, methods, handlerOf(call.args[2], module, index, paths));
        } else if (call.name === "on") {
          const path = index.stringOf(call.args[0], module);
          const renders = modifiers.some((item) => item.name === "render" || item.name === "renderInertia");
          if (path !== undefined && renders) emit(base, path, ["GET"], { file: module.path, kind: "page" });
        } else if (call.name === "resource" || call.name === "shallowResource") {
          expandResource(call, modifiers, base);
        }
        i = end - 1;
      }
    };

    const expandResource = (call: ChainCall, modifiers: ChainCall[], base: string): void => {
      const name = index.stringOf(call.args[0], module);
      if (!name) return;
      const handler = handlerOf(call.args[1], module, index, paths);
      const apiOnly = modifiers.some((item) => item.name === "apiOnly");
      const only = modifiers.find((item) => item.name === "only");
      const except = modifiers.find((item) => item.name === "except");
      const listed = (item: ChainCall | undefined) => new Set(arrayStrings(item?.args[0]));

      const segments = name.split(".");
      const prefix = segments.map((segment, position) =>
        position === segments.length - 1 ? segment : `${segment}/:${singular(segment)}_id`
      ).join("/");

      for (const action of RESOURCE_ACTIONS) {
        if (apiOnly && (action.name === "create" || action.name === "edit")) continue;
        if (only && !listed(only).has(action.name)) continue;
        if (except && listed(except).has(action.name)) continue;

        const signal = handler.controller ? methodSignal(handler.controller, action.name, index) : handler.signal;
        const kind = apiOnly ? "api" : action.name === "create" || action.name === "edit" ? "page" : undefined;
        emit(base, `${prefix}${action.path}`, action.methods, { ...handler, signal, ...(kind ? { kind } : {}) });
      }
    };

    visit(module.source, "/");
  }

  return sortRoutes([...routes.values()]);
}

const PRIMARY = new Set([...VERBS.keys(), "route", "on", "resource", "shallowResource", "group"]);
function isPrimary(name: string): boolean {
  return PRIMARY.has(name);
}

type Handler = {
  file: string;
  signal?: boolean;
  kind?: "page" | "api";
  /** Module of the controller, to look at one action. */
  controller?: ModuleInfo;
};

/** Where a route is handled: `[Controller, "method"]`, `"#controllers/x.method"`, a class, or a closure. */
function handlerOf(
  expression: ts.Expression | undefined,
  module: ModuleInfo,
  index: ModuleIndex,
  paths: string[]
): Handler {
  const fallback: Handler = { file: module.path };
  if (!expression) return fallback;
  const node = unwrapExpression(expression);

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return { ...fallback, signal: PAGE_SIGNAL.test(node.getText()) };
  }

  let target: ts.Expression | undefined;
  let method: string | undefined;
  if (ts.isArrayLiteralExpression(node) && node.elements[0]) {
    target = unwrapExpression(node.elements[0]);
    method = node.elements[1] ? stringValue(unwrapExpression(node.elements[1])) : undefined;
  } else if (ts.isIdentifier(node)) {
    target = node;
  }

  let file: string | undefined;
  if (target && ts.isIdentifier(target)) {
    file = controllerFile(target.text, module, index);
  } else if (target) {
    const specifier = importCallSpecifier(target);
    file = specifier ? index.resolveSpecifier(module.path, specifier) : undefined;
  }

  const text = target === undefined ? stringValue(node) : undefined;
  if (text !== undefined) {
    // "#controllers/users_controller.index" (v6) or "UsersController.index" (v5)
    const [controllerPath, action] = splitHandlerString(text);
    method = action;
    file = controllerPath.startsWith("#") || controllerPath.startsWith(".")
      ? index.resolveSpecifier(module.path, controllerPath)
      : paths.find((path) => /(?:^|\/)Controllers\//.test(path) && new RegExp(`/${escapeSlash(controllerPath)}\\.[cm]?[jt]s$`).test(path));
  }

  const controller = file ? index.get(file) : undefined;
  if (!file || !controller) return fallback;
  return { file, controller, signal: method ? methodSignal(controller, method, index) : PAGE_SIGNAL.test(controller.source.text) };
}

function controllerFile(name: string, module: ModuleInfo, index: ModuleIndex): string | undefined {
  const lazy = module.variables.get(name);
  const specifier = lazy ? importCallSpecifier(lazy) : undefined;
  if (specifier) return index.resolveSpecifier(module.path, specifier);

  const imported = module.imports.get(name);
  return imported ? index.resolveSpecifier(module.path, imported.specifier) : undefined;
}

function splitHandlerString(text: string): [string, string | undefined] {
  const match = /^(.*[^./])\.(\w+)$/.exec(text);
  return match && !match[1].endsWith("/") ? [match[1], match[2]] : [text, undefined];
}

function escapeSlash(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does the controller action `method` render a page? Falls back to the whole file. */
function methodSignal(controller: ModuleInfo, method: string, _index: ModuleIndex): boolean {
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (text !== undefined) return;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === method) {
      text = node.getText();
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(controller.source);
  return PAGE_SIGNAL.test(text ?? controller.source.text);
}

function classify(path: string, methods: string[] | undefined, signal: boolean | undefined): "page" | "api" {
  if (/^\/api(?:\/|$)/.test(path)) return "api";
  if (methods && methods.some((method) => method !== "GET")) return "api";
  return signal ? "page" : "api";
}

function methodList(expression: ts.Expression | undefined): string[] | undefined {
  const methods = arrayStrings(expression).map((method) => method.toUpperCase());
  return methods.length > 0 ? methods : undefined;
}

function arrayStrings(expression: ts.Expression | undefined): string[] {
  const node = expression ? unwrapExpression(expression) : undefined;
  if (!node || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements.flatMap((element) => stringValue(unwrapExpression(element)) ?? []);
}

function singular(name: string): string {
  if (/ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/(?:ss|us)$/.test(name)) return name;
  return name.replace(/s$/, "");
}
