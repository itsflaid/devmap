import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-fw2-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const pkg = (value: Record<string, unknown>) => JSON.stringify(value);

async function routeTable(root: string): Promise<string[]> {
  const map = await createProjectMap(root);
  return map.routes
    .map((route) => `${route.kind} ${route.path}${route.methods ? ` [${route.methods.join(",")}]` : ""} ${route.file}`)
    .sort();
}

const cls = (name: string) => `export class ${name} {}\n`;

// ------------------------------------------------------------------- Angular

test("Angular: routes, loadComponent, children, lazy routes files and lazy NgModules", async () => {
  await withProject({
    "package.json": pkg({ name: "ng", dependencies: { "@angular/core": "19.0.0", "@angular/platform-browser": "19.0.0", "@angular/router": "19.0.0" } }),
    "src/main.ts": 'import { bootstrapApplication } from "@angular/platform-browser";\nimport { appConfig } from "./app/app.config";\nbootstrapApplication(App, appConfig);\n',
    "src/app/app.config.ts": 'import { provideRouter } from "@angular/router";\nimport { routes } from "./app.routes";\nexport const appConfig = { providers: [provideRouter(routes)] };\n',
    "src/app/app.routes.ts": [
      'import { Routes } from "@angular/router";',
      'import { HomeComponent } from "./home/home.component";',
      'import { ShellComponent } from "./shell/shell.component";',
      'import { NotFoundComponent } from "./not-found.component";',
      "export const routes: Routes = [",
      '  { path: "", component: HomeComponent },',
      '  { path: "users/:id", loadComponent: () => import("./users/user.component").then((m) => m.UserComponent) },',
      '  { path: "docs", component: ShellComponent, children: [',
      '    { path: "", loadComponent: () => import("./docs/docs-index.component").then((m) => m.DocsIndexComponent) },',
      '    { path: "intro", loadComponent: () => import("./docs/intro.component").then((m) => m.IntroComponent) }',
      "  ] },",
      '  { path: "admin", loadChildren: () => import("./admin/admin.routes").then((m) => m.ADMIN_ROUTES) },',
      '  { path: "legacy", loadChildren: () => import("./legacy/legacy.module").then((m) => m.LegacyModule) },',
      '  { path: "old", redirectTo: "users/1", pathMatch: "full" },',
      '  { path: "**", component: NotFoundComponent }',
      "];",
      ""
    ].join("\n"),
    "src/app/home/home.component.ts": cls("HomeComponent"),
    "src/app/shell/shell.component.ts": cls("ShellComponent"),
    "src/app/not-found.component.ts": cls("NotFoundComponent"),
    "src/app/users/user.component.ts": cls("UserComponent"),
    "src/app/docs/docs-index.component.ts": cls("DocsIndexComponent"),
    "src/app/docs/intro.component.ts": cls("IntroComponent"),
    "src/app/admin/admin.routes.ts": [
      'import { Routes } from "@angular/router";',
      'import { DashboardComponent } from "./dashboard.component";',
      "export const ADMIN_ROUTES: Routes = [",
      '  { path: "", component: DashboardComponent },',
      '  { path: "settings", loadComponent: () => import("./settings.component").then((m) => m.SettingsComponent) }',
      "];",
      ""
    ].join("\n"),
    "src/app/admin/dashboard.component.ts": cls("DashboardComponent"),
    "src/app/admin/settings.component.ts": cls("SettingsComponent"),
    "src/app/legacy/legacy.module.ts": [
      'import { NgModule } from "@angular/core";',
      'import { LegacyRoutingModule } from "./legacy-routing.module";',
      "@NgModule({ imports: [LegacyRoutingModule] })",
      "export class LegacyModule {}",
      ""
    ].join("\n"),
    "src/app/legacy/legacy-routing.module.ts": [
      'import { NgModule } from "@angular/core";',
      'import { RouterModule, Routes } from "@angular/router";',
      'import { ReportComponent } from "./report.component";',
      'const routes: Routes = [{ path: "report", component: ReportComponent }];',
      "@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })",
      "export class LegacyRoutingModule {}",
      ""
    ].join("\n"),
    "src/app/legacy/report.component.ts": cls("ReportComponent")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/app/home/home.component.ts",
      "page /** src/app/not-found.component.ts",
      "page /admin src/app/admin/dashboard.component.ts",
      "page /admin/settings src/app/admin/settings.component.ts",
      "page /docs src/app/docs/docs-index.component.ts",
      "page /docs/intro src/app/docs/intro.component.ts",
      "page /legacy/report src/app/legacy/report.component.ts",
      "page /users/:id src/app/users/user.component.ts"
    ]);
    const map = await createProjectMap(root);
    assert.equal(map.framework, "angular");
  });
});

test("Angular: a library that only lists @angular/core is not an Angular app", async () => {
  await withProject({
    "package.json": pkg({ name: "ng-lib", peerDependencies: { "@angular/core": "^19.0.0" }, devDependencies: { "@angular/core": "19.0.0" } }),
    "src/index.ts": "export const x = 1;\n"
  }, async (root) => {
    assert.notEqual((await createProjectMap(root)).framework, "angular");
  });
});

// ----------------------------------------------------------------- SolidStart

test("SolidStart: file routes, groups, layouts and API handlers", async () => {
  await withProject({
    "package.json": pkg({ name: "solid", dependencies: { "@solidjs/start": "1.1.0", "solid-js": "1.9.0" } }),
    "src/app.tsx": "export default function App() { return null; }\n",
    "src/routes/index.tsx": "export default function Home() { return null; }\n",
    "src/routes/about.tsx": "export default function About() { return null; }\n",
    "src/routes/users.tsx": "export default function UsersLayout(props) { return props.children; }\n",
    "src/routes/users/index.tsx": "export default function Users() { return null; }\n",
    "src/routes/users/[id].tsx": "export default function User() { return null; }\n",
    "src/routes/docs/[...slug].tsx": "export default function Docs() { return null; }\n",
    "src/routes/(auth)/login.tsx": "export default function Login() { return null; }\n",
    "src/routes/api/health.ts": 'export function GET() { return new Response("ok"); }\nexport async function POST() { return new Response("ok"); }\n',
    "src/routes/helpers.ts": "export const x = 1;\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/health [GET,POST] src/routes/api/health.ts",
      "page / src/routes/index.tsx",
      "page /about src/routes/about.tsx",
      "page /docs/[...slug] src/routes/docs/[...slug].tsx",
      "page /login src/routes/(auth)/login.tsx",
      "page /users src/routes/users/index.tsx",
      "page /users/[id] src/routes/users/[id].tsx"
    ]);
    assert.equal((await createProjectMap(root)).framework, "solid-start");
  });
});

// ----------------------------------------------------------------------- Qwik

test("Qwik City: index routes, groups, layout variants and endpoints", async () => {
  await withProject({
    "package.json": pkg({ name: "qwik", devDependencies: { "@builder.io/qwik": "1.12.0", "@builder.io/qwik-city": "1.12.0" } }),
    "src/root.tsx": "export default () => null;\n",
    "src/routes/layout.tsx": "export default () => null;\n",
    "src/routes/index.tsx": "export default () => null;\n",
    "src/routes/blog/[slug]/index.tsx": "export default () => null;\nexport const onGet = () => {};\n",
    "src/routes/(marketing)/about/index.mdx": "# About\n",
    "src/routes/admin/index@admin.tsx": "export default () => null;\n",
    "src/routes/admin/layout-admin.tsx": "export default () => null;\n",
    "src/routes/api/ping/index.ts": "export const onGet = () => {};\nexport const onPost = () => {};\n",
    "src/routes/api/any/index.ts": "export const onRequest = () => {};\n",
    "src/routes/plugin@auth.ts": "export const onRequest = () => {};\n",
    "src/components/button.tsx": "export default () => null;\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/any src/routes/api/any/index.ts",
      "api /api/ping [GET,POST] src/routes/api/ping/index.ts",
      "page / src/routes/index.tsx",
      "page /about src/routes/(marketing)/about/index.mdx",
      "page /admin src/routes/admin/index@admin.tsx",
      "page /blog/[slug] src/routes/blog/[slug]/index.tsx"
    ]);
    assert.equal((await createProjectMap(root)).framework, "qwik");
  });
});

// --------------------------------------------------------------------- Elysia

test("Elysia: prefix, group, guard, plugins across files and function plugins", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { elysia: "1.2.0" } }),
    "src/index.ts": [
      'import { Elysia } from "elysia";',
      'import { users } from "./users";',
      'import { posts } from "./posts";',
      "",
      "const health = (app: Elysia) => app.get(\"/health\", () => \"ok\");",
      "",
      "const app = new Elysia()",
      '  .get("/", () => "hi")',
      "  .use(users)",
      "  .use(health)",
      '  .group("/v1", (app) => app',
      '    .get("/ping", () => "pong")',
      '    .use(posts)',
      '    .guard({ beforeHandle: () => {} }, (app) => app.post("/secure", () => "ok"))',
      "  )",
      "  .listen(3000);",
      "app.delete(\"/reset\", () => \"gone\");",
      ""
    ].join("\n"),
    "src/users.ts": [
      'import { Elysia } from "elysia";',
      'export const users = new Elysia({ prefix: "/users" })',
      '  .get("/", () => [])',
      '  .get("/:id", ({ params }) => params.id)',
      '  .post("/", () => "created");',
      ""
    ].join("\n"),
    "src/posts.ts": [
      'import { Elysia } from "elysia";',
      'const posts = new Elysia({ prefix: "/posts" });',
      'posts.get("/:slug", () => "post");',
      'posts.ws("/live", { message() {} });',
      "export { posts };",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api / [GET] src/index.ts",
      "api /health [GET] src/index.ts",
      "api /reset [DELETE] src/index.ts",
      "api /users [GET] src/users.ts",
      "api /users [POST] src/users.ts",
      "api /users/:id [GET] src/users.ts",
      "api /v1/ping [GET] src/index.ts",
      "api /v1/posts/:slug [GET] src/posts.ts",
      "api /v1/posts/live [WS] src/posts.ts",
      "api /v1/secure [POST] src/index.ts"
    ]);
    assert.equal((await createProjectMap(root)).framework, "elysia");
  });
});

// ------------------------------------------------------------------------ Koa

test("Koa: router prefix, nested routers across files, named routes and koa-mount", async () => {
  await withProject({
    "package.json": pkg({ name: "koa-api", dependencies: { koa: "2.15.0", "@koa/router": "13.0.0", "koa-mount": "4.0.0" } }),
    "src/app.ts": [
      'import Koa from "koa";',
      'import Router from "@koa/router";',
      'import mount from "koa-mount";',
      'import { users } from "./users";',
      'const admin = require("./admin");',
      "",
      "const app = new Koa();",
      "const api = new Router({ prefix: \"/api\" });",
      "api.get(\"/status\", (ctx) => { ctx.body = 1; });",
      "api.use(\"/users\", users.routes(), users.allowedMethods());",
      "const home = new Router();",
      "home.get(\"/\", (ctx) => {}).get(\"index\", \"/index\", (ctx) => {}).get([\"/a\", \"/b\"], (ctx) => {});",
      "app.use(home.routes());",
      "app.use(api.routes());",
      "app.use(mount(\"/admin\", admin.routes()));",
      ""
    ].join("\n"),
    "src/users.ts": [
      'import Router from "@koa/router";',
      "export const users = new Router();",
      'users.get("/", (ctx) => {});',
      'users.get("/:id", (ctx) => {});',
      'users.del("/:id", (ctx) => {});',
      ""
    ].join("\n"),
    "src/admin.js": [
      'const Router = require("koa-router");',
      "const router = new Router();",
      'router.post("/login", (ctx) => {});',
      "module.exports = router;",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api / [GET] src/app.ts",
      "api /a [GET] src/app.ts",
      "api /admin/login [POST] src/admin.js",
      "api /api/status [GET] src/app.ts",
      "api /api/users [GET] src/users.ts",
      "api /api/users/:id [DELETE] src/users.ts",
      "api /api/users/:id [GET] src/users.ts",
      "api /b [GET] src/app.ts",
      "api /index [GET] src/app.ts"
    ]);
    assert.equal((await createProjectMap(root)).framework, "koa");
  });
});

// -------------------------------------------------------------------- AdonisJS

test("AdonisJS: groups, prefix, resources, controllers and rendered views", async () => {
  await withProject({
    "package.json": pkg({
      name: "adonis",
      type: "module",
      imports: { "#controllers/*": "./app/controllers/*.js" },
      dependencies: { "@adonisjs/core": "6.14.0" }
    }),
    "adonisrc.ts": "export default {};\n",
    "start/routes.ts": [
      'import router from "@adonisjs/core/services/router";',
      'const PostsController = () => import("#controllers/posts_controller");',
      'const PagesController = () => import("#controllers/pages_controller");',
      'import UsersController from "#controllers/users_controller";',
      "",
      'router.on("/").render("pages/home");',
      'router.get("/about", [PagesController, "about"]);',
      'router.post("/contact", [PagesController, "contact"]);',
      "",
      "router.group(() => {",
      '  router.get("/me", [UsersController, "me"]);',
      '  router.resource("posts", PostsController).apiOnly();',
      '  router.group(() => { router.get("/stats", async () => ({ ok: true })); }).prefix("/admin");',
      '}).prefix("/api/v1");',
      "",
      'router.resource("comments", "#controllers/posts_controller").only(["index", "show"]);',
      ""
    ].join("\n"),
    "app/controllers/posts_controller.ts": "export default class PostsController { async index() {} async show() {} async store() {} async update() {} async destroy() {} }\n",
    "app/controllers/users_controller.ts": "export default class UsersController { async me() {} }\n",
    "app/controllers/pages_controller.ts": [
      "export default class PagesController {",
      '  async about({ view }) { return view.render("pages/about"); }',
      "  async contact() {}",
      "}",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/v1/admin/stats [GET] start/routes.ts",
      "api /api/v1/me [GET] app/controllers/users_controller.ts",
      "api /api/v1/posts [GET] app/controllers/posts_controller.ts",
      "api /api/v1/posts [POST] app/controllers/posts_controller.ts",
      "api /api/v1/posts/:id [DELETE] app/controllers/posts_controller.ts",
      "api /api/v1/posts/:id [GET] app/controllers/posts_controller.ts",
      "api /api/v1/posts/:id [PATCH,PUT] app/controllers/posts_controller.ts",
      "api /comments [GET] app/controllers/posts_controller.ts",
      "api /comments/:id [GET] app/controllers/posts_controller.ts",
      "api /contact [POST] app/controllers/pages_controller.ts",
      "page / [GET] start/routes.ts",
      "page /about [GET] app/controllers/pages_controller.ts"
    ]);
    assert.equal((await createProjectMap(root)).framework, "adonisjs");
  });
});

// ------------------------------------------------------- constants as paths

test("paths held in constants and enums are resolved, and lazy route files need no router import", async () => {
  await withProject({
    "package.json": pkg({ name: "ng", dependencies: { "@angular/core": "19.0.0", "@angular/platform-browser": "19.0.0", "@angular/router": "19.0.0", elysia: "1.2.0" } }),
    "src/app/paths.ts": [
      "export const PATHS = { home: '', account: 'account', login: 'log-in' };",
      "export enum Api { Base = '/api', Users = '/users' }",
      "export const VERSION = '/v2';",
      ""
    ].join("\n"),
    "src/app/app.routes.ts": [
      'import type { Route } from "@angular/router";',
      'import { PATHS } from "./paths";',
      "export const appRoutes: Route[] = [",
      '  { path: PATHS.account, loadChildren: async () => import("./account.routes").then((m) => m.ACCOUNT_ROUTES) }',
      "];",
      ""
    ].join("\n"),
    "src/app/account.routes.ts": [
      'import { PATHS } from "./paths";',
      'import { LoginComponent } from "./login.component";',
      "export const ACCOUNT_ROUTES = [{ path: PATHS.login, component: LoginComponent, canActivate: [] }];",
      ""
    ].join("\n"),
    "src/app/login.component.ts": cls("LoginComponent"),
    "src/api.ts": [
      'import { Elysia } from "elysia";',
      'import { Api, VERSION } from "./app/paths";',
      "const prefix = `${Api.Base}${VERSION}`;",
      "export const app = new Elysia({ prefix })",
      "  .get(Api.Users + '/:id', () => 1)",
      "  .group(`${Api.Users}/admin`, (app) => app.post('/ban', () => 1));",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/v2/users/:id [GET] src/api.ts",
      "api /api/v2/users/admin/ban [POST] src/api.ts",
      "page /account/log-in src/app/login.component.ts"
    ]);
  });
});
