import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireLock } from "../src/cache/analysisLock.js";
import { analyzeCommand } from "../src/commands/analyze.js";
import { DevmapError } from "../src/utils/errors.js";

async function tinyProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-analyze-lock-"));
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "lock-app", version: "1.0.0" }));
  await writeFile(join(projectRoot, "src", "index.ts"), "export const a = 1;\n");
  return projectRoot;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function quietly(action: () => Promise<void>): Promise<void> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

const offline = { offline: true };

test("devmap analyze releases the analysis lock when it finishes", async () => {
  const projectRoot = await tinyProject();
  try {
    await quietly(() => analyzeCommand(projectRoot, offline, {}));
    assert.equal(await exists(join(projectRoot, ".devmap", "snapshot.json")), true);
    assert.equal(await exists(join(projectRoot, ".devmap", "analyze.lock")), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap analyze refuses to run while another analysis holds the lock", async () => {
  const projectRoot = await tinyProject();
  const release = await acquireLock(projectRoot);
  try {
    await assert.rejects(
      () => quietly(() => analyzeCommand(projectRoot, offline, {})),
      (error: unknown) => error instanceof DevmapError && /already running/.test(error.message)
    );
    // The refused run must not delete the other analysis's lock or write a snapshot.
    assert.equal(await exists(join(projectRoot, ".devmap", "analyze.lock")), true);
    assert.equal(await exists(join(projectRoot, ".devmap", "snapshot.json")), false);
  } finally {
    await release();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap analyze --json also respects the lock", async () => {
  const projectRoot = await tinyProject();
  const release = await acquireLock(projectRoot);
  try {
    await assert.rejects(
      () => quietly(() => analyzeCommand(projectRoot, { ...offline, json: true }, {})),
      (error: unknown) => error instanceof DevmapError && /already running/.test(error.message)
    );
  } finally {
    await release();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap analyze takes the lock again after a previous run released it", async () => {
  const projectRoot = await tinyProject();
  try {
    await quietly(() => analyzeCommand(projectRoot, offline, {}));
    await quietly(() => analyzeCommand(projectRoot, { ...offline, fresh: true }, {}));
    assert.equal(await exists(join(projectRoot, ".devmap", "analyze.lock")), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("devmap analyze on a missing folder fails without creating a .devmap folder", async () => {
  const parent = await mkdtemp(join(tmpdir(), "devmap-analyze-missing-"));
  const missing = join(parent, "does-not-exist");
  try {
    await assert.rejects(() => quietly(() => analyzeCommand(missing, offline, {})));
    assert.equal(await exists(missing), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
