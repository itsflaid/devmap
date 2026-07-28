import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { mapCommand } from "../src/commands/map.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const hubFixture = join(testDirectory, "fixtures", "hub-fanin");

async function projectFromFixture(fixtureRoot: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-map-truncation-"));
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

test("map on a high fan-in file caps the tree and mermaid diagram, with a truncation note", async () => {
  const projectRoot = await projectFromFixture(hubFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand("src/hub.ts", { projectRoot }))
    );

    const shownConsumers = [...logs.matchAll(/src\/consumer\d+\.ts/g)];
    assert.equal(new Set(shownConsumers.map((m) => m[0])).size, 25);

    assert.match(logs, /… \+5 more \(truncated for readability/);

    const mermaid = await readFile(join(projectRoot, ".devmap/maps/src-hub.mermaid"), "utf8");
    const edgeLines = mermaid.split("\n").filter((line) => line.includes("-->"));
    assert.equal(edgeLines.length, 25, "mermaid diagram should contain exactly 25 edges, not 30");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map --all on the same file bypasses the cap entirely", async () => {
  const projectRoot = await projectFromFixture(hubFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand("src/hub.ts", { projectRoot, all: true }))
    );

    const shownConsumers = [...logs.matchAll(/src\/consumer\d+\.ts/g)];
    assert.equal(new Set(shownConsumers.map((m) => m[0])).size, 30);
    assert.doesNotMatch(logs, /truncated for readability/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
