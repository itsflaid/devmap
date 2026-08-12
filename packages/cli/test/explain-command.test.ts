import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
import {
  explainCommand,
  resolveExplainTarget,
  type ExplainResult
} from "../src/commands/explain.js";
import { DevmapError } from "../src/utils/errors.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");

function createFakeClient(
  content = "This code implements the targeted behavior."
): { client: AiClient; requests: AiCompletionRequest[] } {
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
  return { client, requests };
}

function fakeDependencies(client: AiClient): {
  loadConfig: () => Promise<{
    provider: "groq";
    apiKey: string;
    model: "auto";
  }>;
  createAiClient: () => AiClient;
} {
  return {
    loadConfig: async () => ({
      provider: "groq",
      apiKey: "gsk_fixture",
      model: "auto"
    }),
    createAiClient: () => client
  };
}

async function copyFixture(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-explain-"));
  await cp(nextFixture, projectRoot, { recursive: true });
  const snapshot = await createProjectMap(projectRoot);
  await saveSnapshot(projectRoot, snapshot);
  return projectRoot;
}

async function captureJson(action: () => Promise<void>): Promise<string> {
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

test("explain fails fast with a DevmapError when no provider is configured", async () => {
  const projectRoot = await copyFixture();

  try {
    await assert.rejects(
      () => explainCommand("lib/auth.ts", { projectRoot }, { loadConfig: async () => null }),
      (error) => {
        assert.ok(error instanceof DevmapError);
        assert.match(error.message, /requires an AI provider/);
        assert.match(error.hint ?? "", /devmap init/);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain resolves a file target and returns a structured result", async () => {
  const projectRoot = await copyFixture();
  const { client, requests } = createFakeClient();

  try {
    const raw = await captureJson(() => explainCommand(
      "lib/auth.ts",
      { projectRoot, json: true },
      fakeDependencies(client)
    ));
    const result = JSON.parse(raw) as ExplainResult;

    assert.equal(result.status, "ok");
    assert.equal(result.mode, "file");
    assert.equal(result.target, "lib/auth.ts");
    assert.equal(result.answer, "This code implements the targeted behavior.");
    assert.equal(result.model, DEFAULT_AI_MODELS.explain);
    assert.ok(result.contextFiles.includes("lib/auth.ts"));
    assert.equal(requests[0]?.model, DEFAULT_AI_MODELS.explain);
    assert.deepEqual(requests[0]?.fallbackModels, DEFAULT_AI_FALLBACKS.explain);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain resolves an unambiguous filename suffix", async () => {
  const projectRoot = await copyFixture();
  const { client } = createFakeClient();

  try {
    const raw = await captureJson(() => explainCommand(
      "auth.ts",
      { projectRoot, json: true },
      fakeDependencies(client)
    ));
    const result = JSON.parse(raw) as ExplainResult;

    assert.equal(result.mode, "file");
    assert.equal(result.target, "lib/auth.ts");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain resolves a feature name case-insensitively", async () => {
  const projectRoot = await copyFixture();
  const { client } = createFakeClient();

  try {
    const raw = await captureJson(() => explainCommand(
      "authentication",
      { projectRoot, json: true },
      fakeDependencies(client)
    ));
    const result = JSON.parse(raw) as ExplainResult;

    assert.equal(result.mode, "feature");
    assert.equal(result.target, "Authentication");
    assert.ok(result.contextFiles.length > 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain resolves a real function name from the snapshot topFunctions", async () => {
  const projectRoot = await copyFixture();
  const { client } = createFakeClient();

  const snapshot = JSON.parse(await readFile(
    join(projectRoot, ".devmap", "snapshot.json"),
    "utf8"
  )) as {
    fileIndex: Record<string, { topFunctions?: Array<{ name: string; line: number }> }>;
  };
  const firstFunction = Object.entries(snapshot.fileIndex)
    .flatMap(([file, entry]) => (entry.topFunctions ?? []).map((fn) => ({ file, fn })))
    .find(({ fn }) => fn.name);

  assert.ok(firstFunction, "fixture snapshot should contain topFunctions");

  try {
    const raw = await captureJson(() => explainCommand(
      firstFunction.fn.name,
      { projectRoot, json: true },
      fakeDependencies(client)
    ));
    const result = JSON.parse(raw) as ExplainResult;

    assert.equal(result.mode, "function");
    assert.equal(result.target, firstFunction.fn.name);
    assert.equal(result.resolvedFile, firstFunction.file);
    assert.ok(result.contextFiles.includes(firstFunction.file));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain throws an ambiguity error when a function name matches multiple files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-explain-ambig-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "explain-ambiguity" }),
      "utf8"
    );
    await writeFile(
      join(projectRoot, "a.ts"),
      "export function sharedName() { return 1; }\n",
      "utf8"
    );
    await writeFile(
      join(projectRoot, "b.ts"),
      "export function sharedName() { return 2; }\n",
      "utf8"
    );

    const snapshot = await createProjectMap(projectRoot);
    await saveSnapshot(projectRoot, snapshot);

    const { client } = createFakeClient();
    await assert.rejects(
      () => explainCommand("sharedName", { projectRoot }, fakeDependencies(client)),
      (error) => {
        assert.ok(error instanceof DevmapError);
        assert.match(error.message, /matches multiple functions/);
        assert.match(error.hint ?? "", /a\.ts:\d+/);
        assert.match(error.hint ?? "", /b\.ts:\d+/);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain throws a helpful not-found error for an unknown target", async () => {
  const projectRoot = await copyFixture();
  const { client } = createFakeClient();

  try {
    await assert.rejects(
      () => explainCommand("definitelyNotAThing", { projectRoot }, fakeDependencies(client)),
      (error) => {
        assert.ok(error instanceof DevmapError);
        assert.match(error.message, /isn't a known file, feature, or function/);
        assert.match(error.hint ?? "", /Known features:/);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain --write persists the answer to .devmap/explain/<slug>.md", async () => {
  const projectRoot = await copyFixture();
  const answer = "This code implements the targeted behavior.";
  const { client } = createFakeClient(answer);

  try {
    await captureJson(() => explainCommand(
      "lib/auth.ts",
      { projectRoot, json: true, write: true },
      fakeDependencies(client)
    ));

    const written = await readFile(
      join(projectRoot, ".devmap", "explain", "lib-auth.md"),
      "utf8"
    );
    assert.match(written, /^# lib\/auth\.ts/);
    assert.match(written, new RegExp(answer));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explain does not write any file when --write is not set", async () => {
  const projectRoot = await copyFixture();
  const { client } = createFakeClient();

  try {
    await captureJson(() => explainCommand(
      "lib/auth.ts",
      { projectRoot, json: true },
      fakeDependencies(client)
    ));

    await assert.rejects(
      () => readFile(join(projectRoot, ".devmap", "explain", "lib-auth.md"), "utf8"),
      (error) => {
        assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveExplainTarget matches a feature before a file before a function", () => {
  const snapshot = {
    features: [{ name: "Authentication" }],
    fileIndex: {
      "lib/auth.ts": {
        topFunctions: [
          { name: "auth", kind: "const", line: 4, exported: true, async: false }
        ]
      }
    }
  } as unknown as Parameters<typeof resolveExplainTarget>[0];

  assert.deepEqual(resolveExplainTarget(snapshot, "authentication"), {
    mode: "feature",
    value: "Authentication"
  });
  assert.deepEqual(resolveExplainTarget(snapshot, "lib/auth.ts"), {
    mode: "file",
    value: "lib/auth.ts"
  });
  assert.deepEqual(resolveExplainTarget(snapshot, "AUTH"), {
    mode: "function",
    value: "auth",
    file: "lib/auth.ts",
    line: 4
  });
});
