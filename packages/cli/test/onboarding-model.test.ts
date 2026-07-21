import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import type { OnboardingModel, ReadingItem } from "../src/onboarding/model.js";
import { buildOnboardingModel } from "../src/onboarding/modelBuilder.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const expressFixture = join(testDirectory, "fixtures", "express-project");

test("buildOnboardingModel populates all required fields from a full snapshot", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "en");

  assert.equal(typeof model.language, "string");
  assert.equal(model.language, "en");

  // project meta
  assert.equal(typeof model.project.name, "string");
  assert.equal(typeof model.project.language, "string");
  assert.equal(typeof model.project.framework, "string");
  assert.equal(typeof model.project.packageManager, "string");

  // overview is a non-empty string
  assert.equal(typeof model.overview, "string");
  assert.ok(model.overview.length > 0);

  // mentalModel is a non-empty array
  assert.ok(Array.isArray(model.mentalModel));
  assert.ok(model.mentalModel.length > 0);

  // mainConcepts is a non-empty array
  assert.ok(Array.isArray(model.mainConcepts));
  assert.ok(model.mainConcepts.length > 0);

  // importantAreas has reading items
  assert.ok(Array.isArray(model.importantAreas));
  assert.ok(model.importantAreas.length > 0);

  // each reading item has the required fields
  for (const item of model.importantAreas) {
    assert.equal(typeof item.path, "string");
    assert.ok([1, 2, 3, 4].includes(item.priority));
    assert.equal(typeof item.purpose, "string");
    assert.equal(typeof item.why, "string");
  }

  // keyFlows array
  assert.ok(Array.isArray(model.keyFlows));
  for (const flow of model.keyFlows) {
    assert.equal(typeof flow.name, "string");
    assert.equal(typeof flow.type, "string");
    assert.ok(Array.isArray(flow.steps));
  }

  // whereToStart is a non-empty array
  assert.ok(Array.isArray(model.whereToStart));
  assert.ok(model.whereToStart.length > 0);

  // generatedBy footer
  assert.equal(typeof model.generatedBy, "string");
  assert.ok(model.generatedBy.length > 0);
});

test("buildOnboardingModel produces Indonesian when requested", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "id");

  assert.equal(model.language, "id");
  assert.ok(model.overview.length > 0);
  assert.ok(model.mentalModel.length > 0);
  assert.ok(model.mainConcepts.length > 0);
  assert.ok(model.whereToStart.length > 0);

  // generatedBy footer is in Indonesian
  assert.ok(model.generatedBy.includes("Dibuat oleh DevMap"));
});

test("buildOnboardingModel importantAreas priorities are within valid range", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "en");

  for (const item of model.importantAreas) {
    assert.ok(item.priority >= 1 && item.priority <= 4,
      `Item ${item.path} has invalid priority ${item.priority}`);
  }
});

test("buildOnboardingModel handles an empty snapshot gracefully", async () => {
  const minimalSnapshot: ProjectMap = {
    version: "1",
    generatedAt: new Date().toISOString(),
    agentInstructions: {
      navigationPolicy: "index-first",
      defaultMode: "feature-map-first",
      maxInitialFiles: 3,
      missingSnapshotAction: "run-devmap-analyze",
      staleSnapshotAction: "run-devmap-analyze-fresh",
      fallbackRule: ""
    },
    fingerprint: "",
    projectRoot: "",
    framework: "unknown" as const,
    project: {
      name: "",
      root: "",
      language: "unknown",
      packageManager: "npm",
      framework: "unknown",
      frameworks: [],
      projectType: "unknown",
      workspaceType: "single-package"
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [],
    apiRoutes: [],
    externalServices: [],
    features: [],
    flows: [],
    onboarding: { recommendedPath: [] },
    changeImpact: {},
    dependencies: {},
    fileGraph: {},
    fileIndex: {}
  };

  const model = buildOnboardingModel(minimalSnapshot, "en");

  assert.equal(typeof model.overview, "string");
  assert.ok(Array.isArray(model.mentalModel));
  assert.ok(Array.isArray(model.mainConcepts));
  assert.ok(Array.isArray(model.importantAreas));
  assert.equal(model.importantAreas.length, 0);
  assert.ok(Array.isArray(model.keyFlows));
  assert.equal(model.keyFlows.length, 0);
  assert.ok(Array.isArray(model.whereToStart));
  assert.ok(model.whereToStart.length > 0);
});
