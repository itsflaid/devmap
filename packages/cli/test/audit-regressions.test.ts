import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CustomProviderClient } from "../src/ai/custom.js";
import { scanFiles, shouldIgnorePath, type ScannedFile } from "../src/analyzers/analysis/index.js";
import { VuePreprocessor } from "../src/analyzers/analysis/preprocessors/index.js";
import { TsMorphAnalyzer } from "../src/analyzers/analysis/tsMorphAnalyzer.js";
import { detectFrameworks } from "../src/analyzers/detectors/index.js";
import { buildDependencyGraph, detectEntryPoints, loadAliasMappings } from "../src/analyzers/graph/index.js";
import { analyzeFiles } from "../src/analyzers/pipeline/analyzerRegistry.js";
import { groundDomain } from "../src/analyzers/inference/domainGrounding.js";
import { inferDomain, type DomainInferenceInput } from "../src/analyzers/inference/domainInference.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import type { ProjectMap } from "../src/analyzers/pipeline/index.js";
import { buildOnboardingModel } from "../src/onboarding/modelBuilder.js";
import { DevmapError } from "../src/utils/errors.js";

function fileOf(path: string, content = ""): ScannedFile {
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  return { path, absolutePath: `/p/${path}`, extension, size: content.length, lines: 1, content };
}

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "devmap-audit-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ Vue SFC with two script blocks

const TWO_BLOCKS = [
  "<script lang=\"ts\">",
  "export default { name: \"Parent\" };",
  "</script>",
  "",
  "<script setup lang=\"ts\">",
  "import Child from \"./Child.vue\";",
  "</script>",
  "",
  "<template><Child /></template>"
].join("\n");

test("a Vue SFC with <script> and <script setup> exposes the imports of both blocks", () => {
  const extracted = new VuePreprocessor().extract(TWO_BLOCKS, "src/Parent.vue");

  assert.ok(extracted);
  assert.equal(extracted.language, "ts");
  assert.match(extracted.code, /export default/);
  assert.match(extracted.code, /import Child from/);
  assert.equal(extracted.code.split("\n").findIndex((line) => line.includes("import Child")), 5);
});

test("a component imported only from <script setup> stays connected in the graph", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "app", dependencies: { vue: "^3.0.0" } }),
    "src/Child.vue": "<template><i /></template>",
    "src/Parent.vue": TWO_BLOCKS,
    "src/main.ts": "import Parent from \"./Parent.vue\";\nconsole.log(Parent);\n"
  }, async (root) => {
    const files = await scanFiles(root);
    const analyses = await analyzeFiles(files);
    const { graph } = buildDependencyGraph(files, analyses, await loadAliasMappings(root));

    assert.ok(graph["src/Parent.vue"]?.includes("src/Child.vue"));
    assert.deepEqual(detectEntryPoints(graph), ["src/main.ts"]);
  });
});

// ------------------------------------------------------------ tooling config is never an entry

test("config files are not entry points, but Angular's app.config.ts still is", () => {
  const graph = {
    "vitest.config.e2e.ts": ["src/a.ts"],
    "src/a.ts": [],
    "apps/expo/app.config.ts": ["apps/expo/env.ts"],
    "apps/expo/env.ts": [],
    "src/app/app.config.ts": ["src/app/app.routes.ts"],
    "src/app/app.routes.ts": [],
    "src/app/app.component.ts": []
  };
  const entries = detectEntryPoints(graph, [{ path: "vitest.config.e2e.ts", kind: "script" }]);

  assert.ok(!entries.includes("vitest.config.e2e.ts"));
  assert.ok(!entries.includes("apps/expo/app.config.ts"));
  assert.ok(entries.includes("src/app/app.config.ts"));
});

// ------------------------------------------------------------ framework signals from sample folders

test("a next.config.js inside examples/ does not make the repository a Next.js app", () => {
  const manifest = JSON.stringify({ name: "lib", dependencies: { react: "^19.0.0" } });
  const files = [
    fileOf("package.json", manifest),
    fileOf("examples/with-nextjs/next.config.js", "module.exports = {};")
  ];

  assert.ok(!detectFrameworks(files).includes("nextjs"));
  assert.ok(detectFrameworks([...files, fileOf("apps/web/next.config.js", "module.exports = {};")]).includes("nextjs"));
});

// ------------------------------------------------------------ assets are not feature evidence

test("an image named after a capability does not create a feature", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "site", dependencies: { react: "^19.0.0" } }),
    "src/index.ts": "export const site = 1;\n",
    "public/logos/PayPal.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
  }, async (root) => {
    const map = await createProjectMap(root);
    assert.ok(!map.features.some((feature) => feature.files.some((file) => file.endsWith(".svg"))));
  });
});

// ------------------------------------------------------------ one-line bundles

test("a bundle written on one line is skipped instead of stalling the analysis", async () => {
  const bundle = "var a=function(){return 1};".repeat(20_000);
  const started = Date.now();
  const analysis = await new TsMorphAnalyzer().analyze(fileOf("src/vendor.js", bundle), {} as never);

  assert.equal(analysis.confidence, "low");
  assert.ok(Date.now() - started < 5_000);

  const normal = "export const a = 1;\n".repeat(5_000);
  const parsed = await new TsMorphAnalyzer().analyze(fileOf("src/data.ts", normal), {} as never);
  assert.equal(parsed.confidence, "high");
  assert.equal(parsed.symbols.length, 5_000);
});

// ------------------------------------------------------------ generated onboarding guide

test("the ONBOARDING.md that devmap writes is not part of the scanned project", () => {
  assert.equal(shouldIgnorePath("ONBOARDING.md", false), true);
  assert.equal(shouldIgnorePath("docs/ONBOARDING.md", false), false);
});

// ------------------------------------------------------------ onboarding wording

function snapshotWith(overrides: Partial<ProjectMap>): ProjectMap {
  const feature = (name: string, fileCount: number, purpose = "") => ({
    name, purpose, files: Array.from({ length: fileCount }, (_, index) => `${name}/${index}.ts`),
    entryPoints: [], businessFlow: [], searchTerms: [], confidence: "high" as const, evidence: []
  });
  return {
    version: "1",
    generatedAt: new Date().toISOString(),
    agentInstructions: {
      navigationPolicy: "index-first", defaultMode: "feature-map-first", maxInitialFiles: 3,
      missingSnapshotAction: "run-devmap-analyze", staleSnapshotAction: "run-devmap-analyze-fresh", fallbackRule: ""
    },
    fingerprint: "",
    projectRoot: "",
    framework: "nextjs" as const,
    project: {
      name: "shop", root: "", language: "typescript", packageManager: "npm", framework: "nextjs",
      projectTypes: ["web-app"], workspaceType: "single-package", frameworks: ["nextjs"]
    },
    stats: { totalFiles: 0, relevantFiles: 0, totalLines: 0 },
    entryPoints: [], criticalFiles: [], routes: [], apiRoutes: [], externalServices: [],
    features: [feature("Analytics", 2, "Tracks product metrics."), feature("Orders", 6), feature("Caching", 3)],
    flows: [], onboarding: { recommendedPath: [] }, changeImpact: {}, dependencies: {}, fileGraph: {}, fileIndex: {},
    capabilities: [],
    ...overrides
  } as ProjectMap;
}

test("the headline names the largest domain feature, not the alphabetically first one", () => {
  const model = buildOnboardingModel(snapshotWith({}), "en");

  assert.match(model.tagline, /orders/);
  assert.doesNotMatch(model.tagline, /analytics/);
  assert.match(model.whatThisIs, /handles orders/);
});

test("the stack line never repeats a technology", () => {
  const model = buildOnboardingModel(snapshotWith({
    database: { provider: "prisma", additional: [] } as unknown as ProjectMap["database"],
    externalServices: ["prisma", "Stripe"] as unknown as ProjectMap["externalServices"]
  }), "en");

  assert.equal(model.stackLine, "TypeScript · Nextjs · Prisma · Stripe");
});

test("a project without a framework is not called an 'application application'", () => {
  const model = buildOnboardingModel(snapshotWith({
    features: [],
    project: { ...snapshotWith({}).project, framework: "unknown", frameworks: [] }
  }), "en");

  assert.equal(model.tagline, "shop — application.");
});

// ------------------------------------------------------------ AI requests are bounded in time

test("a custom endpoint that never answers fails with a timeout error", async () => {
  const previous = process.env.DEVMAP_AI_TIMEOUT_MS;
  process.env.DEVMAP_AI_TIMEOUT_MS = "50";
  // The abort timer is unref'd (a real connection keeps the loop alive); this fake has none.
  const keepAlive = setTimeout(() => undefined, 5_000);

  try {
    const client = new CustomProviderClient("key", "http://localhost:9/v1", {
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })
    });

    await assert.rejects(
      client.complete({ messages: [{ role: "user", content: "hi" }], model: "m" }),
      (error: unknown) => error instanceof DevmapError && /did not answer in time/.test(error.message)
    );
  } finally {
    clearTimeout(keepAlive);
    if (previous === undefined) delete process.env.DEVMAP_AI_TIMEOUT_MS;
    else process.env.DEVMAP_AI_TIMEOUT_MS = previous;
  }
});

// ------------------------------------------------------------ AI domain must be grounded in the project

const BLOG_EVIDENCE = {
  projectName: "taxonomy",
  entityNames: ["Post", "User", "Account", "Session", "VerificationToken"],
  featureNames: ["Blog", "Dashboard", "Documentation"],
  routePaths: ["/blog/[slug]", "/dashboard/billing", "/docs/[[...slug]]"],
  capabilityKinds: ["subscription"]
};

function domainResult(domain: string, summary: string) {
  return { domain, summary, domainFeatures: [], confidence: 0.97, model: "m", tokensUsed: 0 };
}

test("a domain that shares nothing with the project is not grounded", () => {
  const verdict = groundDomain(
    domainResult("Hospital Patient Management System", "Manages patients, doctors and appointments for hospitals."),
    BLOG_EVIDENCE
  );

  assert.equal(verdict.grounded, false);
  assert.ok(verdict.unsupported.includes("patient"));
});

test("a domain described with the project's own words is grounded", () => {
  assert.equal(groundDomain(
    domainResult("Blog SaaS", "A starter where users write posts, read docs and pay for a subscription."),
    BLOG_EVIDENCE
  ).grounded, true);
  assert.equal(groundDomain(
    domainResult("Content Management System", "Lets people manage content."),
    BLOG_EVIDENCE
  ).grounded, true);
});

test("one coincidental word in the summary is not enough when the domain name matches nothing", () => {
  const verdict = groundDomain(
    domainResult("Hospital Patient Portal", "Hospitals publish a post about patients."),
    BLOG_EVIDENCE
  );

  assert.equal(verdict.grounded, false);
});

test("an AI feature that only touches User or Session entities is dropped", async () => {
  const input: DomainInferenceInput = {
    entityNames: ["User", "Session", "Post"],
    relations: [], capabilities: [], technicalFeatures: [], routeCount: 0, framework: "nextjs",
    ownershipPattern: "single_user_isolated", crossUserFields: [], absentCapabilities: []
  };
  const reply = JSON.stringify({
    domain: "Blog", summary: "Posts by users.", confidence: 0.9,
    domainFeatures: [
      { name: "Account Security", purpose: "Protects accounts", relatedEntities: ["User", "Session"] },
      { name: "Publishing", purpose: "Writes posts", relatedEntities: ["Post", "User"] }
    ]
  });

  const result = await inferDomain(input, async () => reply);

  assert.deepEqual(result?.domainFeatures.map((feature) => feature.name), ["Publishing"]);
});

test("analyze ignores an AI domain the project does not support and says so", async () => {
  await withProject({
    "package.json": JSON.stringify({ name: "blog", dependencies: { next: "14.0.0", "@prisma/client": "5.0.0" } }),
    "prisma/schema.prisma": [
      "model User {",
      "  id    String @id",
      "  posts Post[]",
      "}",
      "model Post {",
      "  id       String @id",
      "  title    String",
      "  authorId String",
      "  author   User   @relation(fields: [authorId], references: [id])",
      "}"
    ].join("\n"),
    "app/page.tsx": "export default function Page() { return null; }\n"
  }, async (root) => {
    const reply = JSON.stringify({
      domain: "Hospital Patient Management System",
      summary: "Manages patients, doctors and appointments.",
      confidence: 0.97,
      domainFeatures: [{ name: "Patient Records", purpose: "Stores records", relatedEntities: ["Post"] }]
    });
    const map = await createProjectMap(root, async () => reply);

    assert.equal(map.domain, undefined);
    assert.ok(map.features.every((feature) => feature.name !== "Patient Records"));
    assert.ok(map.warnings?.some((warning) => warning.includes("Hospital Patient Management System")));
  });
});

// ------------------------------------------------------------ ownership comes from the entity graph

test("the snapshot records who owns the data, and 'Personal app' needs that evidence", () => {
  const withoutEvidence = buildOnboardingModel(snapshotWith({ capabilities: [] }), "en");
  assert.doesNotMatch(withoutEvidence.tagline, /personal/i);

  const isolated = buildOnboardingModel(snapshotWith({
    ownership: { pattern: "single_user_isolated", crossUserFields: [] }
  }), "en");
  assert.match(isolated.tagline, /personal/i);
});
