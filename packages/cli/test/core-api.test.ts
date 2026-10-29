import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { loadSnapshot, saveSnapshot } from "../src/cache/snapshot.js";
import { runAnalyze } from "../src/commands/analyze.js";
import { runFlow } from "../src/commands/flow.js";
import { runMap } from "../src/commands/map.js";
import { DevmapError } from "../src/utils/errors.js";
import { withJsonOutput } from "../src/utils/output.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");

async function projectFromFixture(fixtureRoot: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-core-api-test-"));
  const snapshot = await createProjectMap(fixtureRoot);
  await saveSnapshot(projectRoot, snapshot);
  return projectRoot;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Run an action and return everything written through console.log/error and process.stdout. */
async function captureStreams<T>(action: () => Promise<T>): Promise<{ value: T; written: string[] }> {
  const written: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  console.log = (...values: unknown[]) => { written.push(values.join(" ")); };
  console.error = (...values: unknown[]) => { written.push(values.join(" ")); };
  process.stdout.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    const value = await action();
    return { value, written };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
  }
}

test("loadSnapshot returns the snapshot with its staleness", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const { snapshot, stale } = await loadSnapshot(projectRoot);
    assert.ok(snapshot.generatedAt);
    assert.equal(typeof stale, "boolean");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("loadSnapshot throws a hinted DevmapError when no snapshot exists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-core-api-empty-"));

  try {
    await assert.rejects(
      () => loadSnapshot(projectRoot),
      (error: unknown) => error instanceof DevmapError && /analyze/.test(error.hint ?? "")
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runMap with write:false computes the map without writing or printing", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const { value: result, written } = await captureStreams(
      () => withJsonOutput(() => runMap(undefined, { projectRoot, write: false }))
    );

    assert.equal(result.status, "ok");
    assert.equal(result.mode, "project");
    assert.ok(result.markdown.length > 0);
    assert.ok(result.mermaid.length > 0);
    assert.equal(result.writtenPaths, undefined);
    assert.deepEqual(written, []);
    assert.equal(await exists(join(projectRoot, ".devmap", "maps")), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runMap writes .devmap/maps by default and reports the paths", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const { value: result } = await captureStreams(
      () => withJsonOutput(() => runMap(undefined, { projectRoot }))
    );

    assert.ok(result.writtenPaths);
    assert.equal(result.writtenPaths.markdown, ".devmap/maps/project.md");
    assert.equal(await exists(join(projectRoot, result.writtenPaths.markdown)), true);
    assert.equal(await exists(join(projectRoot, result.writtenPaths.mermaid)), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runFlow with write:false and narrate:false is offline, silent, and writes nothing", async () => {
  const projectRoot = await projectFromFixture(nextFixture);
  let configLoaded = false;

  try {
    const { value: result, written } = await captureStreams(
      () => withJsonOutput(() => runFlow(
        undefined,
        { projectRoot, write: false, narrate: false },
        {
          loadConfig: async () => {
            configLoaded = true;
            return null;
          }
        }
      ))
    );

    assert.equal(result.status, "ok");
    assert.ok(result.flows.length > 0);
    assert.ok(result.flows.every((flow) => flow.narrated === false));
    assert.deepEqual(result.writtenPaths, []);
    assert.equal(configLoaded, false);
    assert.deepEqual(written, []);
    assert.equal(await exists(join(projectRoot, ".devmap", "flows")), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runFlow writes .devmap/flows by default", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const { value: result } = await captureStreams(
      () => withJsonOutput(() => runFlow(
        undefined,
        { projectRoot },
        { loadConfig: async () => null }
      ))
    );

    assert.equal(result.writtenPaths.length, result.flows.length);
    const files = await readdir(join(projectRoot, ".devmap", "flows"));
    assert.ok(files.some((file) => file.endsWith(".md")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("runAnalyze with offline:true never touches the AI provider, even when an API key is configured", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-offline-analyze-"));
  const { cp } = await import("node:fs/promises");
  await cp(nextFixture, projectRoot, { recursive: true });
  let aiTouched = false;

  try {
    const { value: snapshot, written } = await captureStreams(
      () => withJsonOutput(() => runAnalyze(
        projectRoot,
        { fresh: true, offline: true, json: true },
        {
          loadConfig: async () => {
            aiTouched = true;
            return { provider: "groq", apiKey: "gsk_fixture", model: "auto" };
          },
          createAiClient: () => {
            aiTouched = true;
            throw new Error("AI client must not be created in offline mode");
          }
        }
      ))
    );

    assert.equal(aiTouched, false);
    assert.equal(snapshot.domain, undefined);
    assert.equal(snapshot.ai, undefined);
    assert.ok(snapshot.features.length > 0, "static analysis still produces features");
    assert.deepEqual(written, [], "offline analysis is silent in JSON mode");
    assert.equal(await exists(join(projectRoot, ".devmap", "snapshot.json")), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
