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

test("buildCriticalFileReason returns execution reason for core execution responsibility (en)", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "unknown",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [
      { path: "src/engine.ts", referencedBy: 3, score: 20, reasons: ["core execution responsibility"] }
    ],
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

  const model = buildOnboardingModel(snapshot, "en");
  const startItem = model.startHere.find((item) => item.path === "src/engine.ts");
  assert.ok(startItem, "critical file should appear in startHere");
  assert.equal(startItem.reason, "This file runs first when the project starts");
});

test("buildCriticalFileReason returns execution reason for core execution responsibility (id)", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "unknown",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [
      { path: "src/engine.ts", referencedBy: 3, score: 20, reasons: ["core execution responsibility"] }
    ],
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

  const model = buildOnboardingModel(snapshot, "id");
  const startItem = model.startHere.find((item) => item.path === "src/engine.ts");
  assert.ok(startItem, "critical file should appear in startHere");
  assert.equal(startItem.reason, "File ini dijalankan pertama kali saat project start");
});

test("buildCriticalFileReason returns concern reason for core project concern", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "unknown",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [
      { path: "src/db.ts", referencedBy: 2, score: 10, reasons: ["core project concern"] }
    ],
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

  const model = buildOnboardingModel(snapshot, "en");
  const startItem = model.startHere.find((item) => item.path === "src/db.ts");
  assert.ok(startItem, "critical file should appear in startHere");
  assert.equal(startItem.reason, "Core project concern — many other parts depend on this");
});

test("buildCriticalFileReason returns fallback for generic critical file", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "unknown",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [
      { path: "src/util.ts", referencedBy: 2, score: 5, reasons: [] }
    ],
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

  const model = buildOnboardingModel(snapshot, "en");
  const startItem = model.startHere.find((item) => item.path === "src/util.ts");
  assert.ok(startItem, "critical file should appear in startHere");
  assert.match(startItem.reason, /important file/i);
});

test("buildHowItWorks produces CLI flow for node-cli project type", async () => {
  const snapshot: ProjectMap = {
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
      name: "test-cli",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["node-cli"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [],
    apiRoutes: [],
    externalServices: [],
    features: [{ name: "CLI Commands", purpose: "Handles CLI commands", files: [], entryPoints: [], businessFlow: [], searchTerms: [], confidence: "high" as const, evidence: [] }],
    flows: [],
    onboarding: { recommendedPath: [] },
    changeImpact: {},
    dependencies: {},
    fileGraph: {},
    fileIndex: {}
  };

  const model = buildOnboardingModel(snapshot, "en");
  const steps = model.howItWorks.map((s) => s.step).join(" ");
  assert.match(steps, /runs a command/);
  assert.match(steps, /Available commands include/);
});

test("buildHowItWorks produces auth web app flow when auth + routes present", async () => {
  const snapshot: ProjectMap = {
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
    framework: "nextjs" as const,
    project: {
      name: "test-auth",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "nextjs",
      projectTypes: ["web-app"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [{ path: "/login", file: "app/login/page.tsx", kind: "page", methods: ["GET"] }],
    apiRoutes: [{ path: "/api/auth", file: "app/api/auth/route.ts", kind: "api", methods: ["POST"] }],
    externalServices: [],
    features: [{ name: "Authentication", purpose: "Manages user login", files: [], entryPoints: [], businessFlow: [], searchTerms: [], confidence: "high" as const, evidence: [] }],
    flows: [],
    onboarding: { recommendedPath: [] },
    changeImpact: {},
    dependencies: {},
    fileGraph: {},
    fileIndex: {},
    entityGraph: { entities: [], relations: [], entityNames: ["Project", "Task"], source: "empty" as const }
  };

  const model = buildOnboardingModel(snapshot, "en");
  const steps = model.howItWorks.map((s) => s.step).join(" ");
  assert.match(steps, /User logs in/);
  assert.match(steps, /creates or manages/);
});

test("buildHowItWorks produces public web app flow when routes present without auth", async () => {
  const snapshot: ProjectMap = {
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
    framework: "express" as const,
    project: {
      name: "test-public",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "express",
      projectTypes: ["web-app"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [{ path: "/", file: "src/index.ts", kind: "page", methods: ["GET"] }],
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

  const model = buildOnboardingModel(snapshot, "en");
  const steps = model.howItWorks.map((s) => s.step).join(" ");
  assert.match(steps, /opens a page/);
  assert.match(steps, /processes the request/);
});

test("buildHowItWorks produces generic flow when no CLI, auth, or routes", async () => {
  const snapshot: ProjectMap = {
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
      name: "test-generic",
      root: "",
      language: "unknown",
      packageManager: "unknown",
      framework: "unknown",
      projectTypes: ["library"],
      workspaceType: "single-package",
      frameworks: [],
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

  const model = buildOnboardingModel(snapshot, "en");
  const steps = model.howItWorks.map((s) => s.step).join(" ");
  assert.match(steps, /starts from the main entry point/);
  assert.match(steps, /Modules and dependencies/);
});

test("buildTagline uses domain summary when present", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
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
    fileIndex: {},
    domain: { domain: "", summary: "eCommerce platform for managing inventory and orders. Built with modern tooling.", domainFeatures: [], confidence: 0, model: "", tokensUsed: 0 }
  };

  const model = buildOnboardingModel(snapshot, "en");
  assert.match(model.tagline, /eCommerce platform/);
});

test("buildTagline uses ownership hint and primary feature when no domain summary", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [],
    apiRoutes: [],
    externalServices: [],
    features: [{ name: "AI Integration", purpose: "Integrates AI services", files: [], entryPoints: [], businessFlow: [], searchTerms: [], confidence: "high" as const, evidence: [] }],
    flows: [],
    onboarding: { recommendedPath: [] },
    changeImpact: {},
    dependencies: {},
    fileGraph: {},
    fileIndex: {},
    capabilities: []
  };

  const model = buildOnboardingModel(snapshot, "en");
  assert.match(model.tagline, /personal/i);
  assert.match(model.tagline, /ai integration/);
});

test("buildTagline uses ownership hint with collaborative capabilities", async () => {
  const snapshot: ProjectMap = {
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
      name: "test",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [],
    criticalFiles: [],
    routes: [],
    apiRoutes: [],
    externalServices: [],
    features: [{ name: "Authentication", purpose: "Manages login", files: [], entryPoints: [], businessFlow: [], searchTerms: [], confidence: "high" as const, evidence: [] }],
    flows: [],
    onboarding: { recommendedPath: [] },
    changeImpact: {},
    dependencies: {},
    fileGraph: {},
    fileIndex: {},
    capabilities: [{ kind: "sharing" as const, name: "", entities: [], evidence: [], confidence: "high" as const }]
  };

  const model = buildOnboardingModel(snapshot, "en");
  assert.match(model.tagline, /collaborative/i);
  assert.match(model.tagline, /authentication/);
});

test("buildTagline falls back to bare name when no domain, hint, or feature", async () => {
  const snapshot: ProjectMap = {
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
      name: "devmap",
      root: "",
      language: "typescript",
      packageManager: "npm",
      framework: "unknown",
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
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

  const model = buildOnboardingModel(snapshot, "en");
  assert.match(model.tagline, /devmap/);
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
      projectTypes: ["unknown"],
      workspaceType: "single-package",
      frameworks: [],
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

  assert.equal(typeof model.tagline, "string");
  assert.equal(typeof model.whatThisIs, "string");
  assert.ok(Array.isArray(model.howItWorks));
  assert.ok(Array.isArray(model.features));
  assert.equal(model.features.length, 0);
  assert.ok(Array.isArray(model.startHere));
  assert.equal(model.startHere.length, 0);
  assert.equal(typeof model.isStale, "boolean");
});
