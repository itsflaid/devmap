import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult
} from "../src/ai/types.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import type { ExplainDependencies } from "../src/commands/explain.js";
import { createDevmapServer, MAX_TEXT_CHARS } from "../src/mcp/server.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "..");
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");

async function copyFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mcp-explain-"));
  await cp(nextFixture, projectRoot, { recursive: true });
  await saveSnapshot(projectRoot, await createProjectMap(projectRoot));
  return projectRoot;
}

function fakeAi(content = "It validates the session and returns the current user."): {
  dependencies: ExplainDependencies;
  requests: AiCompletionRequest[];
} {
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content,
        model: request.model,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      };
    }
  };
  return {
    requests,
    dependencies: {
      loadConfig: async () => ({ provider: "groq", apiKey: "gsk_fixture", model: "auto" }),
      createAiClient: () => client
    }
  };
}

async function connect(
  projectRoot: string,
  options: { allowAi?: boolean; explainDependencies?: ExplainDependencies } = {}
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = createDevmapServer({ projectRoot, ...options });
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

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; data: any }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: result.isError === true, data: JSON.parse(result.content[0]!.text) };
}

test("devmap_explain does not exist unless the server was started with allowAi", async () => {
  const projectRoot = await copyFixture();
  const { client, close } = await connect(projectRoot, { explainDependencies: fakeAi().dependencies });

  try {
    const { tools } = await client.listTools();
    assert.equal(tools.some((tool) => tool.name === "devmap_explain"), false);
    assert.equal(tools.length, 7);

    // Calling a tool that was never registered must fail loudly, not run anything.
    const attempt = await callTool(client, "devmap_explain", { target: "x" }).catch(() => undefined);
    assert.equal(attempt, undefined, "the response is a plain-text protocol error, not DevMap JSON");
    const raw = (await client.callTool({ name: "devmap_explain", arguments: { target: "x" } })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    assert.equal(raw.isError, true);
    assert.match(raw.content[0]!.text, /Tool devmap_explain not found/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("with allowAi, devmap_explain is listed and honest about the AI provider", async () => {
  const projectRoot = await copyFixture();
  const { client, close } = await connect(projectRoot, {
    allowAi: true,
    explainDependencies: fakeAi().dependencies
  });

  try {
    const { tools } = await client.listTools();
    const explain = tools.find((tool) => tool.name === "devmap_explain");
    assert.ok(explain, "expected devmap_explain");
    assert.equal(explain.annotations?.openWorldHint, true);
    assert.equal(explain.annotations?.destructiveHint, false);
    assert.equal(explain.annotations?.idempotentHint, false);
    assert.match(explain.description ?? "", /AI provider/);
    assert.match(explain.description ?? "", /--allow-ai/);
    assert.equal(tools.length, 8);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_explain answers through the configured AI client without writing anything", async () => {
  const projectRoot = await copyFixture();
  const { dependencies, requests } = fakeAi();
  const { client, close } = await connect(projectRoot, { allowAi: true, explainDependencies: dependencies });
  const printed: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => { printed.push(values.join(" ")); };

  try {
    const snapshotFiles = await readdir(join(projectRoot, ".devmap"));
    const result = await callTool(client, "devmap_explain", { target: "lib/auth.ts" });

    assert.equal(result.isError, false);
    assert.equal(result.data.mode, "file");
    assert.equal(result.data.target, "lib/auth.ts");
    assert.equal(result.data.answer, "It validates the session and returns the current user.");
    assert.equal(result.data.truncated, false);
    assert.ok(result.data.contextFiles.includes("lib/auth.ts"));
    assert.equal(typeof result.data.model, "string");
    assert.equal(result.data.snapshot.stale, false);

    assert.equal(requests.length, 1);
    assert.deepEqual(printed, [], "no terminal output may leak into the protocol stream");
    assert.deepEqual(await readdir(join(projectRoot, ".devmap")), snapshotFiles, "explain must not write .devmap/explain");
  } finally {
    console.log = originalLog;
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_explain truncates very long answers and says so", async () => {
  const projectRoot = await copyFixture();
  const { dependencies } = fakeAi("x".repeat(MAX_TEXT_CHARS + 500));
  const { client, close } = await connect(projectRoot, { allowAi: true, explainDependencies: dependencies });

  try {
    const result = await callTool(client, "devmap_explain", { target: "lib/auth.ts" });
    assert.equal(result.data.truncated, true);
    assert.match(result.data.answer, /truncated 500 characters/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_explain returns an actionable error when no AI provider is configured", async () => {
  const projectRoot = await copyFixture();
  const { client, close } = await connect(projectRoot, {
    allowAi: true,
    explainDependencies: { loadConfig: async () => null }
  });

  try {
    const result = await callTool(client, "devmap_explain", { target: "lib/auth.ts" });
    assert.equal(result.isError, true);
    assert.match(result.data.error, /requires an AI provider/);
    assert.match(result.data.hint, /devmap init/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_explain reports unknown targets with the known features, without calling the AI", async () => {
  const projectRoot = await copyFixture();
  const { dependencies, requests } = fakeAi();
  const { client, close } = await connect(projectRoot, { allowAi: true, explainDependencies: dependencies });

  try {
    const result = await callTool(client, "devmap_explain", { target: "definitelyNotAThing" });
    assert.equal(result.isError, true);
    assert.match(result.data.error, /isn't a known file, feature, or function/);
    assert.match(result.data.hint, /Known features/);
    assert.equal(requests.length, 0);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap_explain flags a stale snapshot instead of hiding it", async () => {
  const projectRoot = await copyFixture();
  const { dependencies } = fakeAi();
  const { client, close } = await connect(projectRoot, { allowAi: true, explainDependencies: dependencies });

  try {
    await writeFile(join(projectRoot, "lib", "brand-new.ts"), "export const fresh = 1;\n");
    const result = await callTool(client, "devmap_explain", { target: "lib/auth.ts" });
    assert.equal(result.isError, false);
    assert.equal(result.data.snapshot.stale, true);
    assert.match(result.data.snapshot.note, /devmap_analyze/);
  } finally {
    await close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("registry metadata: mcpName is set, and server.json (when present) matches the package", async () => {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
    mcpName?: string;
  };

  // The MCP Registry verifies ownership through this field; with GitHub login
  // it must start with io.github.<github-username>/.
  assert.match(pkg.mcpName ?? "", /^io\.github\.itsflaid\/[a-z0-9-]+$/);

  const serverJsonPath = join(packageRoot, "..", "..", "server.json");
  const raw = await readFile(serverJsonPath, "utf8").catch(() => null);
  if (raw === null) return; // prepared together with the release

  const serverJson = JSON.parse(raw) as {
    name: string;
    version: string;
    packages: Array<{
      registryType: string;
      identifier: string;
      version: string;
      transport: { type: string };
      packageArguments?: Array<{ type: string; value?: string }>;
    }>;
  };
  assert.equal(serverJson.name, pkg.mcpName);
  assert.equal(serverJson.version, pkg.version);
  const npmPackage = serverJson.packages.find((entry) => entry.registryType === "npm");
  assert.ok(npmPackage, "server.json must describe the npm package");
  assert.equal(npmPackage.identifier, pkg.name);
  assert.equal(npmPackage.version, pkg.version);
  assert.equal(npmPackage.transport.type, "stdio");
  assert.ok(
    npmPackage.packageArguments?.some((argument) => argument.type === "positional" && argument.value === "mcp"),
    "the server is started with `devmap mcp`"
  );
});
