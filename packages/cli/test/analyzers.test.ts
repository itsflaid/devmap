import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDependencyGraph, countReferences } from "../src/analyzers/dependencyGraph.js";
import { scanFiles } from "../src/analyzers/fileScanner.js";
import { shouldIgnorePath } from "../src/analyzers/filterEngine.js";
import { detectFramework } from "../src/analyzers/frameworkDetector.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { detectExternalServices } from "../src/analyzers/serviceDetector.js";
import {
  inspectSnapshot,
  isSnapshotStale,
  readSnapshot,
  readSnapshotOrThrow,
  saveSnapshot
} from "../src/cache/snapshot.js";
import { DevmapError } from "../src/utils/errors.js";

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

test("scanner ignores package manager lockfiles", () => {
  for (const lockfile of [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ]) {
    assert.equal(shouldIgnorePath(lockfile, false), true, lockfile);
  }
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
  assert.equal(references["lib/auth.ts"], 2);
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

  assert.equal(projectMap.version, "1");
  assert.match(projectMap.fingerprint, /^[a-f0-9]{32}$/);
  assert.equal(projectMap.framework, "nextjs");
  assert.deepEqual(projectMap.project, {
    name: "nextjs-fixture",
    root: nextFixture,
    framework: "nextjs",
    language: "typescript",
    packageManager: "unknown"
  });
  assert.ok(projectMap.entryPoints.includes("app/page.tsx"));
  assert.ok(projectMap.entryPoints.includes("app/layout.tsx"));
  assert.deepEqual(projectMap.externalServices, ["NextAuth", "Prisma"]);
  assert.deepEqual(projectMap.database, {
    provider: "Prisma",
    files: ["prisma/schema.prisma"]
  });
  assert.deepEqual(
    projectMap.routes.map((route) => [route.path, route.kind, route.methods]),
    [
      ["/", "page", undefined],
      ["/api/session", "api", ["GET"]]
    ]
  );
  assert.deepEqual(projectMap.apiRoutes, [
    {
      path: "/api/session",
      file: "app/api/session/route.ts",
      kind: "api",
      methods: ["GET"]
    }
  ]);
  assert.ok(projectMap.features.some((feature) => feature.name === "Authentication"));
  assert.ok(projectMap.features.some((feature) => feature.name === "Database"));
  assert.ok(projectMap.features.some((feature) => feature.name === "API Routes"));
  assert.deepEqual(projectMap.fileIndex["app/page.tsx"].imports, ["lib/auth.ts"]);
  assert.ok(projectMap.fileIndex["lib/auth.ts"].exportedSymbols.includes("getSession"));
  assert.ok(projectMap.criticalFiles.some((file) =>
    file.path === "lib/auth.ts"
    && file.score > file.referencedBy
    && file.reasons.includes("core project concern")
  ));
  assert.ok(projectMap.stats.relevantFiles >= 5);
});

test("project map summarizes an Express fixture", async () => {
  const projectMap = await createProjectMap(expressFixture);

  assert.equal(projectMap.framework, "express");
  assert.ok(projectMap.entryPoints.includes("src/server.ts"));
  assert.deepEqual(projectMap.externalServices, ["Stripe"]);
  assert.deepEqual(projectMap.fileIndex["src/server.ts"].imports, ["src/routes/payments.ts"]);
  assert.deepEqual(projectMap.apiRoutes, [
    {
      path: "/payments",
      file: "src/server.ts",
      kind: "api",
      methods: ["USE"]
    }
  ]);
  assert.ok(projectMap.features.some((feature) => feature.name === "Payments"));
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

test("project fingerprint is stable until source content changes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-fingerprint-test-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "fingerprint-test", dependencies: { express: "^5.0.0" } }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const value = 1;\n", "utf8");

    const first = await createProjectMap(projectRoot);
    const second = await createProjectMap(projectRoot);
    assert.equal(first.fingerprint, second.fingerprint);
    await saveSnapshot(projectRoot, first);
    assert.equal(await isSnapshotStale(projectRoot, first), false);

    await writeFile(join(projectRoot, "server.ts"), "export const value = 2;\n", "utf8");
    const changed = await createProjectMap(projectRoot);
    assert.notEqual(first.fingerprint, changed.fingerprint);
    assert.equal(await isSnapshotStale(projectRoot, first), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("snapshot inspection distinguishes corrupt and unsupported files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-snapshot-status-test-"));

  try {
    await mkdir(join(projectRoot, ".devmap"), { recursive: true });
    await writeFile(join(projectRoot, ".devmap", "snapshot.json"), "{broken", "utf8");

    assert.equal((await inspectSnapshot(projectRoot)).status, "corrupt");
    await assert.rejects(
      readSnapshotOrThrow(projectRoot),
      (error: unknown) => error instanceof DevmapError && /corrupt/i.test(error.message)
    );

    await writeFile(
      join(projectRoot, ".devmap", "snapshot.json"),
      JSON.stringify({ version: "999" }),
      "utf8"
    );

    assert.deepEqual(await inspectSnapshot(projectRoot), {
      status: "unsupported",
      version: "999"
    });
    await assert.rejects(
      readSnapshotOrThrow(projectRoot),
      (error: unknown) => error instanceof DevmapError && /schema 999/.test(error.message)
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
