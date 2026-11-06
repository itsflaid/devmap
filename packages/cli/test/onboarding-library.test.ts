import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { buildOnboardingModel } from "../src/onboarding/modelBuilder.js";

async function buildFixture(files: Record<string, string>): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-onboarding-library-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(projectRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return projectRoot;
}

test("onboarding describes a published library as a library, not a personal app", async () => {
  const projectRoot = await buildFixture({
    "package.json": JSON.stringify({ name: "tiny-cache", version: "1.0.0", main: "index.js" }),
    "index.js": [
      "const store = new Map();",
      "module.exports.get = (key) => store.get(key);",
      "module.exports.set = (key, value) => store.set(key, value);"
    ].join("\n")
  });

  try {
    const snapshot = await createProjectMap(projectRoot);
    assert.ok(snapshot.project.projectTypes.includes("library"));

    for (const language of ["en", "id"] as const) {
      const model = buildOnboardingModel(snapshot, language);
      assert.match(model.tagline, /library/i);
      assert.doesNotMatch(model.tagline, /personal/i);
      assert.doesNotMatch(model.whatThisIs, /personal|handles|menangani/i);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
