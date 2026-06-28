import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { doctorCommand } from "../src/commands/doctor.js";

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
    assert.match(logs, /Run devmap init/i);
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
    assert.match(logs, /Run devmap init/);
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
      inspectProvider: async (_apiKey, model, provider) => {
        inspectedProvider = provider;
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
