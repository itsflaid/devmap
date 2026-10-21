import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanFiles } from "../src/analyzers/analysis/fileScanner.js";
import { detectFrameworks } from "../src/analyzers/detectors/frameworkDetector.js";
import { buildDependencyGraph, loadAliasMappings } from "../src/analyzers/graph/index.js";
import { readAliasEntries } from "../src/analyzers/graph/bundlerAliases.js";
import { analyzeFiles } from "../src/analyzers/pipeline/analyzerRegistry.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-fw-"));
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

async function frameworksOf(root: string): Promise<string[]> {
  return detectFrameworks(await scanFiles(root));
}

/** `GET /path (file)` lines, sorted, so one assertion shows the whole route table. */
async function routeTable(root: string): Promise<string[]> {
  const map = await createProjectMap(root);
  return map.routes
    .map((route) => `${route.kind} ${route.path}${route.methods ? ` [${route.methods.join(",")}]` : ""} ${route.file}`)
    .sort();
}

const page = "export default function Page() { return null; }\n";

// ------------------------------------------------------------------ detection

test("Remix, React Router v7, TanStack and Expo win over plain react", async () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    ["remix", { "@remix-run/react": "2.0.0", "@remix-run/node": "2.0.0", react: "18.0.0", "react-dom": "18.0.0" }, "remix"],
    ["react-router", { "react-router": "7.0.0", "@react-router/dev": "7.0.0", react: "19.0.0", "react-dom": "19.0.0" }, "react-router"],
    ["tanstack-start", { "@tanstack/react-start": "1.0.0", "@tanstack/react-router": "1.0.0", react: "19.0.0", "react-dom": "19.0.0" }, "tanstack-start"],
    ["tanstack-router", { "@tanstack/react-router": "1.0.0", react: "19.0.0", "react-dom": "19.0.0" }, "tanstack-router"],
    ["expo", { expo: "52.0.0", "expo-router": "4.0.0", react: "18.0.0", "react-native": "0.76.0" }, "expo"]
  ];

  for (const [name, dependencies, expected] of cases) {
    await withProject({ "package.json": pkg({ name, dependencies }), "src/index.ts": "export {};\n" }, async (root) => {
      assert.deepEqual(await frameworksOf(root), [expected], name);
    });
  }
});

test("react-router-dom and @remix-run/router alone do not make a framework app", async () => {
  await withProject({
    "package.json": pkg({
      name: "spa",
      dependencies: { react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "7.0.0", "@remix-run/router": "1.0.0" }
    }),
    "src/main.tsx": "export {};\n"
  }, async (root) => {
    assert.deepEqual(await frameworksOf(root), ["react"]);
  });
});

test("Hono is a backend framework and sits next to a frontend one", async () => {
  await withProject({
    "package.json": pkg({ name: "edge", dependencies: { hono: "4.0.0", next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "src/index.ts": "export {};\n"
  }, async (root) => {
    assert.deepEqual(await frameworksOf(root), ["nextjs", "hono"]);
  });
});

// ------------------------------------------------------------------- Remix

test("Remix flat routes: params, pathless layouts, escapes and resource routes", async () => {
  await withProject({
    "package.json": pkg({ name: "app", dependencies: { "@remix-run/react": "2.0.0", react: "18.0.0", "react-dom": "18.0.0" } }),
    "app/root.tsx": page,
    "app/routes/_index.tsx": page,
    "app/routes/notes.tsx": 'import { Outlet } from "@remix-run/react";\nexport default function Notes() { return <Outlet />; }\n',
    "app/routes/notes._index.tsx": page,
    "app/routes/notes.$noteId.tsx": page,
    "app/routes/_auth.login.tsx": page,
    "app/routes/posts_.$slug.tsx": page,
    "app/routes/($lang).about.tsx": page,
    "app/routes/files.$.tsx": page,
    "app/routes/sitemap[.]xml.tsx": "export const loader = () => new Response('');\n",
    "app/routes/logout.tsx": "export const action = () => null;\nexport const loader = () => null;\n",
    "app/routes/blog/route.tsx": page
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /logout [GET,POST] app/routes/logout.tsx",
      "api /sitemap.xml [GET] app/routes/sitemap[.]xml.tsx",
      "page / app/routes/_index.tsx",
      "page /:lang?/about app/routes/($lang).about.tsx",
      "page /blog app/routes/blog/route.tsx",
      "page /files/* app/routes/files.$.tsx",
      "page /login app/routes/_auth.login.tsx",
      "page /notes app/routes/notes._index.tsx",
      "page /notes/:noteId app/routes/notes.$noteId.tsx",
      "page /posts/:slug app/routes/posts_.$slug.tsx"
    ]);
  });
});

test("Remix route files are entry points even though no file imports them", async () => {
  await withProject({
    "package.json": pkg({ name: "app", dependencies: { "@remix-run/react": "2.0.0", react: "18.0.0", "react-dom": "18.0.0" } }),
    "app/root.tsx": 'import "./styles";\nexport default function Root() { return null; }\n',
    "app/styles.ts": "export {};\n",
    "app/routes/_index.tsx": page,
    "app/utils/format.ts": "export const format = () => '';\n"
  }, async (root) => {
    const map = await createProjectMap(root);
    assert.ok(map.entryPoints.includes("app/root.tsx"));
    assert.ok(map.entryPoints.includes("app/routes/_index.tsx"));
  });
});

// ------------------------------------------------------------ React Router v7

test("React Router v7 reads app/routes.ts: nesting, layout(), prefix() and variables", async () => {
  await withProject({
    "package.json": pkg({
      name: "app",
      dependencies: { "react-router": "7.0.0", react: "19.0.0", "react-dom": "19.0.0" },
      devDependencies: { "@react-router/dev": "7.0.0" }
    }),
    "app/routes.ts": [
      'import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";',
      "",
      'const api = [route("users", "routes/api/users.ts"), route("users/:id", "routes/api/user.ts")];',
      "",
      "export default [",
      '  index("routes/home.tsx"),',
      '  route("about", "routes/about.tsx"),',
      '  route("teams/:teamId", "routes/team.tsx", [',
      '    index("routes/team-home.tsx"),',
      '    route("settings", "routes/team-settings.tsx")',
      "  ]),",
      '  layout("layouts/auth.tsx", [route("login", "routes/login.tsx")]),',
      '  ...prefix("api", api)',
      "] satisfies RouteConfig;",
      ""
    ].join("\n"),
    "app/root.tsx": page,
    "app/layouts/auth.tsx": page,
    "app/routes/home.tsx": page,
    "app/routes/about.tsx": page,
    "app/routes/team.tsx": 'import { Outlet } from "react-router";\nexport default function Team() { return <Outlet />; }\n',
    "app/routes/team-home.tsx": page,
    "app/routes/team-settings.tsx": page,
    "app/routes/login.tsx": page,
    "app/routes/api/users.ts": "export async function loader() { return []; }\n",
    "app/routes/api/user.ts": "export async function loader() { return {}; }\nexport async function action() { return {}; }\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/users [GET] app/routes/api/users.ts",
      "api /api/users/:id [GET,POST] app/routes/api/user.ts",
      "page / app/routes/home.tsx",
      "page /about app/routes/about.tsx",
      "page /login app/routes/login.tsx",
      "page /teams/:teamId app/routes/team-home.tsx",
      "page /teams/:teamId/settings app/routes/team-settings.tsx"
    ]);
  });
});

test("React Router v7 flatRoutes() pulls in the file-name convention", async () => {
  await withProject({
    "package.json": pkg({
      name: "app",
      dependencies: { "react-router": "7.0.0", react: "19.0.0", "react-dom": "19.0.0" },
      devDependencies: { "@react-router/dev": "7.0.0", "@react-router/fs-routes": "7.0.0" }
    }),
    "app/routes.ts": [
      'import { type RouteConfig } from "@react-router/dev/routes";',
      'import { flatRoutes } from "@react-router/fs-routes";',
      "export default (await flatRoutes()) satisfies RouteConfig;",
      ""
    ].join("\n"),
    "app/routes/_index.tsx": page,
    "app/routes/projects.$id.tsx": page
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / app/routes/_index.tsx",
      "page /projects/:id app/routes/projects.$id.tsx"
    ]);
  });
});

// ------------------------------------------------------------------ TanStack

test("TanStack Router reads each route's own id; the generated tree is not a route", async () => {
  await withProject({
    "package.json": pkg({
      name: "app",
      dependencies: { "@tanstack/react-router": "1.0.0", react: "19.0.0", "react-dom": "19.0.0" }
    }),
    "src/main.tsx": 'import { routeTree } from "./routeTree.gen";\nexport default routeTree;\n',
    "src/routeTree.gen.ts": [
      'import { Route as RootRoute } from "./routes/__root";',
      'import { Route as IndexRoute } from "./routes/index";',
      'import { Route as PostIdRoute } from "./routes/posts.$postId";',
      "export const routeTree = [RootRoute, IndexRoute, PostIdRoute];",
      ""
    ].join("\n"),
    "src/routes/__root.tsx": "export const Route = createRootRoute({ component: () => null });\n",
    "src/routes/index.tsx": "export const Route = createFileRoute('/')({ component: () => null });\n",
    "src/routes/posts.tsx": "export const Route = createFileRoute('/posts')({ component: () => <Outlet /> });\n",
    "src/routes/posts.index.tsx": "export const Route = createFileRoute('/posts/')({ component: () => null });\n",
    "src/routes/posts.$postId.tsx": "import { getPost } from \"../lib/posts\";\nexport const Route = createFileRoute('/posts/$postId')({ loader: getPost });\n",
    "src/lib/posts.ts": "export const getPost = () => null;\n",
    "src/routes/_authed/dashboard.tsx": "export const Route = createFileRoute('/_authed/dashboard')({ component: () => null });\n",
    "src/routes/(shop)/cart.tsx": "export const Route = createFileRoute('/(shop)/cart')({ component: () => null });\n",
    "src/routes/about.lazy.tsx": "export const Route = createLazyFileRoute('/about')({ component: () => null });\n",
    "src/routes/about.tsx": "export const Route = createFileRoute('/about')({ loader: () => null });\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/routes/index.tsx",
      "page /about src/routes/about.lazy.tsx",
      "page /cart src/routes/(shop)/cart.tsx",
      "page /dashboard src/routes/_authed/dashboard.tsx",
      "page /posts src/routes/posts.index.tsx",
      "page /posts/$postId src/routes/posts.$postId.tsx"
    ]);

    const map = await createProjectMap(root);
    assert.equal(map.entryPoints[0], "src/routes/__root.tsx");
    assert.ok(!map.entryPoints.includes("src/routeTree.gen.ts"));
    assert.ok(map.entryPoints.includes("src/routes/posts.$postId.tsx"), "the generated tree must not hide route files");
  });
});

test("TanStack Start server handlers are api routes with their methods", async () => {
  await withProject({
    "package.json": pkg({
      name: "app",
      dependencies: { "@tanstack/react-start": "1.0.0", "@tanstack/react-router": "1.0.0", react: "19.0.0", "react-dom": "19.0.0" }
    }),
    "src/router.tsx": "export function getRouter() { return null; }\n",
    "src/routes/__root.tsx": "export const Route = createRootRoute({});\n",
    "src/routes/index.tsx": "export const Route = createFileRoute('/')({ component: () => null });\n",
    "src/routes/api/users.ts": [
      "export const Route = createFileRoute('/api/users')({",
      "  server: { handlers: { GET: async () => Response.json([]), POST: async () => new Response('ok') } }",
      "});",
      ""
    ].join("\n"),
    "src/routes/api/users.$userId.ts": [
      "export const Route = createFileRoute('/api/users/$userId')({",
      "  server: { middleware: [], handlers: { DELETE: async () => new Response(null) } }",
      "});",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/users [GET,POST] src/routes/api/users.ts",
      "api /api/users/$userId [DELETE] src/routes/api/users.$userId.ts",
      "page / src/routes/index.tsx"
    ]);

    const map = await createProjectMap(root);
    assert.ok(map.entryPoints.includes("src/router.tsx"));
  });
});

// ---------------------------------------------------------------------- Expo

test("Expo Router: groups, dynamic segments, API routes; layouts are not screens", async () => {
  await withProject({
    "package.json": pkg({
      name: "mobile",
      main: "expo-router/entry",
      dependencies: { expo: "52.0.0", "expo-router": "4.0.0", react: "18.0.0", "react-native": "0.76.0" }
    }),
    "app/_layout.tsx": page,
    "app/index.tsx": page,
    "app/+not-found.tsx": page,
    "app/(tabs)/_layout.tsx": page,
    "app/(tabs)/explore.tsx": page,
    "app/post/[id].tsx": page,
    "app/post/index.tsx": page,
    "app/[...missing].tsx": page,
    "app/about.tsx": page,
    "app/about.web.tsx": page,
    "app/hello+api.ts": "export function GET() { return Response.json({}); }\nexport async function POST() { return Response.json({}); }\n",
    "app/helpers.ts": "export const x = 1;\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /hello [GET,POST] app/hello+api.ts",
      "page / app/index.tsx",
      "page /[...missing] app/[...missing].tsx",
      "page /about app/about.tsx",
      "page /explore app/(tabs)/explore.tsx",
      "page /post app/post/index.tsx",
      "page /post/[id] app/post/[id].tsx"
    ]);

    const map = await createProjectMap(root);
    assert.ok(map.entryPoints.includes("app/_layout.tsx"));
  });
});

test("Expo Router reads a custom root from app.json", async () => {
  await withProject({
    "package.json": pkg({ name: "mobile", dependencies: { expo: "52.0.0", "expo-router": "4.0.0", react: "18.0.0" } }),
    "app.json": JSON.stringify({ expo: { plugins: [["expo-router", { root: "src/screens" }]] } }),
    "src/screens/index.tsx": page,
    "src/screens/settings.tsx": page,
    "app/ignored.tsx": page
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/screens/index.tsx",
      "page /settings src/screens/settings.tsx"
    ]);
  });
});

// ---------------------------------------------------------------------- Hono

test("Hono: chains, basePath, mounted apps, constrained params and c.get()", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0" } }),
    "src/index.ts": [
      'import { Hono } from "hono";',
      "",
      "const book = new Hono();",
      'book.get("/", (c) => c.json([])).post("/", (c) => c.json({}));',
      'book.get("/:id{[0-9]+}", (c) => c.json({}));',
      "",
      'const app = new Hono().basePath("/v1");',
      'app.use("*", async (c, next) => { c.get("user"); await next(); });',
      'app.get("/health", (c) => c.text("ok"));',
      'app.on(["PUT", "DELETE"], "/items/:id", (c) => c.text("ok"));',
      'app.all("/echo", (c) => c.text("ok"));',
      'app.route("/book", book);',
      "",
      "export default app;",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /v1/book [GET,POST] src/index.ts",
      "api /v1/book/:id [GET] src/index.ts",
      "api /v1/echo src/index.ts",
      "api /v1/health [GET] src/index.ts",
      "api /v1/items/:id [DELETE,PUT] src/index.ts"
    ]);
  });
});

test("Hono apps mounted from another file compose their prefixes", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0" } }),
    "src/index.ts": [
      'import { Hono } from "hono";',
      'import users from "./routes/users";',
      'import { posts } from "./routes/posts.js";',
      "",
      'const app = new Hono().basePath("/api");',
      'app.route("/users", users).route("/posts", posts);',
      "export default app;",
      ""
    ].join("\n"),
    "src/routes/users.ts": [
      'import { Hono } from "hono";',
      "const users = new Hono();",
      'users.get("/", (c) => c.json([]));',
      'users.get("/:id", (c) => c.json({}));',
      "export default users;",
      ""
    ].join("\n"),
    "src/routes/posts.ts": [
      'import { Hono } from "hono";',
      "export const posts = new Hono()",
      '  .get("/", (c) => c.json([]))',
      '  .delete("/:id", (c) => c.json({}));',
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/posts [GET] src/routes/posts.ts",
      "api /api/posts/:id [DELETE] src/routes/posts.ts",
      "api /api/users [GET] src/routes/users.ts",
      "api /api/users/:id [GET] src/routes/users.ts"
    ]);
  });
});

test("Hono OpenAPI routes read method and path from createRoute()", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0", "@hono/zod-openapi": "0.18.0" } }),
    "src/routes.ts": [
      'import { createRoute } from "@hono/zod-openapi";',
      'export const getUser = createRoute({ method: "get", path: "/users/{id}", responses: {} });',
      ""
    ].join("\n"),
    "src/index.ts": [
      'import { OpenAPIHono, createRoute } from "@hono/zod-openapi";',
      'import { getUser } from "./routes";',
      "",
      "const app = new OpenAPIHono();",
      "app.openapi(getUser, (c) => c.json({}));",
      'app.openapi(createRoute({ method: "post", path: "/users", responses: {} }), (c) => c.json({}));',
      "export default app;",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /users [POST] src/index.ts",
      "api /users/:id [GET] src/index.ts"
    ]);
  });
});

test("an unrelated object with get()/post() methods is not a Hono route", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0" } }),
    "src/index.ts": [
      'import { Hono } from "hono";',
      'import { http } from "./http";',
      "const app = new Hono();",
      'app.get("/ping", (c) => c.text(String(http.get("/remote"))));',
      "export default app;",
      ""
    ].join("\n"),
    "src/http.ts": 'export const http = { get: (path: string) => path, post: (path: string) => path };\n'
  }, async (root) => {
    assert.deepEqual(await routeTable(root), ["api /ping [GET] src/index.ts"]);
  });
});

// ------------------------------------------------------------------ monorepos

test("a monorepo lists the routes of every frontend, not only the framework that won", async () => {
  await withProject({
    "package.json": pkg({ name: "mono", private: true, workspaces: ["apps/*"] }),
    "apps/web/package.json": pkg({ name: "web", dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "apps/web/src/app/page.tsx": page,
    "apps/mobile/package.json": pkg({ name: "mobile", dependencies: { expo: "52.0.0", "expo-router": "4.0.0", react: "18.0.0" } }),
    "apps/mobile/src/app/index.tsx": page,
    "apps/mobile/src/app/settings.tsx": page,
    "apps/start/package.json": pkg({ name: "start", dependencies: { "@tanstack/react-start": "1.0.0", react: "19.0.0" } }),
    "apps/start/src/routes/about.tsx": "export const Route = createFileRoute('/about')({ component: () => null });\n",
    "apps/admin/package.json": pkg({ name: "admin", dependencies: { "@remix-run/react": "2.0.0", react: "18.0.0" } }),
    "apps/admin/app/routes/users.tsx": page,
    "apps/other/package.json": pkg({ name: "other", dependencies: { react: "18.0.0" } }),
    "apps/other/app/routes/not-remix.tsx": page
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / apps/mobile/src/app/index.tsx",
      "page / apps/web/src/app/page.tsx",
      "page /about apps/start/src/routes/about.tsx",
      "page /settings apps/mobile/src/app/settings.tsx",
      "page /users apps/admin/app/routes/users.tsx"
    ]);
  });
});

// ------------------------------------------------------------ bundler aliases

async function graphOf(root: string) {
  const files = await scanFiles(root);
  const analyses = await analyzeFiles(files);
  const mappings = await loadAliasMappings(root);
  return buildDependencyGraph(files, analyses, mappings);
}

test("alias values are folded from the path helpers configs actually use", () => {
  const entries = readAliasEntries("vite.config.ts", [
    'import path from "node:path";',
    'import { dirname, resolve } from "node:path";',
    'import { fileURLToPath, URL } from "node:url";',
    "const here = dirname(fileURLToPath(import.meta.url));",
    "export default defineConfig({",
    "  resolve: {",
    "    alias: {",
    '      "@": path.resolve(__dirname, "src"),',
    '      "~assets": fileURLToPath(new URL("./src/assets", import.meta.url)),',
    '      "@lib": resolve(here, "src", "lib"),',
    '      "@shared": `${__dirname}/../shared`,',
    '      "@root": __dirname + "/app",',
    '      "@abs": "/src/abs",',
    '      "@env": process.env.ALIAS_TARGET,',
    "    }",
    "  }",
    "});"
  ].join("\n"));

  assert.deepEqual(entries, [
    { find: "@", target: "src" },
    { find: "~assets", target: "src/assets" },
    { find: "@lib", target: "src/lib" },
    { find: "@shared", target: "../shared" },
    { find: "@root", target: "app" },
    { find: "@abs", target: "src/abs" }
  ]);
});

test("Vite aliases (object and array forms) become graph edges", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { react: "19.0.0", "react-dom": "19.0.0", vite: "6.0.0" } }),
    "vite.config.ts": [
      'import { resolve } from "node:path";',
      "export default {",
      "  resolve: {",
      "    alias: [",
      '      { find: "@", replacement: resolve(__dirname, "src") },',
      '      { find: /^~\\//, replacement: "/src/" }',
      "    ]",
      "  }",
      "};",
      ""
    ].join("\n"),
    "src/main.tsx": 'import { db } from "@/lib/db";\nimport { util } from "~/util";\nimport "@";\nexport default [db, util];\n',
    "src/lib/db.ts": "export const db = 1;\n",
    "src/util.ts": "export const util = 1;\n",
    "src/index.ts": "export {};\n"
  }, async (root) => {
    const { graph, diagnostics } = await graphOf(root);
    assert.deepEqual(
      graph["src/main.tsx"].sort(),
      ["src/index.ts", "src/lib/db.ts", "src/util.ts"]
    );
    assert.deepEqual(diagnostics.unresolvedAliases, []);
  });
});

test("SvelteKit kit.alias, with and without a wildcard", async () => {
  await withProject({
    "package.json": pkg({ name: "kit", devDependencies: { "@sveltejs/kit": "2.0.0" } }),
    "svelte.config.js": [
      "export default {",
      "  kit: { alias: { $components: 'src/components', '$utils/*': 'src/utils/*' } }",
      "};",
      ""
    ].join("\n"),
    "src/routes/+page.ts": 'import Card from "$components/Card";\nimport { fmt } from "$utils/format";\nimport { lib } from "$lib/lib";\nexport default [Card, fmt, lib];\n',
    "src/components/Card.ts": "export default 1;\n",
    "src/utils/format.ts": "export const fmt = 1;\n",
    "src/lib/lib.ts": "export const lib = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(
      graph["src/routes/+page.ts"].sort(),
      ["src/components/Card.ts", "src/lib/lib.ts", "src/utils/format.ts"]
    );
  });
});

test("webpack resolve.alias, including assignments inside a next.config webpack hook", async () => {
  await withProject({
    "package.json": pkg({ name: "w", dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "next.config.js": [
      'const path = require("path");',
      "module.exports = {",
      "  webpack(config) {",
      '    config.resolve.alias["@ui"] = path.join(__dirname, "components", "ui");',
      "    return config;",
      "  }",
      "};",
      ""
    ].join("\n"),
    "webpack.config.js": [
      'const path = require("path");',
      "module.exports = { resolve: { alias: { Utils: path.resolve(__dirname, 'src/utils/') } } };",
      ""
    ].join("\n"),
    "src/entry.ts": 'import { helper } from "Utils/helper";\nimport { Button } from "@ui/button";\nexport default [helper, Button];\n',
    "src/utils/helper.ts": "export const helper = 1;\n",
    "components/ui/button.ts": "export const Button = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/entry.ts"].sort(), ["components/ui/button.ts", "src/utils/helper.ts"]);
  });
});

test("Astro reads the alias nested under its vite option", async () => {
  await withProject({
    "package.json": pkg({ name: "site", dependencies: { astro: "5.0.0" } }),
    "astro.config.mjs": 'export default { vite: { resolve: { alias: { "@": "/src" } } } };\n',
    "src/pages/index.astro": '---\nimport { x } from "@/data/x";\n---\n<p>{x}</p>\n',
    "src/data/x.ts": "export const x = 1;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["src/pages/index.astro"], ["src/data/x.ts"]);
  });
});

test("a bundler alias only applies below the config that declares it", async () => {
  await withProject({
    "package.json": pkg({ name: "mono", private: true, workspaces: ["apps/*"] }),
    "apps/web/package.json": pkg({ name: "web", dependencies: { vite: "6.0.0" } }),
    "apps/web/vite.config.ts": 'export default { resolve: { alias: { "@": "./src" } } };\n',
    "apps/web/src/main.ts": 'import { a } from "@/a";\nexport default a;\n',
    "apps/web/src/a.ts": "export const a = 1;\n",
    "apps/admin/package.json": pkg({ name: "admin" }),
    "apps/admin/src/main.ts": 'import { a } from "@/a";\nexport default a;\n',
    "apps/admin/src/a.ts": "export const a = 2;\n"
  }, async (root) => {
    const { graph } = await graphOf(root);
    assert.deepEqual(graph["apps/web/src/main.ts"], ["apps/web/src/a.ts"]);
    assert.ok(!graph["apps/admin/src/main.ts"].includes("apps/web/src/a.ts"));
  });
});

test("tsconfig paths still win, and an unresolvable bundler alias is not reported", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { vite: "6.0.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    "vite.config.ts": 'export default { resolve: { alias: { "@": "./elsewhere", "virtual": "./nope" } } };\n',
    "src/main.ts": 'import { a } from "@/a";\nimport v from "virtual";\nexport default [a, v];\n',
    "src/a.ts": "export const a = 1;\n"
  }, async (root) => {
    const { graph, diagnostics } = await graphOf(root);
    assert.deepEqual(graph["src/main.ts"], ["src/a.ts"]);
    assert.ok(!diagnostics.unresolvedAliases.some((item) => item.specifier === "virtual"));
  });
});
