import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { checkMcpServer } from "../src/mcp/health.js";
import { getLocalConfigPath } from "../src/utils/config.js";

test("doctor reports project, provider, model, and snapshot diagnostics", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-test-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "doctor-fixture", dependencies: { express: "^5.0.0" } }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const app = true;\n", "utf8");
    await saveSnapshot(projectRoot, await createProjectMap(projectRoot));

    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "groq",
        apiKey: "gsk_fixture",
        model: "auto"
      }),
      inspectProvider: async () => ({
        reachable: true,
        modelAvailable: true
      })
    }));

    const packageJson = JSON.parse(await readFile(
      join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
      "utf8"
    )) as { version: string };
    assert.match(logs, new RegExp(`DevMap\\s+${escapeRegExp(packageJson.version)}`));
    assert.match(logs, /Framework\s+express/);
    assert.match(logs, /Provider\s+groq/);
    assert.match(logs, /API key\s+valid/);
    assert.match(logs, /Model\s+openai\/gpt-oss-20b/);
    assert.match(logs, /Snapshot\s+valid/);
    assert.match(logs, /No issues found/);
    assert.doesNotMatch(logs, /gsk_fixture/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports unavailable models without exposing provider errors", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-model-test-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "doctor-model-fixture" }),
      "utf8"
    );

    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "groq",
        apiKey: "gsk_fixture",
        model: "retired-model"
      }),
      inspectProvider: async () => ({
        reachable: true,
        modelAvailable: false
      })
    }));

    assert.match(logs, /Model\s+unavailable: retired-model/);
    assert.match(logs, /devmap config model/i);
    assert.doesNotMatch(logs, /gsk_fixture/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor skips network diagnostics when config is missing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-missing-test-"));
  let providerCalled = false;

  try {
    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => null,
      inspectProvider: async () => {
        providerCalled = true;
        return { reachable: true, modelAvailable: true };
      }
    }));

    assert.equal(providerCalled, false);
    assert.match(logs, /Provider\s+not configured/);
    assert.match(logs, /Snapshot\s+missing/);
    assert.match(logs, /AI is optional and not configured/);
    assert.match(logs, /devmap config key/);
    assert.match(logs, /No issues found/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports the project override source and inspects the local model", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-local-test-"));
  let inspectedModel = "";

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "doctor-local-fixture" }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const app = true;\n", "utf8");
    await saveSnapshot(projectRoot, await createProjectMap(projectRoot));
    await writeFile(
      getLocalConfigPath(projectRoot),
      JSON.stringify({ model: "local-override-model" }),
      "utf8"
    );

    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "groq",
        apiKey: "gsk_fixture",
        model: "auto"
      }),
      inspectProvider: async (_config, model) => {
        inspectedModel = model;
        return { reachable: true, modelAvailable: true };
      }
    }));

    assert.equal(inspectedModel, "local-override-model");
    assert.match(logs, /Model\s+local-override-model \(project override\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor inspects OpenRouter with the configured user model", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-openrouter-test-"));
  let inspectedProvider = "";
  let inspectedModel = "";

  try {
    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "openrouter",
        apiKey: "sk-or-fixture",
        model: "qwen/qwen3-coder"
      }),
      inspectProvider: async (config, model) => {
        inspectedProvider = config.provider;
        inspectedModel = model;
        return { reachable: true, modelAvailable: true };
      }
    }));

    assert.equal(inspectedProvider, "openrouter");
    assert.equal(inspectedModel, "qwen/qwen3-coder");
    assert.match(logs, /Provider\s+openrouter/);
    assert.match(logs, /Model\s+qwen\/qwen3-coder/);
    assert.doesNotMatch(logs, /sk-or-fixture/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor shows feature merge warnings for cross-source single-file merges", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-feature-diagnostics-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "doctor-fixture-diagnostics", dependencies: { express: "^5.0.0" } }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const app = true;\n", "utf8");
    const snapshot = await createProjectMap(projectRoot);
    snapshot.featureDiagnostics = {
      mergeDecisions: [
        {
          candidateIds: ["registry:signal-Auth:auth", "frontend-page:file-page:login"],
          outcome: "merged",
          anchors: [{ type: "file", value: "src/pages/login.tsx" }],
          reason: "Merged by shared file."
        }
      ],
      rejectedCandidateIds: []
    };
    await saveSnapshot(projectRoot, snapshot);

    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "groq",
        apiKey: "gsk_fixture",
        model: "auto"
      }),
      inspectProvider: async () => ({
        reachable: true,
        modelAvailable: true
      })
    }));

    assert.match(logs, /Feature merges \(review disarankan\)/);
    assert.match(logs, /registry:signal-Auth:auth <-> frontend-page:file-page:login via 1 file: src\/pages\/login\.tsx/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor does not show feature merge section when no cross-source merges", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-no-diagnostics-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "doctor-fixture-no-diagnostics", dependencies: { express: "^5.0.0" } }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const app = true;\n", "utf8");
    await saveSnapshot(projectRoot, await createProjectMap(projectRoot));

    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => ({
        provider: "groq",
        apiKey: "gsk_fixture",
        model: "auto"
      }),
      inspectProvider: async () => ({
        reachable: true,
        modelAvailable: true
      })
    }));

    assert.doesNotMatch(logs, /Feature merges \(review disarankan\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function captureOutput(action: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...values: unknown[]) => logs.push(stripAnsi(values.join(" ")));
  console.error = (...values: unknown[]) => logs.push(stripAnsi(values.join(" ")));

  try {
    await action();
    return logs.join("\n");
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("doctor does not treat a missing API key as an issue and reports it as JSON", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-nokey-test-"));

  try {
    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      json: true,
      loadConfig: async () => ({ provider: "groq", model: "auto" }),
      checkMcp: async () => ({ ok: true, tools: 7 })
    }));

    const report = JSON.parse(logs) as { status: string; apiKey: string; issues: string[]; notes: string[] };
    assert.equal(report.status, "ok");
    assert.equal(report.apiKey, "missing");
    assert.deepEqual(report.issues, []);
    assert.ok(report.notes.some((note) => /devmap config key/.test(note)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports the MCP server, registered clients and snapshot age", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-mcp-test-"));

  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "mcp-fixture" }), "utf8");
    await writeFile(join(projectRoot, "server.ts"), "export const app = true;\n", "utf8");
    await writeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { devmap: { command: "npx" } } }),
      "utf8"
    );
    await saveSnapshot(projectRoot, await createProjectMap(projectRoot));

    const fresh = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => null,
      checkMcp: async () => ({ ok: true, tools: 7 })
    }));
    assert.match(fresh, /MCP server\s+ready \(7 tools\)/);
    assert.match(fresh, /MCP clients\s+claude/);
    assert.match(fresh, /Snapshot age\s+up to date/);

    await writeFile(join(projectRoot, "server.ts"), "export const app = false;\n", "utf8");
    const stale = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => null,
      checkMcp: async () => ({ ok: true, tools: 7 })
    }));
    assert.match(stale, /Snapshot age\s+stale/);
    assert.match(stale, /devmap_analyze/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor flags a failing MCP self-check as an issue", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-mcp-fail-test-"));

  try {
    const logs = await captureOutput(() => doctorCommand({
      projectRoot,
      loadConfig: async () => null,
      checkMcp: async () => ({ ok: false, tools: 0, error: "boom" })
    }));

    assert.match(logs, /MCP server\s+failed/);
    assert.match(logs, /failed its self-check: boom/);
    assert.doesNotMatch(logs, /No issues found/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("the real MCP self-check starts the server and lists every tool", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-doctor-mcp-real-test-"));

  try {
    const health = await checkMcpServer(projectRoot);
    assert.equal(health.ok, true, health.error);
    assert.equal(health.tools, 7);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
