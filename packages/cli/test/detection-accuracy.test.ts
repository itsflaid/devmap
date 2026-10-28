import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { detectCapabilities } from "../src/analyzers/detectors/capabilityDetector.js";
import { isDynamicSegment } from "../src/analyzers/detectors/nonResourceSegments.js";
import { RouteFallbackExtractor } from "../src/analyzers/analysis/extractors/fallbackExtractor.js";
import { SQLExtractor } from "../src/analyzers/analysis/extractors/sqlExtractor.js";
import type { ScannedFile } from "../src/analyzers/analysis/index.js";

// Regression tests for detection errors found by running the analyzer on real
// projects (fastify/demo, the SvelteKit RealWorld app, an Express RealWorld app).

async function withProject(
  files: Record<string, string>,
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-accuracy-"));
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
    .map((route) => `${route.kind} ${route.path}${route.methods ? ` [${route.methods.join(",")}]` : ""}`)
    .sort();
}

// ------------------------------------------------------- dynamic URL segments

test("isDynamicSegment: recognizes every framework's parameter syntax", () => {
  for (const segment of ["[id]", "[...slug]", ":id", "*", "*path", "{id}"]) {
    assert.equal(isDynamicSegment(segment), true, segment);
  }
  for (const segment of ["tasks", "user-stats", "@[user]", "id"]) {
    assert.equal(isDynamicSegment(segment), false, segment);
  }
});

test("capabilities: a `:id` route parameter is never a resource", () => {
  const entityGraph = { entities: [], relations: [], entityNames: [], source: "route-hint" as const };
  const capabilities = detectCapabilities(
    [
      { path: "/:id", file: "routes/tasks.ts", kind: "api", methods: ["GET", "PATCH", "DELETE"] },
      { path: "/:id/assign", file: "routes/tasks.ts", kind: "api", methods: ["POST"] },
      { path: "/tasks/:id", file: "routes/tasks.ts", kind: "api", methods: ["GET", "PATCH", "DELETE"] },
      { path: "/tasks", file: "routes/tasks.ts", kind: "api", methods: ["GET", "POST"] }
    ],
    entityGraph
  );
  const names = capabilities.map((capability) => capability.name);
  assert.deepEqual(names.filter((name) => name.startsWith(":")), []);
  assert.ok(names.includes("Task Management"), names.join(", "));
});

test("route-hint entities: `:id` and `{id}` segments are skipped like `[id]`", () => {
  const entities = new RouteFallbackExtractor().extract([
    { path: "/api/tasks/:id/comments", file: "a.ts", kind: "api", methods: ["POST"] },
    { path: "/api/orders/{orderId}", file: "b.ts", kind: "api", methods: ["PUT"] }
  ]);
  const names = entities.map((entity) => entity.name).sort();
  assert.ok(names.includes("Task"), names.join(", "));
  assert.ok(names.includes("Order"), names.join(", "));
  assert.ok(!names.some((name) => /^[:{]/.test(name)), names.join(", "));
});

// ----------------------------------------------------------- SQL entity names

test("SQL entities: snake_case tables are named like models", () => {
  const file: ScannedFile = {
    path: "src/db.ts",
    extension: ".ts",
    content: [
      'import pg from "pg";',
      'await pool.query("SELECT * FROM user_roles JOIN users ON users.id = user_roles.user_id");',
      'await pool.query("INSERT INTO order_items (id) VALUES ($1)");'
    ].join("\n"),
    size: 0,
    hash: "x"
  } as ScannedFile;
  const names = new SQLExtractor().extract([file]).map((entity) => entity.name).sort();
  assert.deepEqual(names, ["OrderItem", "User", "UserRole"]);
});

// -------------------------------------------------------- SvelteKit `@` folder

test("SvelteKit: a literal `@` folder is part of the URL, not a parallel slot", async () => {
  await withProject({
    "package.json": pkg({ name: "kit", devDependencies: { "@sveltejs/kit": "2.0.0", svelte: "5.0.0" } }),
    "svelte.config.js": "export default {};\n",
    "src/routes/+page.svelte": "<h1>Home</h1>\n",
    "src/routes/profile/+page.svelte": "<h1>Me</h1>\n",
    "src/routes/profile/@[user]/+page.svelte": "<h1>User</h1>\n",
    "src/routes/profile/@[user]/favorites/+page.svelte": "<h1>Favorites</h1>\n"
  }, async (root) => {
    const table = await routeTable(root);
    assert.ok(table.includes("page /profile/@[user]"), table.join("\n"));
    assert.ok(table.includes("page /profile/@[user]/favorites"), table.join("\n"));
    assert.equal(table.filter((line) => line === "page /profile").length, 1, table.join("\n"));
  });
});

test("Next: an `@slot` folder is still not a URL segment", async () => {
  await withProject({
    "package.json": pkg({ name: "next", dependencies: { next: "15.0.0", react: "19.0.0" } }),
    "app/page.tsx": "export default function Page() { return null; }\n",
    "app/dashboard/page.tsx": "export default function Page() { return null; }\n",
    "app/dashboard/@team/settings/page.tsx": "export default function Page() { return null; }\n"
  }, async (root) => {
    const table = await routeTable(root);
    assert.ok(table.includes("page /dashboard/settings"), table.join("\n"));
    assert.ok(!table.some((line) => line.includes("@team")), table.join("\n"));
  });
});

// ------------------------------------------------------------ Fastify autoload

const AUTOLOAD_APP = [
  'import path from "node:path";',
  'import fastifyAutoload from "@fastify/autoload";',
  "export default async function app(fastify, opts) {",
  '  fastify.register(fastifyAutoload, { dir: path.join(import.meta.dirname, "routes"), autoHooks: true, options: { ...opts } });',
  "}",
  ""
].join("\n");

test("Fastify autoload: the folder path under the routes dir prefixes every route", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { fastify: "5.0.0", "@fastify/autoload": "6.0.0" } }),
    "src/app.ts": AUTOLOAD_APP,
    "src/routes/home.ts": 'export default async (fastify) => { fastify.get("/", async () => "ok"); };\n',
    "src/routes/api/tasks/index.ts": [
      "export default async (fastify) => {",
      '  fastify.get("/", async () => []);',
      '  fastify.post("/", async () => ({}));',
      '  fastify.get("/:id", async () => ({}));',
      "};",
      ""
    ].join("\n"),
    "src/routes/api/auth/index.ts": 'export default async (fastify) => { fastify.post("/login", async () => ({})); };\n',
    "src/routes/api/autohooks.ts": 'export default async (fastify) => { fastify.addHook("onRequest", async () => {}); };\n'
  }, async (root) => {
    const table = await routeTable(root);
    assert.deepEqual(table, [
      "api / [GET]",
      "api /api/auth/login [POST]",
      "api /api/tasks [GET,POST]",
      "api /api/tasks/:id [GET]"
    ].sort());

    const map = await createProjectMap(root);
    const names = map.features.map((feature) => feature.name);
    assert.ok(names.includes("Task Management"), names.join(", "));
    assert.ok(!names.some((name) => name.startsWith(":")), names.join(", "));
  });
});

test("Fastify autoload: registration prefix, routeParams and dirNameRoutePrefix are honored", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { fastify: "5.0.0", "@fastify/autoload": "6.0.0" } }),
    "src/app.ts": [
      'import { join } from "node:path";',
      'import AutoLoad from "@fastify/autoload";',
      "export default async function app(fastify) {",
      '  fastify.register(AutoLoad, { dir: join(__dirname, "routes"), routeParams: true, options: { prefix: "/v1" } });',
      '  fastify.register(AutoLoad, { dir: join(__dirname, "flat"), dirNameRoutePrefix: false });',
      "}",
      ""
    ].join("\n"),
    "src/routes/users/_id/index.ts": 'export default async (fastify) => { fastify.get("/", async () => ({})); };\n',
    "src/flat/misc/index.ts": 'export default async (fastify) => { fastify.get("/ping-pong", async () => "ok"); };\n'
  }, async (root) => {
    const table = await routeTable(root);
    assert.ok(table.includes("api /v1/users/:id [GET]"), table.join("\n"));
    assert.ok(table.includes("api /ping-pong [GET]"), table.join("\n"));
  });
});

test("Fastify without autoload: routes keep their literal paths", async () => {
  await withProject({
    "package.json": pkg({ name: "api", dependencies: { fastify: "5.0.0" } }),
    "src/routes/users.ts": 'export default async (fastify) => { fastify.get("/users", async () => []); };\n'
  }, async (root) => {
    assert.deepEqual(await routeTable(root), ["api /users [GET]"]);
  });
});

// -------------------------------------------------- one-letter URL segments

test("a one-letter page segment (`/s/[subdomain]`) does not crash feature detection", async () => {
  await withProject({
    "package.json": pkg({ name: "multi-tenant", dependencies: { next: "15.0.0", react: "19.0.0" } }),
    "app/page.tsx": "export default function Page() { return null; }\n",
    "app/s/[subdomain]/page.tsx": "export default function Page() { return null; }\n"
  }, async (root) => {
    const map = await createProjectMap(root);
    assert.ok(map.routes.some((route) => route.path === "/s/[subdomain]"));
    assert.ok(map.features.some((feature) => feature.name === "S"), map.features.map((feature) => feature.name).join(", "));
  });
});

test("route-hint entities: a one-letter API segment is kept, not emptied", () => {
  const entities = new RouteFallbackExtractor().extract([
    { path: "/api/s/tasks", file: "a.ts", kind: "api", methods: ["POST"] }
  ]);
  assert.ok(entities.every((entity) => entity.name.length > 0), JSON.stringify(entities));
});
