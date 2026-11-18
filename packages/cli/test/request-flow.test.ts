import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createProjectMap,
  generateFeatureFlows,
  generateRequestFlows,
  renderMermaidFlow
} from "../src/analyzers/pipeline/projectMap.js";
import type { FeatureInfo, FileIndexEntry, RouteInfo } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { runFlow } from "../src/commands/flow.js";
import { declaresOnlyTypes } from "../src/commands/map.js";

async function writeProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devmap-request-flow-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

const packageJson = JSON.stringify({
  name: "mini",
  version: "1.0.0",
  type: "module",
  dependencies: { express: "^4.19.0" }
});

function routerFile(name: string): string {
  return [
    "import { Router } from \"express\";",
    `import { list_${name} } from "../services/${name}.js";`,
    "const router = Router();",
    `router.get("/", (req, res) => res.json(list_${name}()));`,
    "export default router;"
  ].join("\n");
}

const mountedProject = {
  "package.json": packageJson,
  "src/server.ts": [
    "import express from \"express\";",
    "import payments from \"./routes/payments.js\";",
    "import users from \"./routes/users.js\";",
    "import orders from \"./routes/orders.js\";",
    "const app = express();",
    "app.use(\"/payments\", payments);",
    "app.use(\"/users\", users);",
    "app.use(\"/orders\", orders);",
    "app.listen(3000);"
  ].join("\n"),
  "src/routes/payments.ts": routerFile("payments"),
  "src/routes/users.ts": routerFile("users"),
  "src/routes/orders.ts": routerFile("orders"),
  "src/services/payments.ts": "export function list_payments() { return []; }",
  "src/services/users.ts": "export function list_users() { return []; }",
  "src/services/orders.ts": "export function list_orders() { return []; }"
};

test("a mounted route's flow follows its own router and not sibling routers", async () => {
  const root = await writeProject(mountedProject);

  try {
    const projectMap = await createProjectMap(root);
    const flow = projectMap.flows.find((item) => item.name === "Request /payments");

    assert.ok(flow);
    assert.deepEqual(flow.steps.map((step) => step.file), [
      "src/server.ts",
      "src/routes/payments.ts",
      "src/services/payments.ts"
    ]);
    assert.deepEqual(flow.steps.map((step) => step.from), [
      undefined,
      "src/server.ts",
      "src/routes/payments.ts"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("request flow mermaid draws import edges, not a chain in visit order", () => {
  const mermaid = renderMermaidFlow([
    { label: "a", file: "a.ts" },
    { label: "b", file: "b.ts", from: "a.ts" },
    { label: "c", file: "c.ts", from: "a.ts" },
    { label: "d", file: "d.ts", from: "b.ts" }
  ]);

  const edges = mermaid.split("\n").filter((line) => line.includes("-->")).map((line) => line.trim());
  assert.deepEqual(edges, ["S1 --> S2", "S1 --> S3", "S2 --> S4"]);
});

test("steps without parents keep the ordered chain", () => {
  const mermaid = renderMermaidFlow([
    { label: "one" },
    { label: "two" },
    { label: "three" }
  ]);

  const edges = mermaid.split("\n").filter((line) => line.includes("-->")).map((line) => line.trim());
  assert.deepEqual(edges, ["S1 --> S2", "S2 --> S3"]);
});

test("flow <route path> resolves the exact route when longer routes share its prefix", async () => {
  const root = await writeProject({
    "package.json": packageJson,
    "src/server.ts": [
      "import express from \"express\";",
      "const app = express();",
      "app.post(\"/users\", (req, res) => res.json({}));",
      "app.post(\"/users/login\", (req, res) => res.json({}));",
      "app.listen(3000);"
    ].join("\n")
  });

  try {
    await saveSnapshot(root, await createProjectMap(root));
    const options = { projectRoot: root, write: false, narrate: false, all: true };

    const exact = await runFlow("/users", options, { loadConfig: async () => null });
    assert.deepEqual(exact.flows.map((flow) => flow.name), ["Request /users"]);

    const prefixed = await runFlow("Request /users/login", options, { loadConfig: async () => null });
    assert.deepEqual(prefixed.flows.map((flow) => flow.name), ["Request /users/login"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declaresOnlyTypes is true only for files made of interfaces and type aliases", () => {
  const symbol = (kind: "interface" | "type" | "function") => ({ name: "x", kind, line: 1, exported: true });
  const entry = (kinds: Array<"interface" | "type" | "function">) =>
    ({ symbols: kinds.map(symbol) }) as Parameters<typeof declaresOnlyTypes>[0];

  assert.equal(declaresOnlyTypes(entry(["interface", "type"])), true);
  assert.equal(declaresOnlyTypes(entry(["interface", "function"])), false);
  assert.equal(declaresOnlyTypes(entry([])), false);
  assert.equal(declaresOnlyTypes(undefined), false);
});

const indexOf = (...files: string[]): Record<string, FileIndexEntry> =>
  Object.fromEntries(files.map((file) => [file, { topFunctions: [] } as unknown as FileIndexEntry]));

test("one handler serving several methods on a path produces one request flow", () => {
  const routes: RouteInfo[] = [
    { path: "/articles", file: "a.ts", kind: "api", methods: ["GET"] },
    { path: "/articles", file: "a.ts", kind: "api", methods: ["POST"] },
    { path: "/tags", file: "t.ts", kind: "api", methods: ["GET"] }
  ];
  const flows = generateRequestFlows(routes, indexOf("a.ts", "t.ts"), {}, { limit: 2 });

  assert.deepEqual(flows.map((flow) => flow.name), ["Request /articles", "Request /tags"]);
});

test("request flows of one path served by different files get distinct names", () => {
  const routes: RouteInfo[] = [
    { path: "/", file: "root.js", kind: "api", methods: ["GET"] },
    { path: "/", file: "todo.js", kind: "api", methods: ["GET", "POST"] }
  ];
  const flows = generateRequestFlows(routes, indexOf("root.js", "todo.js"), {});

  assert.deepEqual(flows.map((flow) => flow.name), ["Request / (root.js)", "Request / (todo.js)"]);
});

test("feature flow names a dependency outside the feature and draws only real import edges", () => {
  const feature = {
    name: "Article Management",
    purpose: "",
    files: ["a/controller.ts", "a/service.ts", "a/interface.ts"],
    entryPoint: "a/controller.ts",
    entryPoints: ["a/controller.ts"],
    businessFlow: [
      "Start at a/controller.ts.",
      "Follow dependency a/service.ts.",
      "Follow dependency a/dto/index.ts.",
      "Follow dependency a/interface.ts."
    ],
    searchTerms: [],
    confidence: "high",
    evidence: []
  } as unknown as FeatureInfo;
  const graph = {
    "a/controller.ts": ["a/service.ts", "a/dto/index.ts"],
    "a/dto/index.ts": ["a/interface.ts"]
  };

  const [flow] = generateFeatureFlows(
    [feature],
    indexOf("a/controller.ts", "a/service.ts", "a/dto/index.ts", "a/interface.ts"),
    { graph }
  );

  assert.deepEqual(flow.steps.map((step) => step.file), [
    "a/controller.ts",
    "a/service.ts",
    "a/dto/index.ts",
    "a/interface.ts"
  ]);
  const edges = flow.mermaid?.split("\n").filter((line) => line.includes("-->")).map((line) => line.trim());
  assert.deepEqual(edges, ["S1 --> S2", "S1 --> S3", "S3 --> S4"]);
});

test("feature flow over unrelated files draws no edges instead of chaining them", () => {
  const feature = {
    name: "Authentication",
    purpose: "",
    files: ["a.ts", "b.ts", "c.ts", "d.ts"],
    entryPoint: "a.ts",
    entryPoints: ["a.ts"],
    businessFlow: ["Review a.ts.", "Review b.ts.", "Review c.ts.", "Review d.ts."],
    searchTerms: [],
    confidence: "high",
    evidence: []
  } as unknown as FeatureInfo;

  const [flow] = generateFeatureFlows([feature], indexOf("a.ts", "b.ts", "c.ts", "d.ts"), { graph: {} });

  assert.equal(flow.mermaid?.includes("-->"), false);
});

test("fastify-autoload, the package name before the @fastify scope, still supplies the route prefix", async () => {
  const root = await writeProject({
    "package.json": JSON.stringify({
      name: "legacy",
      version: "1.0.0",
      dependencies: { fastify: "^3.0.0", "fastify-autoload": "^3.0.0" }
    }),
    "app.js": [
      "const path = require('path')",
      "const AutoLoad = require('fastify-autoload')",
      "module.exports = function (fastify, opts, next) {",
      "  fastify.register(AutoLoad, {",
      "    dir: path.join(__dirname, 'services'),",
      "    options: Object.assign({ prefix: '/api' }, opts)",
      "  })",
      "  next()",
      "}"
    ].join("\n"),
    "services/auth.js": [
      "module.exports = function (fastify, opts, next) {",
      "  fastify.post('/token', async () => ({}))",
      "  next()",
      "}"
    ].join("\n")
  });

  try {
    const projectMap = await createProjectMap(root);
    assert.deepEqual(projectMap.routes.map((route) => route.path), ["/api/token"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
