import { Project, SyntaxKind } from "ts-morph";
import type { ScannedFile } from "../analysis/index.js";
import type { RouteInfo } from "./routeDetector.js";

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
 * Known v1 limitations (from update5.md):
 * - @Controller({ path: '...' }) object form is skipped (prefix becomes "").
 * - app.setGlobalPrefix('api') is not composed into route paths.
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

      const prefixArg = controllerDecorator.getArguments()[0];
      const prefix =
        prefixArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ?? "";

      for (const method of cls.getMethods()) {
        const routeDecorator = method
          .getDecorators()
          .find((decorator) => ROUTE_DECORATORS.has(decorator.getName()));
        if (!routeDecorator) {
          continue;
        }

        const pathArg = routeDecorator.getArguments()[0];
        const subPath =
          pathArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ?? "";
        const decoratorName = routeDecorator.getName().toUpperCase();
        // @All() matches every HTTP method — expand instead of inventing a
        // placeholder value.
        const methods =
          decoratorName === "ALL" ? ALL_HTTP_METHODS : [decoratorName];

        routes.push({
          path: `/${[prefix, subPath].filter(Boolean).join("/")}`.replace(/\/+/g, "/"),
          file: file.path,
          kind: "api",
          methods
        });
      }
    }
  }

  return routes.sort((left, right) =>
    left.path.localeCompare(right.path) || left.file.localeCompare(right.file)
  );
}
