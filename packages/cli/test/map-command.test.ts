import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { mapCommand } from "../src/commands/map.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const expressFixture = join(testDirectory, "fixtures", "express-project");

async function projectFromFixture(fixtureRoot: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-map-test-"));
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

test("map <file> shows what it uses and what uses it, and writes both output files", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand("lib/auth.ts", { projectRoot }))
    );

    assert.match(logs, /Uses/);
    assert.match(logs, /lib\/db\.ts/);
    assert.match(logs, /Used by/);
    assert.match(logs, /app\/page\.tsx/);
    assert.match(logs, /app\/api\/session\/route\.ts/);
    assert.match(logs, /Wrote \.devmap\/maps\/lib-auth\.md/);
    assert.match(logs, /Wrote \.devmap\/maps\/lib-auth\.mermaid/);

    const markdown = await readFile(join(projectRoot, ".devmap/maps/lib-auth.md"), "utf8");
    assert.match(markdown, /```mermaid/);
    assert.match(markdown, /graph LR/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map <file> resolves an unambiguous filename suffix", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(await captureOutput(() => mapCommand("auth.ts", { projectRoot })));
    assert.match(logs, /map: lib\/auth\.ts/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map rejects an unknown target with a helpful hint", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    await assert.rejects(
      () => mapCommand("nonexistent-thing", { projectRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /isn't a known file or feature/);
        return true;
      }
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map <feature> separates internal structure from the external boundary", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand("Authentication", { projectRoot }))
    );

    assert.match(logs, /Internal structure/);
    assert.match(logs, /app\/api\/session\/route\.ts/);
    assert.match(logs, /lib\/auth\.ts/);
    assert.match(logs, /Depends on \(outside this feature\)/);
    assert.match(logs, /lib\/db\.ts/);
    assert.match(logs, /Used by \(outside this feature\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map <feature> name match is case-insensitive", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand("authentication", { projectRoot }))
    );
    assert.match(logs, /map: Authentication/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map with no target produces a curated, feature-clustered project view", async () => {
  const projectRoot = await projectFromFixture(expressFixture);

  try {
    const logs = stripAnsi(await captureOutput(() => mapCommand(undefined, { projectRoot })));

    assert.match(logs, /Features/);
    assert.match(logs, /Payments/);
    assert.match(logs, /Entry points/);
    assert.match(logs, /src\/server\.ts/);
    assert.match(logs, /Coverage/);
    assert.match(logs, /Wrote \.devmap\/maps\/project\.md/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map <file> --depth 1 shows fewer hops than the default", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const shallow = stripAnsi(
      await captureOutput(() => mapCommand("app/api/session/route.ts", { projectRoot, depth: 1 }))
    );
    assert.match(shallow, /lib\/auth\.ts/);
    assert.doesNotMatch(shallow, /lib\/db\.ts/);

    const deeper = stripAnsi(
      await captureOutput(() => mapCommand("app/api/session/route.ts", { projectRoot, depth: 2 }))
    );
    assert.match(deeper, /lib\/db\.ts/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map --all dumps every file instead of the curated feature view", async () => {
  const projectRoot = await projectFromFixture(nextFixture);

  try {
    const logs = stripAnsi(
      await captureOutput(() => mapCommand(undefined, { projectRoot, all: true }))
    );

    assert.match(logs, /All files/);
    assert.match(logs, /lib\/auth\.ts/);
    assert.match(logs, /lib\/db\.ts/);
    assert.doesNotMatch(logs, /Coverage/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("map <file> stays terminating on an import cycle instead of recursing forever", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "devmap-map-cycle-fixture-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-map-cycle-project-"));

  try {
    await writeFile(join(fixtureRoot, "package.json"), JSON.stringify({ name: "cycle-test" }));
    await mkdir(join(fixtureRoot, "src"), { recursive: true });
    await writeFile(
      join(fixtureRoot, "src/a.ts"),
      'import { b } from "./b.js";\nexport const a = 1;\n'
    );
    await writeFile(
      join(fixtureRoot, "src/b.ts"),
      'import { a } from "./a.js";\nexport const b = 1;\n'
    );

    const snapshot = await createProjectMap(fixtureRoot);
    await saveSnapshot(projectRoot, snapshot);

    const logs = stripAnsi(
      await captureOutput(() => mapCommand("src/a.ts", { projectRoot }))
    );

    assert.match(logs, /src\/b\.ts/);
    assert.match(logs, /\(cycle\)/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
