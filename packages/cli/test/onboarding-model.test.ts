import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { buildOnboardingModel } from "../src/onboarding/modelBuilder.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");

test("buildOnboardingModel populates all required fields from a full snapshot", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "en");

  assert.equal(typeof model.language, "string");
  assert.equal(model.language, "en");

  assert.equal(typeof model.projectName, "string");
  assert.ok(model.projectName.length > 0);

  assert.equal(typeof model.tagline, "string");
  assert.ok(model.tagline.length > 0);

  assert.equal(typeof model.stackLine, "string");

  assert.equal(typeof model.whatThisIs, "string");
  assert.ok(model.whatThisIs.length > 0);

  assert.ok(Array.isArray(model.howItWorks));
  assert.ok(model.howItWorks.length > 0);
  for (const step of model.howItWorks) {
    assert.equal(typeof step.step, "string");
  }

  assert.ok(Array.isArray(model.features));
  for (const feature of model.features) {
    assert.equal(typeof feature.name, "string");
    assert.equal(typeof feature.what, "string");
    assert.ok(feature.name.length > 0);
  }

  assert.ok(Array.isArray(model.startHere));
  for (const item of model.startHere) {
    assert.equal(typeof item.path, "string");
    assert.equal(typeof item.reason, "string");
    assert.equal(typeof item.order, "number");
    assert.ok(item.order >= 1);
    assert.ok(item.path.length > 0);
  }

  assert.equal(typeof model.generatedAt, "string");
  assert.ok(model.generatedAt.length > 0);

  assert.equal(typeof model.isStale, "boolean");
  assert.equal(model.isStale, false);
});

test("buildOnboardingModel produces Indonesian when requested", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "id");

  assert.equal(model.language, "id");
  assert.ok(model.tagline.length > 0);
  assert.ok(model.whatThisIs.length > 0);
  assert.ok(model.howItWorks.length > 0);
  assert.ok(model.features.length > 0);
  assert.ok(model.startHere.length > 0);
});

test("buildOnboardingModel startHere items have valid order and readable paths", async () => {
  const snapshot = await createProjectMap(nextFixture);
  const model = buildOnboardingModel(snapshot, "en");

  const orders = model.startHere.map((item) => item.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));

  for (const item of model.startHere) {
    assert.doesNotMatch(item.path, /\/prisma\/migrations?\//);
    assert.doesNotMatch(item.path, /\/generated\//);
    assert.doesNotMatch(item.path, /\.(lock|log|map|sql)$/);
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
      projectType: "unknown",
      workspaceType: "single-package",
      hasRootPackageJson: false,
      frameworks: [],
      isWorkspace: false,
      workspaces: []
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
    fileIndex: {}
  };

  const model = buildOnboardingModel(minimalSnapshot, "en");

  assert.equal(typeof model.tagline, "string");
  assert.equal(typeof model.whatThisIs, "string");
  assert.ok(Array.isArray(model.howItWorks));
  assert.ok(Array.isArray(model.features));
  assert.equal(model.features.length, 0);
  assert.ok(Array.isArray(model.startHere));
  assert.equal(model.startHere.length, 0);
  assert.equal(typeof model.isStale, "boolean");
});
