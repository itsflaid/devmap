import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { writeAgentNavigationFiles } from "../src/cache/agentNavigation.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import {
  createDevmapServer,
  MAX_TEXT_CHARS,
  truncateText
} from "../src/mcp/server.js";
import { createSnapshotProvider } from "../src/mcp/snapshotProvider.js";
import {
  clampLimit,
  queryFind,
  queryImpact,
  queryRoutes,
  resolveProjectFile
} from "../src/mcp/queries.js";
import { DevmapError } from "../src/utils/errors.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const hubFixture = join(testDirectory, "fixtures", "hub-fanin");

/**
 * A real project on disk: the fixture is copied to a temp root and analyzed there,
 * so the snapshot fingerprint matches the files (stale === false until they change).
 */
async function projectFromFixture(fixtureRoot: string, withNavigation = false): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-test-"));
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const snapshot = await createProjectMap(projectRoot);
  await saveSnapshot(projectRoot, snapshot);
  if (withNavigation) {
    await writeAgentNavigationFiles(projectRoot, snapshot);
  }
  return projectRoot;
}

async function connect(projectRoot: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = createDevmapServer({ projectRoot });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; data: any }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return {
    isError: result.isError === true,
    data: JSON.parse(result.content[0]!.text)
  };
}

test("server lists the read-only tools with read-only annotations", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "devmap_find",
      "devmap_flow",
      "devmap_impact",
      "devmap_map",
      "devmap_overview",
      "devmap_routes"
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    }
    assert.match(client.getInstructions() ?? "", /devmap_overview/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_overview returns project facts, features, and snapshot freshness", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const { isError, data } = await callTool(client, "devmap_overview");
    assert.equal(isError, false);
    assert.equal(data.project.framework, "nextjs");
    assert.ok(data.features.length > 0);
    assert.ok(data.stats.totalFiles > 0);
    assert.equal(typeof data.snapshot.generatedAt, "string");
    assert.equal(data.snapshot.stale, false);
    assert.ok(Array.isArray(data.nextSteps));
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_map and devmap_flow are silent and never write .devmap artifacts", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const project = await callTool(client, "devmap_map");
    assert.equal(project.isError, false);
    assert.equal(project.data.mode, "project");
    assert.ok(project.data.markdown.length > 0);
    assert.equal(project.data.mermaid, undefined);

    const withMermaid = await callTool(client, "devmap_map", { includeMermaid: true });
    assert.match(withMermaid.data.mermaid, /graph/);

    const flows = await callTool(client, "devmap_flow");
    assert.equal(flows.isError, false);
    assert.ok(flows.data.flows.length > 0);
    assert.ok(flows.data.flows.every((flow: { markdown: string }) => !/How it works/.test(flow.markdown)));

    const one = await callTool(client, "devmap_flow", { target: flows.data.flows[0].name });
    assert.equal(one.data.flows.length, 1);

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(projectRoot, ".devmap"));
    assert.deepEqual(entries.sort(), ["snapshot.json"]);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_routes filters by kind, prefix and method, and reports truncation", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const all = await callTool(client, "devmap_routes");
    assert.ok(all.data.total > 0);

    const api = await callTool(client, "devmap_routes", { kind: "api" });
    assert.ok(api.data.routes.every((route: { kind: string }) => route.kind === "api"));

    const none = await callTool(client, "devmap_routes", { prefix: "/definitely-not-a-route" });
    assert.equal(none.data.total, 0);

    const limited = await callTool(client, "devmap_routes", { limit: 1 });
    assert.equal(limited.data.returned, 1);
    assert.equal(limited.data.truncated, limited.data.total > 1);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_impact reports dependents of a hub file and accepts path suffixes", async () => {
  const projectRoot = await projectFromFixture(hubFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const snapshot = await createProjectMap(hubFixture);
    const [hub] = Object.entries(snapshot.changeImpact)
      .sort((a, b) => b[1].dependents.length - a[1].dependents.length)[0]!;

    const exact = await callTool(client, "devmap_impact", { file: hub });
    assert.equal(exact.isError, false);
    assert.equal(exact.data.file, hub);
    assert.ok(exact.data.dependents.length > 0);

    const suffix = await callTool(client, "devmap_impact", { file: hub.split("/").slice(-1)[0] });
    // A bare basename either resolves uniquely or is reported as ambiguous with options.
    if (!suffix.isError) {
      assert.equal(suffix.data.file, hub);
    } else {
      assert.match(suffix.data.hint, /options/);
    }

    const missing = await callTool(client, "devmap_impact", { file: "src/does-not-exist.ts" });
    assert.equal(missing.isError, true);
    assert.match(missing.data.error, /isn't a file/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_find ranks features, files and routes and rejects empty queries", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const { client, close } = await connect(projectRoot);

  try {
    const found = await callTool(client, "devmap_find", { query: "auth" });
    assert.equal(found.isError, false);
    assert.ok(found.data.hits.length > 0);
    const scores = found.data.hits.map((hit: { score: number }) => hit.score);
    assert.deepEqual([...scores].sort((a, b) => b - a), scores);

    const empty = await callTool(client, "devmap_find", { query: "   " });
    assert.equal(empty.isError, true);
    assert.match(empty.data.hint, /keyword/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("tools return a structured, actionable error when there is no snapshot", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-empty-"));
  const { client, close } = await connect(projectRoot);

  try {
    for (const name of ["devmap_overview", "devmap_map", "devmap_flow", "devmap_routes"]) {
      const { isError, data } = await callTool(client, name);
      assert.equal(isError, true, name);
      assert.match(data.error, /No DevMap snapshot/);
      assert.match(data.hint, /devmap analyze/);
    }
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("results flag a stale snapshot after the project changes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-stale-"));
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "stale-app", version: "1.0.0" }));
  await writeFile(join(projectRoot, "src", "index.ts"), "export const a = 1;\n");
  await saveSnapshot(projectRoot, await createProjectMap(projectRoot));

  const { server } = createDevmapServer({
    projectRoot,
    provider: createSnapshotProvider(projectRoot, { staleTtlMs: 0 })
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const fresh = await callTool(client, "devmap_overview");
    assert.equal(fresh.data.snapshot.stale, false);

    await writeFile(join(projectRoot, "src", "extra.ts"), "export const b = 2;\n");

    const stale = await callTool(client, "devmap_overview");
    assert.equal(stale.data.snapshot.stale, true);
    assert.match(stale.data.snapshot.note, /devmap analyze --fresh/);
  } finally {
    await client.close();
    await server.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resources expose the snapshot, DEVMAP.md, and per-feature maps", async () => {
  const projectRoot = await projectFromFixture(nextFixture, true);
  await writeFile(join(projectRoot, "DEVMAP.md"), "# DEVMAP\nhello\n");
  const { client, close } = await connect(projectRoot);

  try {
    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    assert.ok(uris.includes("devmap://snapshot"));
    assert.ok(uris.includes("devmap://devmap-md"));
    const featureUris = uris.filter((uri) => uri.startsWith("devmap://feature/"));
    assert.ok(featureUris.length > 0, "expected per-feature resources");

    const snapshot = await client.readResource({ uri: "devmap://snapshot" });
    assert.equal(JSON.parse((snapshot.contents[0] as { text: string }).text).project.framework, "nextjs");

    const doc = await client.readResource({ uri: "devmap://devmap-md" });
    assert.match((doc.contents[0] as { text: string }).text, /hello/);

    const feature = await client.readResource({ uri: featureUris[0]! });
    assert.ok(JSON.parse((feature.contents[0] as { text: string }).text));
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("feature resource rejects path traversal ids", async () => {
  const projectRoot = await projectFromFixture(nextFixture, true);
  const { client, close } = await connect(projectRoot);

  try {
    await assert.rejects(() => client.readResource({ uri: "devmap://feature/..%2F..%2Fsnapshot" }));
    await assert.rejects(() => client.readResource({ uri: "devmap://feature/nope" }));
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("snapshot provider re-reads only when snapshot.json changes", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const provider = createSnapshotProvider(projectRoot, { staleTtlMs: 60_000 });

  try {
    const first = await provider.get();
    const second = await provider.get();
    assert.equal(second.snapshot, first.snapshot, "unchanged file should reuse the parsed snapshot");

    const fresh = await createProjectMap(nextFixture);
    await saveSnapshot(projectRoot, { ...fresh, generatedAt: "2099-01-01T00:00:00.000Z" });
    const future = new Date(Date.now() + 5_000);
    await utimes(join(projectRoot, ".devmap", "snapshot.json"), future, future);

    const third = await provider.get();
    assert.equal(third.snapshot.generatedAt, "2099-01-01T00:00:00.000Z");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("query helpers: limits, path resolution, and truncation", async () => {
  assert.equal(clampLimit(undefined, 20), 20);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(10_000), 100);
  assert.equal(clampLimit(Number.NaN, 7), 7);

  const short = truncateText("abc");
  assert.deepEqual(short, { text: "abc", truncated: false });
  const long = truncateText("x".repeat(MAX_TEXT_CHARS + 50));
  assert.equal(long.truncated, true);
  assert.match(long.text, /truncated 50 characters/);

  const snapshot = await createProjectMap(nextFixture);
  assert.throws(() => resolveProjectFile(snapshot, ""), DevmapError);
  assert.equal(queryRoutes(snapshot, { method: "ZZZ" }).total, 0);
  assert.throws(() => queryImpact(snapshot, "nope/missing.ts"), DevmapError);
  assert.ok(queryFind(snapshot, "route", 3).hits.length <= 3);
});

test("devmap mcp over stdio keeps stdout protocol-clean and answers real requests", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(packageRoot, "src", "index.ts"), "mcp", "--root", projectRoot],
    cwd: packageRoot,
    stderr: "pipe"
  });
  const client = new Client({ name: "stdio-test-client", version: "0.0.0" });

  try {
    // StdioClientTransport parses every stdout line as JSON-RPC; any stray log line
    // (spinner, banner, console.log) surfaces as a protocol error and fails here.
    const errors: unknown[] = [];
    transport.onerror = (error) => errors.push(error);

    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 6);

    const overview = await callTool(client, "devmap_overview");
    assert.equal(overview.isError, false);
    assert.equal(overview.data.project.framework, "nextjs");

    const flow = await callTool(client, "devmap_flow");
    assert.equal(flow.isError, false);

    assert.deepEqual(errors, []);
  } finally {
    await client.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
