import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("npm package metadata supports npx devmap with a minimal tarball", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(packageRoot, "package.json"), "utf8")
  ) as {
    name?: string;
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
    publishConfig?: { access?: string };
  };

  assert.equal(packageJson.name, "devmap");
  assert.equal(packageJson.bin?.devmap, "./dist/index.js");
  assert.deepEqual(packageJson.files, ["dist"]);
  assert.equal(packageJson.scripts?.prepack, "pnpm run build");
  assert.equal(packageJson.publishConfig?.access, "public");

  await Promise.all([
    readFile(resolve(packageRoot, "README.md"), "utf8"),
    readFile(resolve(packageRoot, "LICENSE"), "utf8")
  ]);
});
