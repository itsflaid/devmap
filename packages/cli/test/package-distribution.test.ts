import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");

test("npm package metadata supports npx devmap with a minimal tarball", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(packageRoot, "package.json"), "utf8")
  ) as {
    name?: string;
    version?: string;
    description?: string;
    bin?: Record<string, string>;
    engines?: { node?: string };
    files?: string[];
    keywords?: string[];
    scripts?: Record<string, string>;
    publishConfig?: { access?: string };
  };

  assert.equal(packageJson.name, "devmap");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(
    packageJson.description,
    "AI-powered CLI to analyze, map, and explain codebases."
  );
  assert.equal(packageJson.bin?.devmap, "./dist/index.js");
  assert.equal(packageJson.engines?.node, ">=18");
  assert.deepEqual(packageJson.files, ["dist"]);
  assert.ok(packageJson.keywords?.includes("codebase"));
  assert.ok(packageJson.keywords?.includes("ai"));
  assert.ok(packageJson.keywords?.includes("developer-tools"));
  assert.equal(packageJson.scripts?.prepack, "pnpm run build");
  assert.equal(packageJson.publishConfig?.access, "public");

  const [readme, changelog, _license, cliEntry] = await Promise.all([
    readFile(resolve(packageRoot, "README.md"), "utf8"),
    readFile(resolve(workspaceRoot, "CHANGELOG.md"), "utf8"),
    readFile(resolve(packageRoot, "LICENSE"), "utf8"),
    readFile(resolve(packageRoot, "src", "index.ts"), "utf8")
  ]);

  assert.match(readme, /GROQ_API_KEY/);
  assert.match(readme, /--json/);
  assert.match(readme, /stored locally/i);
  assert.match(changelog, /## \[0\.1\.0\]/);
  assert.match(cliEntry, /\.version\(DEVMAP_VERSION\)/);
  assert.doesNotMatch(cliEntry, /\.version\("0\.1\.0"\)/);
});
