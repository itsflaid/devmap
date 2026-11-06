import { Node, Project } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import type { RouteInfo } from "./routeDetector.js";
import { compareText } from "../../utils/compare.js";

const ROUTE_DECORATORS = new Set([
  "Get",
  "Post",
  "Put",
  "Patch",
  "Delete",
  "Options",
  "Head",
  "All"
]);

const ALL_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

/**
 * detectNestRoutes — NestJS controllers are decorator + class based, so flat
 * per-line regex cannot associate a @Get(':id') with the @Controller('users')
 * that scopes it. ts-morph gives per-class/method decorator scope for free.
 *
 * Paths are read from string literals, no-substitution templates and arrays of
 * them, for both `@Controller('users')` and `@Controller({ path: 'users' })`.
 *
 * Known limitations:
 * - Paths built from constants or template substitutions are not resolved.
 * - app.setGlobalPrefix('api') and `version` are not composed into route paths.
 */
export function detectNestRoutes(files: ScannedFile[]): RouteInfo[] {
  // Cheap pre-filter before any ts-morph parse — most scans have no controllers.
  const candidates = files.filter(
    (file) => /\.[cm]?[jt]s$/.test(file.path) && file.content.includes("@Controller")
  );
  if (candidates.length === 0) {
    return [];
  }

  const project = new Project({ useInMemoryFileSystem: true });
  const routes: RouteInfo[] = [];

  for (const file of candidates) {
    let sourceFile;
    try {
      sourceFile = project.createSourceFile(file.path, file.content);
    } catch {
      continue; // one broken controller must not crash the whole scan
    }

    for (const cls of sourceFile.getClasses()) {
      const controllerDecorator = cls.getDecorator("Controller");
      if (!controllerDecorator) {
        continue;
      }

      const prefixes = controllerPrefixes(controllerDecorator.getArguments()[0]);

      for (const method of cls.getMethods()) {
        const routeDecorator = method
          .getDecorators()
          .find((decorator) => ROUTE_DECORATORS.has(decorator.getName()));
        if (!routeDecorator) {
          continue;
        }

        const subPaths = literalPaths(routeDecorator.getArguments()[0]);
        const decoratorName = routeDecorator.getName().toUpperCase();
        // @All() matches every HTTP method — expand instead of inventing a
        // placeholder value.
        const methods =
          decoratorName === "ALL" ? ALL_HTTP_METHODS : [decoratorName];

        for (const prefix of prefixes) {
          for (const subPath of subPaths.length > 0 ? subPaths : [""]) {
            routes.push({
              path: joinRoutePath(prefix, subPath),
              file: file.path,
              kind: "api",
              methods
            });
          }
        }
      }
    }
  }

  return routes.sort((left, right) =>
    compareText(left.path, right.path) || compareText(left.file, right.file)
  );
}

function literalText(node: Node | undefined): string | undefined {
  if (node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))) {
    return node.getLiteralText();
  }
  return undefined;
}

function literalPaths(node: Node | undefined): string[] {
  const text = literalText(node);
  if (text !== undefined) {
    return [text];
  }
  if (node && Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .map((element) => literalText(element))
      .filter((value): value is string => value !== undefined);
  }
  return [];
}

function controllerPrefixes(argument: Node | undefined): string[] {
  let paths: string[] = [];
  if (argument && Node.isObjectLiteralExpression(argument)) {
    const property = argument.getProperty("path");
    if (property && Node.isPropertyAssignment(property)) {
      paths = literalPaths(property.getInitializer());
    }
  } else {
    paths = literalPaths(argument);
  }
  return paths.length > 0 ? paths : [""];
}

function joinRoutePath(prefix: string, subPath: string): string {
  const joined = `/${[prefix, subPath].filter(Boolean).join("/")}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}
