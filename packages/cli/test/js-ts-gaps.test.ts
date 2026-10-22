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
  const root = await mkdtemp(join(tmpdir(), "devmap-gap-"));
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

const comp = (name: string) => `export default function ${name}() { return null; }\n`;

// ------------------------------------------------------------ client routers

test("React Router JSX: nesting, index, layout, relative paths, wrappers and lazy pages", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "7.0.0", vite: "6.0.0" } }),
    "src/App.tsx": [
      'import { lazy, Suspense } from "react";',
      'import { Route, Routes } from "react-router-dom";',
      'import Home from "./pages/Home";',
      'import Layout from "./pages/Layout";',
      'import TeamHome from "./pages/TeamHome";',
      'import Settings from "./pages/Settings";',
      'import Login from "./pages/Login";',
      'import NotFound from "./pages/NotFound";',
      'import { PrivateRoute } from "./PrivateRoute";',
      'import Dashboard from "./pages/Dashboard";',
      'const Reports = lazy(() => import("./pages/Reports"));',
      "",
      "export default function App() {",
      "  return (",
      "    <Routes>",
      '      <Route path="/" element={<Home />} />',
      '      <Route path="/login" element={<Login />} />',
      '      <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />',
      '      <Route path="/reports" element={<Suspense fallback={null}><Reports /></Suspense>} />',
      '      <Route path="teams/:teamId" element={<Layout />}>',
      "        <Route index element={<TeamHome />} />",
      '        <Route path="settings" element={<Settings />} />',
      "      </Route>",
      '      <Route path="*" element={<NotFound />} />',
      "    </Routes>",
      "  );",
      "}",
      ""
    ].join("\n"),
    "src/pages/Home.tsx": comp("Home"),
    "src/pages/Login.tsx": comp("Login"),
    "src/pages/Dashboard.tsx": comp("Dashboard"),
    "src/pages/Reports.tsx": comp("Reports"),
    "src/pages/Layout.tsx": comp("Layout"),
    "src/pages/TeamHome.tsx": comp("TeamHome"),
    "src/pages/Settings.tsx": comp("Settings"),
    "src/pages/NotFound.tsx": comp("NotFound"),
    "src/PrivateRoute.tsx": "export const PrivateRoute = ({ children }: any) => children;\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/pages/Home.tsx",
      "page /dashboard src/pages/Dashboard.tsx",
      "page /login src/pages/Login.tsx",
      "page /reports src/pages/Reports.tsx",
      "page /teams/:teamId src/pages/TeamHome.tsx",
      "page /teams/:teamId/settings src/pages/Settings.tsx"
    ]);
  });
});

test("React Router data routers: createBrowserRouter objects with children and lazy", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "7.0.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    "src/router.tsx": [
      'import { createBrowserRouter } from "react-router-dom";',
      'import Root from "@/routes/Root";',
      'import Index from "@/routes/Index";',
      'import Contact from "@/routes/Contact";',
      "",
      "export const router = createBrowserRouter([",
      "  {",
      '    path: "/",',
      "    element: <Root />,",
      "    children: [",
      "      { index: true, element: <Index /> },",
      '      { path: "contacts/:contactId", element: <Contact /> },',
      '      { path: "about", lazy: () => import("@/routes/About") },',
      '      { path: "legacy", Component: Contact },',
      "    ],",
      "  },",
      "]);",
      ""
    ].join("\n"),
    "src/routes/Root.tsx": comp("Root"),
    "src/routes/Index.tsx": comp("Index"),
    "src/routes/Contact.tsx": comp("Contact"),
    "src/routes/About.tsx": "export const Component = () => null;\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/routes/Index.tsx",
      "page /about src/routes/About.tsx",
      "page /contacts/:contactId src/routes/Contact.tsx",
      "page /legacy src/routes/Contact.tsx"
    ]);
  });
});

test("a route table kept in its own file is still read", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "7.0.0" } }),
    "src/routes.tsx": [
      'import type { RouteObject } from "react-router-dom";',
      'import Home from "./Home";',
      'export const routes: RouteObject[] = [{ path: "/", element: <Home /> }, { path: "/help", element: <Home /> }];',
      ""
    ].join("\n"),
    "src/Home.tsx": comp("Home")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), ["page / src/Home.tsx", "page /help src/Home.tsx"]);
  });
});

test("Vue Router: lazy imports, nested children, named views; redirects are not pages", async () => {
  await withProject({
    "package.json": pkg({ name: "vue-app", dependencies: { vue: "3.5.0", "vue-router": "4.5.0" }, devDependencies: { "@vitejs/plugin-vue": "5.0.0" } }),
    "src/router/index.ts": [
      'import { createRouter, createWebHistory } from "vue-router";',
      'import HomeView from "../views/HomeView.vue";',
      "",
      "export default createRouter({",
      "  history: createWebHistory(),",
      "  routes: [",
      '    { path: "/", name: "home", component: HomeView },',
      '    { path: "/old", redirect: "/" },',
      '    { path: "/about", component: () => import("../views/AboutView.vue") },',
      "    {",
      '      path: "/admin",',
      '      component: () => import("../views/AdminLayout.vue"),',
      "      children: [",
      '        { path: "", component: () => import("../views/AdminHome.vue") },',
      '        { path: "users/:id", component: () => import("../views/AdminUser.vue") },',
      "      ],",
      "    },",
      "  ],",
      "});",
      ""
    ].join("\n"),
    "src/views/HomeView.vue": "<template><p>home</p></template>\n",
    "src/views/AboutView.vue": "<template><p>about</p></template>\n",
    "src/views/AdminLayout.vue": "<template><router-view /></template>\n",
    "src/views/AdminHome.vue": "<template><p>admin</p></template>\n",
    "src/views/AdminUser.vue": "<template><p>user</p></template>\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/views/HomeView.vue",
      "page /about src/views/AboutView.vue",
      "page /admin src/views/AdminHome.vue",
      "page /admin/users/:id src/views/AdminUser.vue"
    ]);
  });
});

test("TanStack Router code-based routes compose through getParentRoute", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { "@tanstack/react-router": "1.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "src/router.tsx": [
      'import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";',
      'import Home from "./Home";',
      'import Posts from "./Posts";',
      'import Post from "./Post";',
      "",
      "const rootRoute = createRootRoute({ component: () => null });",
      'const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });',
      'const postsRoute = createRoute({ getParentRoute: () => rootRoute, path: "posts", component: Posts });',
      'const postRoute = createRoute({ getParentRoute: () => postsRoute, path: "$postId", component: Post });',
      'const layoutRoute = createRoute({ getParentRoute: () => rootRoute, id: "layout", component: Home });',
      "const routeTree = rootRoute.addChildren([indexRoute, postsRoute.addChildren([postRoute]), layoutRoute]);",
      "export const router = createRouter({ routeTree });",
      ""
    ].join("\n"),
    "src/Home.tsx": comp("Home"),
    "src/Posts.tsx": comp("Posts"),
    "src/Post.tsx": comp("Post")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/Home.tsx",
      "page /posts src/Posts.tsx",
      "page /posts/$postId src/Post.tsx"
    ]);
  });
});

test("svelte-spa-router path maps", async () => {
  await withProject({
    "package.json": pkg({ name: "svelte-app", dependencies: { svelte: "5.0.0", "svelte-spa-router": "4.0.0" }, devDependencies: { "@sveltejs/vite-plugin-svelte": "5.0.0" } }),
    "src/routes.ts": [
      'import Home from "./Home.svelte";',
      'import About from "./About.svelte";',
      'import Router from "svelte-spa-router";',
      'export default { "/": Home, "/about": About, "/user/:id": About };',
      "void Router;",
      ""
    ].join("\n"),
    "src/Home.svelte": "<p>home</p>\n",
    "src/About.svelte": "<p>about</p>\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/Home.svelte",
      "page /about src/About.svelte",
      "page /user/:id src/About.svelte"
    ]);
  });
});

test("a nav-menu array with path and name is not a route table", async () => {
  await withProject({
    "package.json": pkg({ name: "spa", dependencies: { react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "7.0.0" } }),
    "src/nav.ts": 'import { Link } from "react-router-dom";\nexport const items = [{ path: "/a", name: "A" }, { path: "/b", name: "B" }];\nexport { Link };\n'
  }, async (root) => {
    assert.deepEqual(await routeTable(root), []);
  });
});

// ------------------------------------------------------------------- Next.js

test("Next routes: private folders, intercepting routes, slots and metadata files", async () => {
  await withProject({
    "package.json": pkg({ name: "web", dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "src/app/layout.tsx": comp("Layout"),
    "src/app/page.tsx": comp("Home"),
    "src/app/(shop)/cart/page.tsx": comp("Cart"),
    "src/app/photos/[id]/page.tsx": comp("Photo"),
    "src/app/@modal/(.)photos/[id]/page.tsx": comp("PhotoModal"),
    "src/app/feed/(..)photos/[id]/page.tsx": comp("FeedPhoto"),
    "src/app/_components/page.tsx": comp("NotARoute"),
    "src/app/dashboard/page.tsx": comp("Dashboard"),
    "src/app/dashboard/@team/page.tsx": comp("Team"),
    "src/app/settings/@panel/page.tsx": comp("Panel"),
    "src/app/docs/[[...slug]]/page.tsx": comp("Docs"),
    "src/app/sitemap.ts": "export default function sitemap() { return []; }\n",
    "src/app/robots.ts": "export default function robots() { return {}; }\n",
    "src/app/lib/robots.ts": "export const x = 1;\n",
    "src/app/api/health/route.ts": "export function GET() { return Response.json({}); }\n"
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /api/health [GET] src/app/api/health/route.ts",
      "api /robots.txt [GET] src/app/robots.ts",
      "api /sitemap.xml [GET] src/app/sitemap.ts",
      "page / src/app/page.tsx",
      "page /cart src/app/(shop)/cart/page.tsx",
      "page /dashboard src/app/dashboard/page.tsx",
      "page /docs/[[...slug]] src/app/docs/[[...slug]]/page.tsx",
      "page /photos/[id] src/app/photos/[id]/page.tsx",
      "page /settings src/app/settings/@panel/page.tsx"
    ]);
  });
});

// ---------------------------------------------------------------------- Hono

test("Hono: a function that returns an app is one app per call", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0" } }),
    "src/factory.ts": [
      'import { Hono } from "hono";',
      "export function createRouter() {",
      "  const router = new Hono();",
      '  router.get("/ping", (c) => c.text("pong"));',
      "  return router;",
      "}",
      "export const createBare = () => new Hono();",
      ""
    ].join("\n"),
    "src/index.ts": [
      'import { Hono } from "hono";',
      'import { createRouter, createBare } from "./factory";',
      "",
      "const app = new Hono();",
      'const users = createBare();',
      'users.get("/", (c) => c.json([]));',
      'const posts = createBare();',
      'posts.get("/latest", (c) => c.json([]));',
      'app.route("/users", users);',
      'app.route("/posts", posts);',
      'app.route("/a", createRouter());',
      'app.route("/b", createRouter());',
      "export default app;",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /a/ping [GET] src/factory.ts",
      "api /b/ping [GET] src/factory.ts",
      "api /posts/latest [GET] src/index.ts",
      "api /users [GET] src/index.ts"
    ]);
  });
});

test("Hono: createFactory().createApp() and functions that register routes on an app they are given", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { hono: "4.0.0" } }),
    "src/routes/auth.ts": [
      'import type { Hono } from "hono";',
      "export function registerAuth(app: Hono) {",
      '  app.post("/login", (c) => c.json({}));',
      '  app.get("/me", (c) => c.json({}));',
      "}",
      "export default function registerHealth(app: Hono) {",
      '  app.get("/health", (c) => c.text("ok"));',
      "}",
      ""
    ].join("\n"),
    "src/app.ts": [
      'import { createFactory } from "hono/factory";',
      'import registerHealth, { registerAuth } from "./routes/auth";',
      "",
      "const factory = createFactory();",
      "const app = factory.createApp();",
      "registerHealth(app);",
      'registerAuth(app.basePath("/auth"));',
      "export default app;",
      ""
    ].join("\n")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "api /auth/login [POST] src/routes/auth.ts",
      "api /auth/me [GET] src/routes/auth.ts",
      "api /health [GET] src/routes/auth.ts"
    ]);
  });
});

// ------------------------------------------------------------------ ranking

test("critical files: orchestrators rank by name or fan-out, not by devmap-specific names", async () => {
  const modules = Array.from({ length: 8 }, (_, i) => `mod${i}`);
  await withProject({
    "package.json": pkg({ name: "tool", bin: { tool: "./dist/index.js" } }),
    "src/index.ts": 'import { main } from "./boot.js"; main();\n',
    "src/boot.ts": [
      ...modules.map((name) => `import { ${name} } from "./lib/${name}.js";`),
      `export function main() { return [${modules.join(", ")}]; }`,
      ""
    ].join("\n"),
    ...Object.fromEntries(modules.map((name) => [`src/lib/${name}.ts`, `export const ${name} = 1;\n`])),
    "src/scheduler.ts": "export function schedule() { return []; }\n",
    "src/notes.ts": "export function notes() { return []; }\n"
  }, async (root) => {
    const map = await createProjectMap(root);
    const byPath = Object.fromEntries(map.criticalFiles.map((file) => [file.path, file]));
    assert.ok(byPath["src/boot.ts"], "a file that pulls together many local modules is critical");
    assert.ok(byPath["src/scheduler.ts"], "a scheduler is critical by name");
    assert.ok(
      !byPath["src/notes.ts"] || byPath["src/notes.ts"].score < byPath["src/scheduler.ts"].score,
      "an unremarkable file ranks below a scheduler"
    );
  });
});

test("data routers: a pathless layout with an index child lists the index, not the layout", async () => {
  await withProject({
    "package.json": pkg({ name: "rsc", dependencies: { react: "19.0.0", "react-router": "7.0.0" } }),
    "src/routes/config.ts": [
      'import type { RouteObject } from "react-router";',
      "export function routes(): RouteObject[] {",
      "  return [{",
      '    path: "",',
      '    lazy: () => import("./root/route"),',
      "    children: [",
      '      { index: true, lazy: () => import("./home/route") },',
      '      { path: "about", lazy: () => import("./about/route") }',
      "    ]",
      "  }];",
      "}",
      ""
    ].join("\n"),
    "src/routes/root/route.tsx": comp("Root"),
    "src/routes/home/route.tsx": comp("Home"),
    "src/routes/about/route.tsx": comp("About")
  }, async (root) => {
    assert.deepEqual(await routeTable(root), [
      "page / src/routes/home/route.tsx",
      "page /about src/routes/about/route.tsx"
    ]);
  });
});
