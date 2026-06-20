import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_AI_MODELS } from "../src/ai/groq.js";
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
        content: "## Overview\n\nThis project exposes a **TypeScript** entry point.",
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

    assert.equal(requests.length, 2);
    assert.match(requests[0]?.messages[0]?.content ?? "", /compact DevMap snapshot/);
    assert.match(requests[1]?.messages[0]?.content ?? "", /codebase architecture interpreter/);
    assert.match(firstLogs, /Cached: no/);

    const saved = await inspectSnapshot(projectRoot);
    assert.equal(saved.status, "valid");
    if (saved.status === "valid") {
      assert.equal(
        saved.snapshot.ai?.architecture,
        "## Overview\n\nThis project exposes a **TypeScript** entry point."
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

    assert.equal(requests.length, 2);
    assert.match(secondLogs, /Reused existing snapshot/);
    assert.match(secondLogs, /Cached: yes/);
    assert.match(stripAnsi(secondLogs), /Overview\n-+/);
    assert.doesNotMatch(stripAnsi(secondLogs), /\*\*/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("analyze streams new AI interpretation and persists the complete text", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-analyze-stream-"));
  let streamCalls = 0;
  const client: AiClient = {
    async complete(): Promise<AiCompletionResult> {
      throw new Error("complete should not be used for human output");
    },
    async stream(request, onDelta): Promise<AiCompletionResult> {
      streamCalls += 1;
      onDelta("## Overview\n\n");
      onDelta("The project has one entry point.");
      return {
        content: "## Overview\n\nThe project has one entry point.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "analyze-stream-fixture" }),
      "utf8"
    );
    await writeFile(join(projectRoot, "index.ts"), "export const ready = true;\n", "utf8");

    const logs = stripAnsi(await captureOutput(() => analyzeCommand(
      projectRoot,
      { fresh: true },
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    )));

    assert.equal(streamCalls, 1);
    assert.match(logs, /Overview\n-+/);
    assert.match(logs, /The project has one entry point/);

    const saved = await inspectSnapshot(projectRoot);
    assert.equal(saved.status, "valid");
    if (saved.status === "valid") {
      assert.equal(
        saved.snapshot.ai?.architecture,
        "## Overview\n\nThe project has one entry point."
      );
    }
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

test("analyze auto routing uses 20B normally and 120B for deep analysis", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-model-routing-"));
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content: "Architecture result.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "model-routing-fixture" }),
      "utf8"
    );
    await writeFile(join(projectRoot, "index.ts"), "export const ready = true;\n", "utf8");

    const dependencies = {
      loadConfig: async () => ({
        provider: "groq" as const,
        apiKey: "gsk_fixture",
        model: "auto"
      }),
      createAiClient: () => client
    };

    await captureOutput(() => analyzeCommand(
      projectRoot,
      { fresh: true },
      dependencies
    ));
    await captureOutput(() => analyzeCommand(
      projectRoot,
      { deep: true, fresh: true },
      dependencies
    ));

    assert.equal(requests[0]?.model, DEFAULT_AI_MODELS.analyze);
    assert.equal(requests[1]?.model, DEFAULT_AI_MODELS.analyze);
    assert.equal(requests[2]?.model, DEFAULT_AI_MODELS.deepAnalyze);
    assert.equal(requests[3]?.model, DEFAULT_AI_MODELS.deepAnalyze);
    assert.equal(requests[0]?.fallbackModel, DEFAULT_AI_MODELS.fallback);
    assert.equal(requests[2]?.fallbackModel, DEFAULT_AI_MODELS.fallback);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("analyze batches snapshot enrichment and never calls once per file", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-enrichment-batch-"));
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      if (request.messages[0]?.content.includes("compact DevMap snapshot")) {
        const files = JSON.parse(request.messages[1]?.content ?? "[]") as Array<{ path: string }>;
        return {
          content: JSON.stringify(files.map((file) => ({
            path: file.path,
            purpose: `${file.path} purpose.`,
            searchTerms: ["snapshot", "purpose"]
          }))),
          model: request.model
        };
      }

      return {
        content: "Architecture result.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "enrichment-batch" }),
      "utf8"
    );
    await writeFile(
      join(projectRoot, "index.ts"),
      Array.from({ length: 25 }, (_, index) => `import { module${index} } from "./module-${index}.js";`).join("\n"),
      "utf8"
    );
    for (let index = 0; index < 25; index += 1) {
      await writeFile(
        join(projectRoot, `module-${index}.ts`),
        `export function module${index}() { return ${index}; }\n`,
        "utf8"
      );
    }

    await captureOutput(() => analyzeCommand(
      projectRoot,
      { fresh: true },
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    const enrichmentRequests = requests.filter((request) =>
      request.messages[0]?.content.includes("compact DevMap snapshot")
    );
    assert.ok(enrichmentRequests.length > 0);
    assert.ok(enrichmentRequests.length < 25);
    for (const request of enrichmentRequests) {
      const files = JSON.parse(request.messages[1]?.content ?? "[]") as unknown[];
      assert.ok(files.length <= 20);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("analyze continues when snapshot enrichment AI fails", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-enrichment-failure-"));
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      if (request.messages[0]?.content.includes("compact DevMap snapshot")) {
        throw new Error("enrichment unavailable");
      }

      return {
        content: "Architecture result.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "enrichment-failure" }),
      "utf8"
    );
    await writeFile(join(projectRoot, "index.ts"), "export function start() { return true; }\n", "utf8");

    await captureOutput(() => analyzeCommand(
      projectRoot,
      { fresh: true },
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    const saved = await inspectSnapshot(projectRoot);
    assert.equal(saved.status, "valid");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("analyze writes lightweight agent navigation alongside the snapshot", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-navigation-output-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "navigation-output" }),
      "utf8"
    );
    await writeFile(
      join(projectRoot, "index.ts"),
      "export async function start() { return true; }\n",
      "utf8"
    );

    await captureOutput(() => analyzeCommand(
      projectRoot,
      { fresh: true },
      { loadConfig: async () => null }
    ));

    const index = JSON.parse(await readFile(
      join(projectRoot, ".devmap", "index.json"),
      "utf8"
    )) as { snapshot: { path: string }; agentInstructions: string };
    const snapshot = JSON.parse(await readFile(
      join(projectRoot, ".devmap", "snapshot.json"),
      "utf8"
    )) as { fileIndex: Record<string, { analyzer: string }> };

    assert.equal(index.snapshot.path, ".devmap/snapshot.json");
    assert.match(index.agentInstructions, /feature map/);
    assert.equal(snapshot.fileIndex["index.ts"]?.analyzer, "ts-morph");
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
