import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AI_FALLBACKS,
  DEFAULT_AI_MODELS
} from "../src/ai/groq.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult
} from "../src/ai/types.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { flowCommand } from "../src/commands/flow.js";
import { resolveEffectiveConfig } from "../src/utils/config.js";
import { DevmapError } from "../src/utils/errors.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const expressFixture = join(testDirectory, "fixtures", "express-project");

async function projectFromFixture(fixtureRoot: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-flow-test-"));
  const snapshot = await createProjectMap(fixtureRoot);
  await saveSnapshot(projectRoot, snapshot);
  return projectRoot;
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

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

async function flowCount(projectRoot: string): Promise<number> {
  const dir = join(projectRoot, ".devmap", "flows");
  const files = await readdir(dir);
  return files.filter((file) => file.endsWith(".md")).length;
}

test("flow with no target writes curated flows, prints index, and notes missing AI once", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => flowCommand(undefined, { projectRoot }, { loadConfig: async () => null }))
    );

    assert.equal((logs.match(/AI flow narration is not configured/g) ?? []).length, 1);
    assert.match(logs, /Flows written/);
    assert.match(logs, /Authentication flow/);
    assert.match(logs, /Request \/api\/session/);
    assert.match(logs, /Wrote \.devmap\/flows\/authentication-flow\.md/);
    assert.match(logs, /Wrote \.devmap\/flows\/request-api-session\.md/);

    const markdown = await readFile(
      join(projectRoot, ".devmap/flows/authentication-flow.md"),
      "utf8"
    );
    assert.match(markdown, /## Purpose/);
    assert.match(markdown, /## Steps/);
    assert.match(markdown, /```mermaid/);
    assert.match(markdown, /graph TD/);
    assert.doesNotMatch(markdown, /How it works/);

    const mermaid = await readFile(
      join(projectRoot, ".devmap/flows/authentication-flow.mermaid"),
      "utf8"
    );
    assert.match(mermaid, /graph TD/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow --all produces at least as many flows as the default run", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    await captureOutput(() => flowCommand(undefined, { projectRoot }, { loadConfig: async () => null }));
    const defaultCount = await flowCount(projectRoot);

    await captureOutput(() => flowCommand(undefined, { projectRoot, all: true }));
    const allCount = await flowCount(projectRoot);

    assert.ok(
      allCount >= defaultCount,
      `--all (${allCount}) should include at least the default flows (${defaultCount})`
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow --all includes non-API routes that the default run omits", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    await captureOutput(() => flowCommand(undefined, { projectRoot }, { loadConfig: async () => null }));
    const defaultFiles = await readdir(join(projectRoot, ".devmap", "flows"));
    assert.ok(!defaultFiles.includes("request.md"), "default should omit the page-route flow");

    await captureOutput(() => flowCommand(undefined, { projectRoot, all: true }));
    const allFiles = await readdir(join(projectRoot, ".devmap", "flows"));
    assert.ok(allFiles.includes("request.md"), "--all should include the page-route flow");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow <target> resolves a feature flow by case-insensitive name", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => flowCommand("AUTHENTICATION", { projectRoot }, { loadConfig: async () => null }))
    );

    assert.match(logs, /Wrote \.devmap\/flows\/authentication-flow\.md/);
    assert.doesNotMatch(logs, /Wrote \.devmap\/flows\/request-api-session\.md/);
    assert.equal(await flowCount(projectRoot), 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow rejects an unknown target with a helpful hint", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    await assert.rejects(
      () => flowCommand("nonexistent-flow-xyz", { projectRoot }, { loadConfig: async () => null }),
      (error: unknown) => {
        assert.ok(error instanceof DevmapError);
        assert.match(error.message, /isn't a known flow/);
        assert.ok(error.hint?.includes("Authentication flow"));
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow rejects an ambiguous target with the candidate list", async () => {
  const projectRoot = await projectFromFixture(expressFixture);

  try {
    await assert.rejects(
      () => flowCommand("payment", { projectRoot }, { loadConfig: async () => null }),
      (error: unknown) => {
        assert.ok(error instanceof DevmapError);
        assert.match(error.message, /matches multiple flows/);
        assert.match(error.hint ?? "", /Payments flow/);
        assert.match(error.hint ?? "", /Request \/payments/);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow --json emits a parseable FlowResult document", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = await captureOutput(() => flowCommand(undefined, { projectRoot, json: true }, { loadConfig: async () => null }));
    const result = JSON.parse(logs) as {
      status: string;
      flows: Array<{ name: string; purpose: string; type: string; narrated: boolean }>;
      writtenPaths: Array<{ name: string; markdown: string; mermaid: string }>;
      snapshot: { generatedAt: string; stale: boolean };
    };

    assert.equal(result.status, "ok");
    assert.ok(result.flows.length >= 1);
    for (const flow of result.flows) {
      assert.equal(typeof flow.name, "string");
      assert.equal(typeof flow.purpose, "string");
      assert.equal(typeof flow.type, "string");
      assert.equal(flow.narrated, false);
    }
    assert.ok(result.writtenPaths.length === result.flows.length);
    assert.ok(result.writtenPaths[0]?.markdown.endsWith(".md"));
    assert.ok(result.writtenPaths[0]?.mermaid.endsWith(".mermaid"));
    assert.equal(typeof result.snapshot.generatedAt, "string");
    assert.equal(typeof result.snapshot.stale, "boolean");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow narrates each flow via the flowNarration routing when AI is configured", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content: "This flow starts at the session route and moves through auth.",
        model: request.model
      };
    }
  };

  try {
    const logs = await captureOutput(() => flowCommand(
      "authentication",
      { projectRoot, json: true },
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    ));

    const result = JSON.parse(logs) as { flows: Array<{ narrated: boolean }> };
    assert.equal(result.flows[0]?.narrated, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, DEFAULT_AI_MODELS.flowNarration);
    assert.deepEqual(requests[0]?.fallbackModels, DEFAULT_AI_FALLBACKS.flowNarration);
    assert.equal(requests[0]?.maxCompletionTokens, 400);

    const markdown = await readFile(
      join(projectRoot, ".devmap/flows/authentication-flow.md"),
      "utf8"
    );
    assert.match(markdown, /## How it works/);
    assert.match(markdown, /This flow starts at the session route/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow uses a project-local model override for narration", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const requests: AiCompletionRequest[] = [];
  const client: AiClient = {
    async complete(request): Promise<AiCompletionResult> {
      requests.push(request);
      return {
        content: "This flow starts at the session route and moves through auth.",
        model: request.model
      };
    }
  };

  try {
    await writeFile(
      join(projectRoot, ".devmap", "config.local.json"),
      JSON.stringify({ model: "local-override-model" }),
      "utf8"
    );
    const localConfig = await resolveEffectiveConfig(projectRoot, {
      readGlobal: async () => ({
        provider: "groq" as const,
        apiKey: "gsk_fixture",
        model: "auto"
      })
    });

    await captureOutput(() => flowCommand(
      "authentication",
      { projectRoot, json: true },
      {
        loadConfig: async () => localConfig,
        createAiClient: () => client
      }
    ));

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, "local-override-model");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow falls back to plain steps when narration fails for one flow", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  const client: AiClient = {
    async complete(): Promise<AiCompletionResult> {
      throw new DevmapError("flow narration failed", "provider hiccup");
    }
  };

  try {
    const logs = stripAnsi(await captureOutput(() => flowCommand(
      undefined,
      { projectRoot },
      {
        loadConfig: async () => ({
          provider: "groq",
          apiKey: "gsk_fixture",
          model: "auto"
        }),
        createAiClient: () => client
      }
    )));

    assert.match(logs, /flow narration failed/);
    assert.match(logs, /Wrote \.devmap\/flows\/authentication-flow\.md/);
    assert.match(logs, /Wrote \.devmap\/flows\/request-api-session\.md/);

    const markdown = await readFile(
      join(projectRoot, ".devmap/flows/authentication-flow.md"),
      "utf8"
    );
    assert.doesNotMatch(markdown, /## How it works/);
    assert.match(markdown, /## Steps/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("flow --json output is non-interactive and never prompts for a key", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = await captureOutput(() => flowCommand(undefined, { projectRoot, json: true }, { loadConfig: async () => null }));
    assert.doesNotMatch(logs, /AI flow narration is not configured/);
    assert.doesNotMatch(logs, /\x1b\[/);
    JSON.parse(logs);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
