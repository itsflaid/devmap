import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_AI_MODELS } from "../src/ai/groq.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult
} from "../src/ai/types.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { askCommand } from "../src/commands/ask.js";
import { DevmapError } from "../src/utils/errors.js";

test("ask command uses configured AI client and prints token usage", async () => {
  const projectRoot = await createAskProject();
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content: "## Authentication\n\nAuthentication is handled in **`auth.ts`**.",
        model: request.model,
        usage: {
          promptTokens: 100,
          completionTokens: 12,
          totalTokens: 112
        }
      };
    }
  };

  try {
    const logs = await captureOutput(() => askCommand(
      ["Bagaimana", "autentikasi", "bekerja?"],
      {
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, DEFAULT_AI_MODELS.ask);
    assert.equal(requests[0]?.fallbackModel, DEFAULT_AI_MODELS.fallback);
    assert.match(requests[0]?.messages[1]?.content ?? "", /auth\.ts/);
    const plainLogs = stripAnsi(logs);
    assert.equal(countMatches(plainLogs, /Relevant Files/g), 1);
    assert.equal(countMatches(plainLogs, /Asking Groq/g), 1);
    assert.equal(countMatches(plainLogs, /^Answer$/gm), 1);
    assert.match(plainLogs, /[•*]\s+auth\.ts/);
    assert.doesNotMatch(plainLogs, /path matches|export matches|dependency matches/);
    assert.match(plainLogs, /Authentication\n-+/);
    assert.match(plainLogs, /Authentication is handled in auth\.ts/);
    assert.doesNotMatch(plainLogs, /\*\*|`/);
    assert.match(logs, /Total tokens: 112/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ask command streams AI paragraphs when the client supports streaming", async () => {
  const projectRoot = await createAskProject();
  let completeCalls = 0;
  let streamCalls = 0;
  const client: AiClient = {
    async complete(): Promise<AiCompletionResult> {
      completeCalls += 1;
      throw new Error("complete should not be used for human output");
    },
    async stream(request, onDelta): Promise<AiCompletionResult> {
      streamCalls += 1;
      onDelta("## Authentication\n\n");
      onDelta("Authentication uses `auth.ts`.");
      return {
        content: "## Authentication\n\nAuthentication uses `auth.ts`.",
        model: request.model
      };
    }
  };

  try {
    const logs = stripAnsi(await captureOutput(() => askCommand(
      ["where", "is", "auth"],
      {
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    )));

    assert.equal(streamCalls, 1);
    assert.equal(completeCalls, 0);
    assert.match(logs, /Authentication\n-+/);
    assert.match(logs, /Authentication uses auth\.ts\./);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ask command clearly warns when the snapshot is stale", async () => {
  const projectRoot = await createAskProject();
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      return {
        content: "Authentication uses `auth.ts`.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export async function getSession() { return { user: 'changed' }; }\n",
      "utf8"
    );

    const logs = stripAnsi(await captureOutput(() => askCommand(
      ["where", "is", "auth"],
      {
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    )));

    assert.match(logs, /Snapshot is stale/i);
    assert.match(logs, /devmap analyze --fresh/i);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ask command answers low-confidence questions locally without calling AI", async () => {
  const projectRoot = await createAskProject();
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      throw new Error("low-confidence ask should not call AI");
    }
  };

  try {
    const logs = stripAnsi(await captureOutput(() => askCommand(
      ["If", "I", "want", "to", "add", "payments,", "where", "should", "I", "start?"],
      {
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    )));

    assert.equal(requests.length, 0);
    assert.match(logs, /No strong file matches found/i);
    assert.match(logs, /No strong matching files found for ".*payments/i);
    assert.doesNotMatch(logs, /auth\.ts/);
    assert.doesNotMatch(logs, /Asking Groq/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("ask command falls back to static context after actionable AI errors", async () => {
  const projectRoot = await createAskProject();
  const client: AiClient = {
    async complete(): Promise<AiCompletionResult> {
      throw new DevmapError(
        "Groq rate limit reached after retrying.",
        "Try again later."
      );
    }
  };

  try {
    const logs = await captureOutput(() => askCommand(
      ["where", "is", "auth"],
      {
        projectRoot,
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    assert.match(logs, /rate limit reached/i);
    assert.match(logs, /Static Context/);
    assert.match(logs, /auth\.ts/);
    assert.doesNotMatch(logs, /\sat\s.*\(/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function createAskProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-ask-test-"));
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "ask-fixture" }),
    "utf8"
  );
  await writeFile(
    join(projectRoot, "auth.ts"),
    "export async function getSession() { return { user: 'fixture' }; }\n",
    "utf8"
  );

  const snapshot = await createProjectMap(projectRoot);
  await saveSnapshot(projectRoot, snapshot);
  return projectRoot;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
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
