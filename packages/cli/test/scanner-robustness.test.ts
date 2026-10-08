import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanFiles } from "../src/analyzers/analysis/fileScanner.js";

async function withTempProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-scan-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A regression of the nested-limiter deadlock never settles, so race the scan
// against a timer to turn a hang into a clear test failure.
async function scanWithTimeout(root: string, ms = 10_000) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`scanFiles did not finish within ${ms}ms (deadlock?)`)), ms);
  });
  try {
    return await Promise.race([scanFiles(root), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test("scanFiles finishes on a wide tree with more sibling directories than the concurrency limit", async () => {
  await withTempProject(async (root) => {
    for (let index = 0; index < 120; index += 1) {
      await mkdir(join(root, `dir-${index}`));
      await writeFile(join(root, `dir-${index}`, "a.ts"), `export const a${index} = ${index};\n`);
      await writeFile(join(root, `dir-${index}`, "b.ts"), `export const b${index} = ${index};\n`);
    }

    const files = await scanWithTimeout(root);
    assert.equal(files.length, 240);
  });
});

test("scanFiles finishes on a nested tree with more open directories than the concurrency limit", async () => {
  await withTempProject(async (root) => {
    for (let outer = 0; outer < 8; outer += 1) {
      for (let inner = 0; inner < 8; inner += 1) {
        const directory = join(root, `group-${outer}`, `leaf-${inner}`);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "index.ts"), "export const value = 1;\n");
      }
    }

    const files = await scanWithTimeout(root);
    assert.equal(files.length, 64);
  });
});

test("scanFiles skips dangling symlinks instead of aborting the whole scan", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "real.ts"), "export const x = 1;\n");
    await symlink(join(root, "does-not-exist.ts"), join(root, "dangling.ts"));

    const files = await scanWithTimeout(root);
    assert.deepEqual(files.map((file) => file.path), ["real.ts"]);
  });
});

test("scanFiles does not report symlinked directories as empty files", async () => {
  await withTempProject(async (root) => {
    await mkdir(join(root, "real-dir"));
    await writeFile(join(root, "real-dir", "inner.ts"), "export const y = 1;\n");
    await symlink(join(root, "real-dir"), join(root, "linked-dir"));

    const files = await scanWithTimeout(root);
    assert.deepEqual(files.map((file) => file.path), ["real-dir/inner.ts"]);
  });
});

test("scanFiles still rejects when the project root does not exist", async () => {
  await assert.rejects(() => scanFiles(join(tmpdir(), "devmap-scan-missing-root-does-not-exist")));
});
