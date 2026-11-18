import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap, renderMermaidFlow } from "../src/analyzers/pipeline/projectMap.js";
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
