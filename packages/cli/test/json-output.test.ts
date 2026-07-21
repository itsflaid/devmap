import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { analyzeCommand } from "../src/commands/analyze.js";
import { configModelCommand } from "../src/commands/config.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { initCommand } from "../src/commands/init.js";
import { onboardingCommand } from "../src/commands/onboarding.js";

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

test("onboarding --json emits guide metadata and markdown", async () => {
  const projectRoot = await createProject("json-onboarding");
  await saveSnapshot(projectRoot, await createProjectMap(projectRoot));

  try {
    const output = await captureStdout(() => onboardingCommand({
      json: true,
      projectRoot
    }));
    const payload = parseSingleJson(output);

    assert.equal(payload.status, "ok");
    assert.equal(payload.language, "en");
    assert.equal(payload.projectName, "json-onboarding");
    assert.equal(typeof payload.whatThisIs, "string");
    assert.equal(payload.snapshot.stale, false);
    assert.ok(Array.isArray(payload.howItWorks));
    assert.ok(Array.isArray(payload.features));
    assert.ok(Array.isArray(payload.startHere));
    assert.match(payload.markdown, /# json-onboarding/);
    assert.match(payload.markdown, /## What this is/);
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
