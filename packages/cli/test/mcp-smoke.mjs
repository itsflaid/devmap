// Smoke test for the compiled CLI: starts `devmap mcp` from dist/ as a real stdio
// server, builds the first snapshot through the protocol, and queries it.
//
// Run after `pnpm build:cli`:  node packages/cli/test/mcp-smoke.mjs
// Used by CI and by the publish workflow so a broken MCP server never ships.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(packageRoot, "dist", "index.js");
const TIMEOUT_MS = 90_000;

const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-smoke-"));
const watchdog = setTimeout(() => {
  console.error(`MCP smoke test timed out after ${TIMEOUT_MS / 1000}s`);
  process.exit(1);
}, TIMEOUT_MS);
watchdog.unref();

let client;
try {
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "mcp-smoke-app", version: "1.0.0" })
  );
  await writeFile(join(projectRoot, "src", "index.ts"), 'import { greet } from "./greet";\nconsole.log(greet());\n');
  await writeFile(join(projectRoot, "src", "greet.ts"), 'export const greet = () => "hello";\n');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "mcp", "--root", projectRoot],
    stderr: "pipe"
  });
  const protocolErrors = [];
  transport.onerror = (error) => protocolErrors.push(error);
  client = new Client({ name: "mcp-smoke", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const expected of [
    "devmap_overview",
    "devmap_map",
    "devmap_flow",
    "devmap_routes",
    "devmap_impact",
    "devmap_find",
    "devmap_analyze"
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  assert.ok(!names.includes("devmap_explain"), "devmap_explain must require --allow-ai");

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError === true, data: JSON.parse(result.content[0].text) };
  };

  // No snapshot yet: a structured error that tells the agent what to do.
  const missing = await call("devmap_overview");
  assert.equal(missing.isError, true);
  assert.match(missing.data.hint, /devmap analyze/);

  const analyzed = await call("devmap_analyze");
  assert.equal(analyzed.isError, false);
  assert.equal(analyzed.data.status, "refreshed");
  assert.equal(analyzed.data.mode, "static");

  const overview = await call("devmap_overview");
  assert.equal(overview.isError, false);
  assert.ok(overview.data.stats.totalFiles >= 2);
  assert.equal(overview.data.snapshot.stale, false);

  const impact = await call("devmap_impact", { file: "src/greet.ts", depth: 2 });
  assert.equal(impact.isError, false);
  assert.ok(impact.data.transitive.files.some((entryFile) => entryFile.file === "src/index.ts"));

  assert.deepEqual(protocolErrors, [], "stdout must carry JSON-RPC only");
  console.log(`MCP smoke test passed (${names.length} tools).`);
} finally {
  clearTimeout(watchdog);
  await client?.close().catch(() => undefined);
  await rm(projectRoot, { recursive: true, force: true });
}
