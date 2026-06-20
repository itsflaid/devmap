import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { writeAgentNavigationFiles } from "../src/cache/agentNavigation.js";

test("agent navigation writer creates a compact index and feature maps", async () => {
  const fixtureRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "nextjs-project"
  );
  const outputRoot = await mkdtemp(join(tmpdir(), "devmap-agent-navigation-"));

  try {
    const snapshot = await createProjectMap(fixtureRoot);
    const result = await writeAgentNavigationFiles(outputRoot, snapshot);
    const index = JSON.parse(await readFile(result.indexPath, "utf8")) as Record<string, unknown>;
    const features = index.features as Array<{
      id: string;
      map: string;
      criticalFiles: string[];
    }>;

    assert.equal(index.generatedAt, snapshot.generatedAt);
    assert.deepEqual(index.entryPoints, snapshot.entryPoints);
    assert.deepEqual(
      (index.criticalFiles as string[]).slice(0, snapshot.entryPoints.length),
      snapshot.entryPoints
    );
    assert.ok(Array.isArray(features));
    assert.ok(features.length > 0);
    assert.equal("changeImpact" in index, false);
    assert.deepEqual(index.snapshot, {
      path: ".devmap/snapshot.json",
      usage: "last_resort_or_web_ai_copy_context"
    });
    assert.match(String(index.agentInstructions), /Read this file first/);
    assert.match(String(index.agentInstructions), /Do not read snapshot\.json unless/);

    const authentication = features.find((feature) => feature.id === "authentication");
    assert.ok(authentication);
    assert.ok(authentication.map.endsWith("authentication.json"));
    assert.ok(authentication.criticalFiles.length <= 5);

    const featureMap = JSON.parse(await readFile(
      join(outputRoot, authentication.map),
      "utf8"
    )) as Record<string, unknown>;
    assert.equal(featureMap.id, "authentication");
    assert.ok(Array.isArray(featureMap.relatedFiles));
    assert.ok(Array.isArray(featureMap.sourcePriority));
    assert.equal("changeImpact" in featureMap, false);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
