import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildDependencyGraph, countReferences } from "../src/analyzers/graph/dependencyGraph.js";
import { scanFiles } from "../src/analyzers/analysis/fileScanner.js";
import { shouldIgnorePath } from "../src/analyzers/analysis/filterEngine.js";
import {
  detectFramework,
  detectFrameworks
} from "../src/analyzers/detectors/frameworkDetector.js";
import { detectFeatures } from "../src/analyzers/features/featureDetector.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { detectExternalServices } from "../src/analyzers/detectors/serviceDetector.js";
import {
  inspectSnapshot,
  isSnapshotStale,
  readSnapshot,
  readSnapshotOrThrow,
  saveSnapshot
} from "../src/cache/snapshot.js";
import { DevmapError } from "../src/utils/errors.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");
const expressFixture = join(testDirectory, "fixtures", "express-project");

test("scanner ignores generated and secret paths", async () => {
  const files = await scanFiles(nextFixture);
  const paths = files.map((file) => file.path);

  assert.ok(paths.includes("app/page.tsx"));
  assert.ok(paths.includes("lib/auth.ts"));
  assert.ok(!paths.some((path) => path.startsWith("node_modules/")));
  assert.ok(!paths.some((path) => path.startsWith(".env")));
});

test("scanner ignores agent development metadata", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agent-metadata-test-"));

  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "agent-metadata-test" }));
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "index.ts"), "export const app = true;\n");
    await mkdir(join(projectRoot, ".agents", "skills", "ai-helper"), { recursive: true });
    await writeFile(
      join(projectRoot, ".agents", "skills", "ai-helper", "SKILL.md"),
      "# AI Helper\n\nThis development-only skill mentions OpenAI, Groq, and agents.\n"
    );

    const paths = (await scanFiles(projectRoot)).map((file) => file.path);

    assert.ok(paths.includes("src/index.ts"));
    assert.ok(!paths.some((path) => path.startsWith(".agents/")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("scanner ignores package manager lockfiles", () => {
  for (const lockfile of [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ]) {
    assert.equal(shouldIgnorePath(lockfile, false), true, lockfile);
  }
});

test("framework detector recognizes Next.js and Express fixtures", async () => {
  const nextFiles = await scanFiles(nextFixture);
  const expressFiles = await scanFiles(expressFixture);

  assert.equal(detectFramework(nextFiles), "nextjs");
  assert.equal(detectFramework(expressFiles), "express");
});

test("framework detector recognizes standalone React without downgrading Next.js", () => {
  const reactFiles = [
    createScannedFile("package.json", JSON.stringify({
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^5.0.0",
        vite: "^7.0.0"
      }
    })),
    createScannedFile(
      "src/main.tsx",
      'import { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(<App />);\n'
    ),
    createScannedFile(
      "src/app/Shell.tsx",
      "export function Shell() { return <main />; }\n"
    )
  ];
  const reactLibraryFiles = [
    createScannedFile("package.json", JSON.stringify({
      peerDependencies: { react: "^19.0.0" }
    })),
    createScannedFile("src/index.ts", "export const version = '1';\n")
  ];

  assert.equal(detectFramework(reactFiles), "react");
  assert.equal(detectFramework(reactLibraryFiles), "unknown");
});

test("framework detector reports Astro in a mixed workspace", () => {
  const files = [
    createScannedFile("package.json", JSON.stringify({ name: "workspace" })),
    createScannedFile("apps/web/package.json", JSON.stringify({
      devDependencies: { astro: "^5.0.0" }
    })),
    createScannedFile("apps/web/src/pages/index.astro", "<h1>Home</h1>\n"),
    createScannedFile("test/fixtures/next/package.json", JSON.stringify({
      dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" }
    })),
    createScannedFile("test/fixtures/express/package.json", JSON.stringify({
      dependencies: { express: "^5.0.0" }
    }))
  ];

  assert.equal(detectFramework(files), "astro");
  assert.deepEqual(detectFrameworks(files), ["astro"]);
});

test("project map classifies a standalone React app and finds its browser entry", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-react-project-"));

  try {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      name: "react-fixture",
      description: "A standalone React dashboard.",
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^5.0.0",
        vite: "^7.0.0",
        typescript: "^6.0.0"
      }
    }), "utf8");
    await writeFile(
      join(projectRoot, "src", "main.tsx"),
      'import { createRoot } from "react-dom/client";\nimport { App } from "./App.js";\ncreateRoot(document.body).render(<App />);\n',
      "utf8"
    );
    await writeFile(
      join(projectRoot, "src", "App.tsx"),
      "export function App() { return <main>Dashboard</main>; }\n",
      "utf8"
    );

    const projectMap = await createProjectMap(projectRoot);
    assert.equal(projectMap.framework, "react");
    assert.equal(projectMap.project.projectType, "web-app");
    assert.ok(projectMap.entryPoints.includes("src/main.tsx"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("dependency graph resolves TypeScript imports using .js specifiers", async () => {
  const files = await scanFiles(nextFixture);
  const graph = buildDependencyGraph(files);
  const references = countReferences(graph);

  assert.deepEqual(graph["app/page.tsx"], ["lib/auth.ts"]);
  assert.deepEqual(graph["lib/auth.ts"], ["lib/db.ts"]);
  assert.equal(references["lib/auth.ts"], 2);
  assert.equal(references["lib/db.ts"], 1);
});

test("service detector only reports dependencies that are actually present", async () => {
  const nextServices = detectExternalServices(await scanFiles(nextFixture));
  const expressServices = detectExternalServices(await scanFiles(expressFixture));

  assert.deepEqual(nextServices, ["NextAuth", "Prisma"]);
  assert.deepEqual(expressServices, ["Stripe"]);
});

test("service detector detects HTTP API providers without package dependencies", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-service-signal-test-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "service-signal-test", dependencies: { commander: "^12.0.0" } })
    );
    await mkdir(join(projectRoot, "src", "ai"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "ai", "groq.ts"),
      [
        "const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';",
        "export class GroqClient {}"
      ].join("\n")
    );
    await writeFile(
      join(projectRoot, "src", "ai", "openrouter.ts"),
      [
        "const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';",
        "export class OpenRouterClient {}"
      ].join("\n")
    );
    await mkdir(join(projectRoot, "src", "analyzers"), { recursive: true });
    await writeFile(
      join(projectRoot, "src", "analyzers", "serviceDetector.ts"),
      "const SOURCE_SERVICE_SIGNALS = ['https://api.openai.com/v1/chat/completions'];\n"
    );
    await mkdir(join(projectRoot, "docs"), { recursive: true });
    await writeFile(join(projectRoot, "docs", "notes.md"), "Groq mentioned in docs only.\n");

    assert.deepEqual(
      detectExternalServices(await scanFiles(projectRoot)),
      ["Groq", "OpenRouter"]
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("feature detection keeps documentation and landing UI out of technical features", () => {
  const files = [
    createScannedFile("README.md", "Authentication login session Groq Stripe upload email"),
    createScannedFile("PRD.md", "Authentication roadmap and payment requirements"),
    createScannedFile("docs/auth.md", "How login and sessions should work"),
    createScannedFile(
      "apps/web/src/components/landing/HeroSection.astro",
      "<h1>AI authentication and payment project mapping</h1>"
    ),
    createScannedFile(
      "packages/cli/src/ai/groq.ts",
      'import type { AiClient } from "./types.js"; export class GroqClient {}'
    ),
    createScannedFile(
      "packages/cli/src/ai/openrouter.ts",
      'import type { AiClient } from "./types.js"; export class OpenRouterClient {}'
    ),
    createScannedFile(
      "packages/cli/src/ai/contextBuilder.ts",
      'const aliases = ["auth", "login", "session", "jwt"]; export function buildContext() {}'
    ),
    createScannedFile(
      "packages/cli/src/ai/snapshotEnrichment.ts",
      'const prompt = "Prefer auth provider config, middleware guard, session provider, and nextauth examples"; export function enrich() {}'
    ),
    createScannedFile(
      "packages/cli/src/commands/onboarding.ts",
      'const example = "Authentication flow"; export function onboardingCommand() {}'
    ),
    createScannedFile(
      "packages/cli/src/analyzers/projectMap.ts",
      'import { scanFiles } from "./fileScanner.js"; export function createProjectMap() {}'
    ),
    createScannedFile(
      "packages/cli/src/cache/snapshot.ts",
      'export async function saveSnapshot() {}'
    ),
    createScannedFile(
      "packages/cli/src/commands/analyze.ts",
      'export async function analyzeCommand() {}'
    )
  ];

  const features = detectFeatures(files, []);
  const names = features.map((feature) => feature.name);

  assert.ok(names.includes("AI Integration"));
  assert.ok(names.includes("Analysis Engine"));
  assert.ok(names.includes("Snapshot Engine"));
  assert.ok(names.includes("CLI Commands"));
  assert.ok(names.includes("Documentation"));
  assert.ok(names.includes("Web Landing"));
  assert.ok(!names.includes("Authentication"));
  assert.ok(!names.includes("Payments"));
  assert.ok(!names.includes("File Upload"));

  const aiFeature = features.find((feature) => feature.name === "AI Integration");
  assert.ok(aiFeature?.files.includes("packages/cli/src/ai/groq.ts"));
  assert.ok(aiFeature?.files.includes("packages/cli/src/ai/openrouter.ts"));
  assert.ok(aiFeature?.files.every((path) => path.startsWith("packages/cli/src/ai/")));
});

test("structural feature flows describe behavior instead of repeating file lists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-structural-flow-test-"));
  const files = {
    "package.json": JSON.stringify({ name: "structural-flow-test" }),
    "src/index.ts": 'export { analyzeCommand } from "./commands/analyze.js";\n',
    "src/commands/analyze.ts": 'import { createProjectMap } from "../analyzers/pipeline/projectMap.js"; export async function analyzeCommand() { return createProjectMap(); }\n',
    "src/analyzers/fileScanner.ts": "export async function scanFiles() { return []; }\n",
    "src/analyzers/analyzerRegistry.ts": "export async function analyzeFiles() { return {}; }\n",
    "src/analyzers/tsMorphAnalyzer.ts": "export class TsMorphAnalyzer {}\n",
    "src/analyzers/projectMap.ts": 'import { scanFiles } from "./fileScanner.js"; import { analyzeFiles } from "./analyzerRegistry.js"; export async function createProjectMap() { await scanFiles(); return analyzeFiles(); }\n',
    "src/cache/snapshot.ts": "export async function saveSnapshot() {}\n",
    "src/cache/agentNavigation.ts": "export async function writeAgentNavigationFiles() {}\n",
    "src/utils/output.ts": "export const output = {};\n"
  };

  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const projectMap = await createProjectMap(projectRoot);
    const analysis = projectMap.features.find((feature) => feature.name === "Analysis Engine");
    const snapshot = projectMap.features.find((feature) => feature.name === "Snapshot Engine");

    assert.ok(analysis);
    assert.match(analysis.businessFlow.join(" "), /Scan project files/);
    assert.match(analysis.businessFlow.join(" "), /Choose a compatible file analyzer/);
    assert.doesNotMatch(analysis.businessFlow.join(" "), /Follow dependency/);
    assert.ok(snapshot);
    assert.match(snapshot.businessFlow.join(" "), /Persist and validate the snapshot/);
    assert.match(snapshot.businessFlow.join(" "), /lightweight index and feature maps/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("project map summarizes a Next.js fixture", async () => {
  const projectMap = await createProjectMap(nextFixture);

  assert.equal(projectMap.version, "1");
  assert.deepEqual(projectMap.agentInstructions, {
    navigationPolicy: "index-first",
    defaultMode: "feature-map-first",
    maxInitialFiles: 3,
    missingSnapshotAction: "run-devmap-analyze",
    staleSnapshotAction: "run-devmap-analyze-fresh",
    fallbackRule: "Read snapshot.json only when index.json and feature maps are insufficient; inspect extra source only when exact implementation is required."
  });
  assert.match(projectMap.fingerprint, /^[a-f0-9]{32}$/);
  assert.equal(projectMap.framework, "nextjs");
  assert.deepEqual(projectMap.project, {
    name: "nextjs-fixture",
    root: nextFixture,
    framework: "nextjs",
    frameworks: ["nextjs"],
    language: "typescript",
    packageManager: "unknown",
    projectType: "web-app",
    workspaceType: "single-package"
  });
  assert.ok(projectMap.entryPoints.includes("app/page.tsx"));
  assert.ok(projectMap.entryPoints.includes("app/layout.tsx"));
  assert.deepEqual(projectMap.externalServices, ["NextAuth", "Prisma"]);
  assert.deepEqual(projectMap.database, {
    provider: "Prisma",
    files: ["prisma/schema.prisma"]
  });
  assert.deepEqual(
    projectMap.routes.map((route) => [route.path, route.kind, route.methods]),
    [
      ["/", "page", undefined],
      ["/api/session", "api", ["GET"]]
    ]
  );
  assert.deepEqual(projectMap.apiRoutes, [
    {
      path: "/api/session",
      file: "app/api/session/route.ts",
      kind: "api",
      methods: ["GET"]
    }
  ]);
  assert.ok(projectMap.features.some((feature) => feature.name === "Authentication"));
  assert.ok(projectMap.features.some((feature) => feature.name === "Database"));
  assert.ok(projectMap.features.some((feature) => feature.name === "API Routes"));
  assert.deepEqual(projectMap.fileIndex["app/page.tsx"].imports, ["lib/auth.ts"]);
  assert.ok(projectMap.fileIndex["lib/auth.ts"].exportedSymbols.includes("getSession"));
  assert.deepEqual(
    projectMap.fileIndex["lib/auth.ts"].topFunctions.find((item) => item.name === "getSession"),
    {
      name: "getSession",
      kind: "function",
      line: 6,
      exported: true,
      async: true
    }
  );
  assert.equal(projectMap.fileIndex["app/api/session/route.ts"].scope, "api");
  assert.equal(projectMap.fileIndex["prisma/schema.prisma"].scope, "database");
  assert.equal(projectMap.fileIndex["lib/auth.ts"].scope, "service");
  assert.ok(projectMap.fileIndex["lib/auth.ts"].purpose?.includes("lib/auth.ts"));
  assert.ok(projectMap.fileIndex["lib/auth.ts"].searchTerms.includes("auth"));
  assert.ok(projectMap.fileIndex["lib/auth.ts"].featureRefs.includes("Authentication"));
  assert.ok(projectMap.fileIndex["lib/auth.ts"].importance > 0);
  assert.ok(projectMap.criticalFiles.some((file) =>
    file.path === "lib/auth.ts"
    && file.score > file.referencedBy
    && file.reasons.includes("core project concern")
  ));
  const authentication = projectMap.features.find((feature) => feature.name === "Authentication");
  assert.ok(authentication);
  assert.equal(authentication.confidence, "high");
  assert.equal(authentication.entryPoint, "app/api/session/route.ts");
  assert.ok(authentication.purpose.toLowerCase().includes("authentication"));
  assert.ok(authentication.searchTerms.includes("auth"));
  assert.ok(authentication.businessFlow.length >= 3);
  assert.equal(authentication.businessFlow[0], "Start at app/api/session/route.ts.");
  assert.ok(projectMap.flows.some((flow) =>
    flow.name === "Authentication flow"
    && flow.confidence === "high"
    && flow.steps.length > 0
  ));
  const sessionFlow = projectMap.flows.find((flow) => flow.name === "Request /api/session");
  assert.ok(sessionFlow);
  assert.equal(sessionFlow.type, "request");
  assert.equal(sessionFlow.entryPoint, "app/api/session/route.ts");
  assert.deepEqual(
    sessionFlow.steps.map((step) => step.file),
    ["app/api/session/route.ts", "lib/auth.ts", "lib/db.ts"]
  );
  assert.deepEqual(projectMap.changeImpact["lib/auth.ts"].impacts.sort(), [
    "Authentication",
    "Authentication flow",
    "Request /api/session"
  ]);
  assert.ok(projectMap.onboarding.recommendedPath.includes("package.json"));
  assert.ok(projectMap.onboarding.recommendedPath.includes("app/page.tsx"));
  assert.ok(projectMap.onboarding.recommendedPath.includes("lib/auth.ts"));
  assert.ok(projectMap.stats.relevantFiles >= 5);
});

function createScannedFile(path: string, content: string) {
  return {
    path,
    absolutePath: `C:/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

test("project map summarizes an Express fixture", async () => {
  const projectMap = await createProjectMap(expressFixture);

  assert.equal(projectMap.framework, "express");
  assert.ok(projectMap.entryPoints.includes("src/server.ts"));
  assert.deepEqual(projectMap.externalServices, ["Stripe"]);
  assert.equal(projectMap.fileIndex["src/server.ts"].scope, "api");
  assert.ok(projectMap.fileIndex["src/server.ts"].searchTerms.includes("server"));
  assert.deepEqual(projectMap.fileIndex["src/server.ts"].imports, ["src/routes/payments.ts"]);
  assert.deepEqual(
    projectMap.fileIndex["src/routes/payments.ts"].topFunctions.find((item) => item.name === "paymentsRouter"),
    {
      name: "paymentsRouter",
      kind: "const",
      line: 4,
      exported: true,
      async: false
    }
  );
  assert.deepEqual(projectMap.apiRoutes, [
    {
      path: "/payments",
      file: "src/server.ts",
      kind: "api",
      methods: ["USE"]
    }
  ]);
  const paymentsFlow = projectMap.flows.find((flow) => flow.name === "Request /payments");
  assert.ok(paymentsFlow);
  assert.equal(paymentsFlow.type, "request");
  assert.deepEqual(
    paymentsFlow.steps.map((step) => step.file),
    ["src/server.ts", "src/routes/payments.ts"]
  );
  assert.deepEqual(projectMap.changeImpact["src/routes/payments.ts"].impacts.sort(), [
    "Payments",
    "Payments flow",
    "Request /payments"
  ]);
  assert.ok(projectMap.onboarding.recommendedPath.includes("src/server.ts"));
  assert.ok(projectMap.features.some((feature) => feature.name === "Payments"));
});

test("snapshot can be saved and read back", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "devmap-test-"));

  try {
    const projectMap = await createProjectMap(nextFixture);
    await saveSnapshot(temporaryRoot, projectMap);

    const saved = await readSnapshot(temporaryRoot);
    assert.deepEqual(saved, projectMap);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("snapshot reader supplies project classification defaults for schema v1 snapshots", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "devmap-project-defaults-"));

  try {
    const projectMap = await createProjectMap(nextFixture);
    const legacyProject = projectMap.project as Partial<typeof projectMap.project>;
    delete legacyProject.projectType;
    delete legacyProject.workspaceType;
    delete legacyProject.frameworks;
    await saveSnapshot(temporaryRoot, projectMap);

    const saved = await readSnapshot(temporaryRoot);
    assert.equal(saved?.project.projectType, "web-app");
    assert.equal(saved?.project.workspaceType, "single-package");
    assert.deepEqual(saved?.project.frameworks, ["nextjs"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("project fingerprint is stable until source content changes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-fingerprint-test-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "fingerprint-test", dependencies: { express: "^5.0.0" } }),
      "utf8"
    );
    await writeFile(join(projectRoot, "server.ts"), "export const value = 1;\n", "utf8");

    const first = await createProjectMap(projectRoot);
    const second = await createProjectMap(projectRoot);
    assert.equal(first.fingerprint, second.fingerprint);
    await saveSnapshot(projectRoot, first);
    assert.equal(await isSnapshotStale(projectRoot, first), false);

    await writeFile(join(projectRoot, "server.ts"), "export const value = 2;\n", "utf8");
    const changed = await createProjectMap(projectRoot);
    assert.notEqual(first.fingerprint, changed.fingerprint);
    assert.equal(await isSnapshotStale(projectRoot, first), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("snapshot inspection distinguishes corrupt and unsupported files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-snapshot-status-test-"));

  try {
    await mkdir(join(projectRoot, ".devmap"), { recursive: true });
    await writeFile(join(projectRoot, ".devmap", "snapshot.json"), "{broken", "utf8");

    assert.equal((await inspectSnapshot(projectRoot)).status, "corrupt");
    await assert.rejects(
      readSnapshotOrThrow(projectRoot),
      (error: unknown) => error instanceof DevmapError && /corrupt/i.test(error.message)
    );

    await writeFile(
      join(projectRoot, ".devmap", "snapshot.json"),
      JSON.stringify({ version: "999" }),
      "utf8"
    );

    assert.deepEqual(await inspectSnapshot(projectRoot), {
      status: "unsupported",
      version: "999"
    });
    await assert.rejects(
      readSnapshotOrThrow(projectRoot),
      (error: unknown) => error instanceof DevmapError && /schema 999/.test(error.message)
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("snapshot inspection rejects invalid fileIndex entries", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-snapshot-index-test-"));

  try {
    const snapshot = await createProjectMap(nextFixture);
    snapshot.fileIndex["app/page.tsx"] = {
      hash: "fixture",
      imports: undefined as unknown as string[],
      exportedSymbols: [],
      lines: 1,
      scope: "ui",
      featureRefs: [],
      searchTerms: [],
      importance: 0
    };
    await saveSnapshot(projectRoot, snapshot);

    assert.deepEqual(await inspectSnapshot(projectRoot), {
      status: "corrupt",
      error: "fileIndex contains invalid entries."
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
