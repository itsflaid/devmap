import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDependencyGraph, countReferences } from "../src/analyzers/dependencyGraph.js";
import { scanFiles } from "../src/analyzers/fileScanner.js";
import { detectFramework } from "../src/analyzers/frameworkDetector.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { detectExternalServices } from "../src/analyzers/serviceDetector.js";
import { readSnapshot, saveSnapshot } from "../src/cache/snapshot.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const expressFixture = join(testDirectory, "fixtures", "express-project");

test("scanner ignores generated and secret paths", async () => {
  const files = await scanFiles(nextFixture);
  const paths = files.map((file) => file.path);

  assert.ok(paths.includes("app/page.tsx"));
  assert.ok(paths.includes("lib/auth.ts"));
  assert.ok(!paths.some((path) => path.startsWith("node_modules/")));
  assert.ok(!paths.some((path) => path.startsWith(".env")));
});

test("framework detector recognizes Next.js and Express fixtures", async () => {
  const nextFiles = await scanFiles(nextFixture);
  const expressFiles = await scanFiles(expressFixture);

  assert.equal(detectFramework(nextFiles), "nextjs");
  assert.equal(detectFramework(expressFiles), "express");
});

test("dependency graph resolves TypeScript imports using .js specifiers", async () => {
  const files = await scanFiles(nextFixture);
  const graph = buildDependencyGraph(files);
  const references = countReferences(graph);

  assert.deepEqual(graph["app/page.tsx"], ["lib/auth.ts"]);
  assert.deepEqual(graph["lib/auth.ts"], ["lib/db.ts"]);
  assert.equal(references["lib/auth.ts"], 1);
  assert.equal(references["lib/db.ts"], 1);
});

test("service detector only reports dependencies that are actually present", async () => {
  const nextServices = detectExternalServices(await scanFiles(nextFixture));
  const expressServices = detectExternalServices(await scanFiles(expressFixture));

  assert.deepEqual(nextServices, ["NextAuth", "Prisma"]);
  assert.deepEqual(expressServices, ["Stripe"]);
});

test("project map summarizes a Next.js fixture", async () => {
  const projectMap = await createProjectMap(nextFixture);

  assert.equal(projectMap.framework, "nextjs");
  assert.ok(projectMap.entryPoints.includes("app/page.tsx"));
  assert.ok(projectMap.entryPoints.includes("app/layout.tsx"));
  assert.deepEqual(projectMap.externalServices, ["NextAuth", "Prisma"]);
  assert.deepEqual(projectMap.fileIndex["app/page.tsx"].imports, ["lib/auth.ts"]);
  assert.ok(projectMap.fileIndex["lib/auth.ts"].exportedSymbols.includes("getSession"));
  assert.ok(projectMap.stats.relevantFiles >= 5);
});

test("project map summarizes an Express fixture", async () => {
  const projectMap = await createProjectMap(expressFixture);

  assert.equal(projectMap.framework, "express");
  assert.ok(projectMap.entryPoints.includes("src/server.ts"));
  assert.deepEqual(projectMap.externalServices, ["Stripe"]);
  assert.deepEqual(projectMap.fileIndex["src/server.ts"].imports, ["src/routes/payments.ts"]);
});

test("snapshot can be saved and read back", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "devmap-test-"));

  try {
    const projectMap = await createProjectMap(nextFixture);
    await saveSnapshot(temporaryRoot, projectMap);

    const saved = await readSnapshot(temporaryRoot);
    assert.deepEqual(saved, projectMap);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
