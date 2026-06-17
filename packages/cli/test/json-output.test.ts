import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AiClient } from "../src/ai/types.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { analyzeCommand } from "../src/commands/analyze.js";
import { askCommand } from "../src/commands/ask.js";
import { configModelCommand } from "../src/commands/config.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { initCommand } from "../src/commands/init.js";

test("analyze --json emits one parseable snapshot document", async () => {
  const projectRoot = await createProject("json-analyze");

  try {
    const output = await captureStdout(() => analyzeCommand(
      projectRoot,
      { fresh: true, json: true },
      { loadConfig: async () => null }
    ));
    const payload = parseSingleJson(output);

    assert.equal(payload.project.name, "json-analyze");
    assert.ok(payload.fileIndex["index.ts"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ask --json emits answer, relevant files, model, and usage", async () => {
  const projectRoot = await createProject("json-ask");
  const snapshot = await createProjectMap(projectRoot);
  await saveSnapshot(projectRoot, snapshot);
  let completeCalls = 0;
  let streamCalls = 0;
  const client: AiClient = {
    async complete(request) {
      completeCalls += 1;
      if (request.messages[0]?.content.includes("Return a JSON array only")) {
        return {
          content: "[\"startup\"]",
          model: request.model
        };
      }

      return {
        content: "The entry point is index.ts.",
        model: request.model,
        usage: {
          promptTokens: 20,
          completionTokens: 8,
          totalTokens: 28
        }
      };
    },
    async stream() {
      streamCalls += 1;
      throw new Error("JSON output must not use streaming");
    }
  };

  try {
    const output = await captureStdout(() => askCommand(
      ["where", "is", "the", "entry", "point"],
      {
        json: true,
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));
    const payload = parseSingleJson(output);

    assert.equal(payload.status, "ok");
    assert.equal(payload.answer, "The entry point is index.ts.");
    assert.equal(payload.model, "llama-3.1-8b-instant");
    assert.equal(payload.usage.totalTokens, 28);
    assert.deepEqual(payload.expandedTerms, []);
    assert.ok(Array.isArray(payload.relevantFiles));
    assert.equal(completeCalls, 1);
    assert.equal(streamCalls, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor and config JSON outputs contain no formatting noise", async () => {
  const projectRoot = await createProject("json-doctor");
  let savedModel = "";

  try {
    const doctorOutput = await captureStdout(() => doctorCommand({
      json: true,
      projectRoot,
      loadConfig: async () => null
    }));
    const configOutput = await captureStdout(() => configModelCommand(
      "openai/gpt-oss-120b",
      {
        json: true,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        persistConfig: async (config) => {
          savedModel = config.model;
        }
      }
    ));

    assert.equal(parseSingleJson(doctorOutput).status, "issues");
    assert.equal(parseSingleJson(configOutput).model, "openai/gpt-oss-120b");
    assert.equal(savedModel, "openai/gpt-oss-120b");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("init --json is non-interactive and returns setup metadata", async () => {
  const projectRoot = await createProject("json-init");

  try {
    const output = await captureStdout(() => initCommand({
      json: true,
      projectRoot,
      environmentApiKey: "gsk_fixture",
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined
    }));
    const payload = parseSingleJson(output);

    assert.equal(payload.status, "ok");
    assert.equal(payload.provider, "groq");
    assert.equal(payload.next, "devmap analyze");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function createProject(name: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-json-output-"));
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name }),
    "utf8"
  );
  await writeFile(
    join(projectRoot, "index.ts"),
    "export function start() { return true; }\n",
    "utf8"
  );
  return projectRoot;
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  console.error = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    await action();
    return logs.join("\n");
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function parseSingleJson(value: string): any {
  assert.doesNotMatch(value, /\x1b\[|─|•/);
  assert.equal(value.trim().split(/\r?\n/).length, 1);
  return JSON.parse(value);
}
