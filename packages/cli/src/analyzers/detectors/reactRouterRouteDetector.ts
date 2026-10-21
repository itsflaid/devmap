import { posix } from "node:path";
import { ts } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import { parseSource, stringValue, unwrapExpression } from "./astUtils.js";
import { detectFlatFileRoutes, readRouteModule } from "./remixRouteDetector.js";
import type { RouteInfo } from "./routeDetector.js";
import { dropShadowedLayouts, joinRoutePaths, sortRoutes } from "./routeUtils.js";

/**
 * React Router v7 framework mode declares its routes in `app/routes.ts`:
 *
 *   export default [
 *     index("routes/home.tsx"),
 *     route("teams/:teamId", "routes/team.tsx", [index("routes/team-home.tsx")]),
 *     layout("layouts/auth.tsx", [route("login", "routes/login.tsx")]),
 *     ...prefix("api", [route("users", "routes/api/users.ts")]),
 *     ...(await flatRoutes())            // file-name convention, see remixRouteDetector
 *   ] satisfies RouteConfig;
 *
 * The array is a plain value, so it is read from the AST rather than matched
 * with regexes: nesting, `prefix()` and identifiers pointing at other arrays
 * all compose the way React Router composes them.
 */

const ROUTES_MODULE = "@react-router/dev/routes";

type RouteNode = {
  path: string;
  file?: string;
  index?: boolean;
  /** `layout()` wraps children without adding a URL segment. */
  layout?: boolean;
  /** `prefix()` only adds a URL segment to its children. */
  group?: boolean;
  children: RouteNode[];
};

type ParsedConfig = {
  nodes: RouteNode[];
  usesFlatRoutes: boolean;
};

export function detectReactRouterRoutes(files: ScannedFile[]): RouteInfo[] {
  const configs = files.filter((file) =>
    /(^|\/)routes\.[cm]?[jt]s$/.test(file.path) && file.content.includes(ROUTES_MODULE)
  );
  const byPath = new Map(files.map((file) => [file.path, file]));
  const routes: RouteInfo[] = [];

  for (const config of configs) {
    const appDir = posix.dirname(config.path) === "." ? "" : posix.dirname(config.path);
    const parsed = parseRouteConfig(config);

    const entries: Array<RouteInfo & { isIndex: boolean; isLayout: boolean }> = [];
    collect(parsed.nodes, "/", (node, path) => {
      if (!node.file || node.layout || node.group) return;
      const file = byPath.get(posix.normalize(posix.join(appDir, node.file)));
      const module = file ? readRouteModule(file) : undefined;
      if (!file) return;

      entries.push({
        path,
        file: file.path,
        kind: module?.kind ?? "page",
        ...(module?.methods ? { methods: module.methods } : {}),
        isIndex: Boolean(node.index),
        isLayout: node.children.length > 0
      });
    });

    routes.push(...dropShadowedLayouts(entries).map((entry) => ({
      path: entry.path,
      file: entry.file,
      kind: entry.kind,
      ...(entry.methods ? { methods: entry.methods } : {})
    })));

    if (parsed.usesFlatRoutes) {
      routes.push(...detectFlatFileRoutes(files, appDir === "" ? "routes/" : `${appDir}/routes/`));
    }
  }

  return sortRoutes(routes);
}

function collect(
  nodes: RouteNode[],
  base: string,
  visit: (node: RouteNode, path: string) => void
): void {
  for (const node of nodes) {
    const path = node.layout ? base : joinRoutePaths(base, node.path);
    visit(node, path);
    collect(node.children, path, visit);
  }
}

function parseRouteConfig(file: ScannedFile): ParsedConfig {
  const source = parseSource(file.path, file.content);
  const helpers = new Map<string, string>();
  const variables = new Map<string, ts.Expression>();
  let defaultExport: ts.Expression | undefined;
  let usesFlatRoutes = false;

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = stringValue(statement.moduleSpecifier);
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (module === ROUTES_MODULE) helpers.set(element.name.text, imported);
          if (imported === "flatRoutes") helpers.set(element.name.text, "flatRoutes");
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          variables.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement.expression;
    }
  }

  const seen = new Set<string>();

  const evaluate = (expression: ts.Expression): RouteNode[] => {
    const node = unwrapExpression(expression);

    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.flatMap((element) =>
        evaluate(ts.isSpreadElement(element) ? element.expression : element)
      );
    }

    if (ts.isIdentifier(node)) {
      const initializer = variables.get(node.text);
      if (!initializer || seen.has(node.text)) return [];
      seen.add(node.text);
      const result = evaluate(initializer);
      seen.delete(node.text);
      return result;
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      return evaluateHelper(helpers.get(node.expression.text), node.arguments);
    }

    return [];
  };

  const lastChildren = (args: readonly ts.Expression[], from: number): RouteNode[] => {
    const candidate = args.slice(from).reverse().find((arg) => {
      const unwrapped = unwrapExpression(arg);
      return !ts.isObjectLiteralExpression(unwrapped) && !stringValue(unwrapped);
    });
    return candidate ? evaluate(candidate) : [];
  };

  const evaluateHelper = (helper: string | undefined, args: readonly ts.Expression[]): RouteNode[] => {
    switch (helper) {
      case "index":
        return [{ path: "", index: true, file: stringValue(args[0]), children: [] }];
      case "route":
        return [{ path: stringValue(args[0]) ?? "", file: stringValue(args[1]), children: lastChildren(args, 2) }];
      case "layout":
        return [{ path: "", file: stringValue(args[0]), layout: true, children: lastChildren(args, 1) }];
      case "prefix":
        return [{ path: stringValue(args[0]) ?? "", group: true, children: args[1] ? evaluate(args[1]) : [] }];
      case "flatRoutes":
        usesFlatRoutes = true;
        return [];
      default:
        return [];
    }
  };

  return { nodes: defaultExport ? evaluate(defaultExport) : [], usesFlatRoutes };
}
