import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult
} from "../src/ai/types.js";
import { inspectSnapshot } from "../src/cache/snapshot.js";
import { analyzeCommand } from "../src/commands/analyze.js";

test("analyze stores and reuses AI architecture interpretation", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-analyze-ai-"));
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content: "This project exposes a small TypeScript entry point.",
        model: request.model,
        usage: {
          promptTokens: 80,
          completionTokens: 15,
          totalTokens: 95
        }
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "analyze-ai-fixture" }),
      "utf8"
    );
    await writeFile(
      join(projectRoot, "index.ts"),
      "export function start() { return true; }\n",
      "utf8"
    );

    const firstLogs = await captureOutput(() => analyzeCommand(
      projectRoot,
      {},
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    assert.equal(requests.length, 1);
    assert.match(firstLogs, /Cached: no/);

    const saved = await inspectSnapshot(projectRoot);
    assert.equal(saved.status, "valid");
    if (saved.status === "valid") {
      assert.equal(
        saved.snapshot.ai?.architecture,
        "This project exposes a small TypeScript entry point."
      );
      assert.equal(saved.snapshot.ai?.usage?.totalTokens, 95);
    }

    const secondLogs = await captureOutput(() => analyzeCommand(
      projectRoot,
      {},
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    assert.equal(requests.length, 1);
    assert.match(secondLogs, /Reused existing snapshot/);
    assert.match(secondLogs, /Cached: yes/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("analyze warns and continues when package.json is malformed", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-malformed-package-"));

  try {
    await writeFile(join(projectRoot, "package.json"), "{broken", "utf8");
    await writeFile(
      join(projectRoot, "server.ts"),
      "import express from \"express\";\nexport const app = express();\n",
      "utf8"
    );

    const logs = stripAnsi(await captureOutput(() => analyzeCommand(
      projectRoot,
      {},
      { loadConfig: async () => null }
    )));

    assert.match(logs, /Framework\s+express/);
    assert.match(logs, /WARN package\.json could not be parsed/);
    assert.match(logs, /Fix package\.json and run devmap analyze --fresh/);
    assert.match(logs, /Snapshot saved/);

    const saved = await inspectSnapshot(projectRoot);
    assert.equal(saved.status, "valid");
    if (saved.status === "valid") {
      assert.deepEqual(saved.snapshot.warnings, [
        "package.json could not be parsed. Dependency-based detection may be incomplete."
      ]);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function captureOutput(action: () => Promise<void>): Promise<string> {
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
