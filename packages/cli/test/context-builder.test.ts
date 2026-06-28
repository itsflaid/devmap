import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildQuestionContext,
  extractContextKeywords,
  normalizeExpandedTerms
} from "../src/ai/contextBuilder.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(testDirectory, "fixtures", "nextjs-project");

test("context builder ranks feature evidence and expands local dependencies", async () => {
  const snapshot = await createProjectMap(fixtureRoot);

  const context = await buildQuestionContext(
    fixtureRoot,
    snapshot,
    "How does authentication work?"
  );

  assert.equal(context.files[0]?.path, "lib/auth.ts");
  assert.ok(context.files[0]?.topFunctions.some((item) =>
    item.name === "getSession"
    && item.exported === true
    && item.async === true
  ));
  assert.equal(context.confidence, "high");
  assert.ok(context.topScore >= 70);
  assert.ok(context.files.some((file) => file.path === "lib/db.ts"));
  assert.ok(context.files.some((file) =>
    file.path === "lib/db.ts"
    && file.reasons.includes("imported by relevant file lib/auth.ts")
  ));
  assert.ok(context.files.length <= 5);
});

test("context builder expands Indonesian architecture terms", async () => {
  const snapshot = await createProjectMap(fixtureRoot);

  const context = await buildQuestionContext(
    fixtureRoot,
    snapshot,
    "Bagaimana autentikasi dan sesi pengguna bekerja?"
  );

  assert.equal(context.files[0]?.path, "lib/auth.ts");
  assert.ok(context.keywords.includes("auth"));
  assert.ok(context.keywords.includes("session"));
});

test("context builder ignores common English connector words", () => {
  const keywords = extractContextKeywords(
    "How to change the ask response format in this project?"
  );

  assert.deepEqual(keywords, ["ask", "response", "format"]);
});

test("context builder keeps action words as intent instead of search keywords", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-intent-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-intent" }),
      "src/analyzers/frameworkDetector.ts": [
        "export type Framework = 'nextjs' | 'express' | 'unknown';",
        "export function detectFramework() { return 'unknown'; }"
      ].join("\n"),
      "src/utils/config.ts": "export function readConfig() { return null; }\n",
      "src/routes/router.ts": "export function detectRoutes() { return []; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${content}\n`, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const frameworkContext = await buildQuestionContext(
      projectRoot,
      snapshot,
      "If I want to add Svelte framework detection, where do I start?"
    );
    const configContext = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where do I change config setup?"
    );

    assert.equal(frameworkContext.intent, "add_feature");
    assert.equal(frameworkContext.confidence, "high");
    assert.ok(!frameworkContext.keywords.includes("add"));
    assert.ok(!frameworkContext.keywords.includes("where"));
    assert.ok(frameworkContext.keywords.includes("framework"));
    assert.ok(frameworkContext.keywords.includes("detect"));
    assert.equal(frameworkContext.files[0]?.path, "src/analyzers/frameworkDetector.ts");

    assert.equal(configContext.intent, "change");
    assert.ok(configContext.topScore >= 25);
    assert.equal(configContext.files[0]?.path, "src/utils/config.ts");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder does not rank files from partial stop-word matches", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-stop-words-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-stop-words" }),
      "src/ai/prompts.ts": "export function buildAskMessages() { return 'format'; }\n",
      "src/commands/doctor.ts": "export function doctorCommand() { return true; }\n",
      "src/cache/snapshot.ts": "export function inspectSnapshot() { return true; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "How to change the ask response format?"
    );

    assert.equal(context.files[0]?.path, "src/ai/prompts.ts");
    assert.ok(context.files.every((file) => file.path !== "src/commands/doctor.ts"));
    assert.ok(context.files.every((file) => file.path !== "src/cache/snapshot.ts"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder keeps change questions focused on direct matches", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-theme-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-theme" }),
      "src/utils/output.ts": [
        "export const theme = {",
        "  aqua: '\\u001b[38;2;46;230;214m',",
        "  red: '\\u001b[31m'",
        "};"
      ].join("\n"),
      "src/analyzers/featureDetector.ts": "export function detectFeatures() { return []; }\n",
      "src/analyzers/projectMap.ts": "import { detectFeatures } from './featureDetector.js';\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${content}\n`, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "if i want to change theme form aqua to red, where i started?"
    );

    assert.equal(context.intent, "change");
    assert.equal(context.files[0]?.path, "src/utils/output.ts");
    assert.ok(context.files.every((file) => !file.path.includes("featureDetector")));
    assert.ok(context.files.every((file) => file.content.split(/\r?\n/).length <= 60));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder uses project entry points for entry point questions", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-entry-"));

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "context-entry" }),
      "utf8"
    );
    await writeFile(
      join(projectRoot, "index.ts"),
      "export function start() { return true; }\n",
      "utf8"
    );

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is the entry point?"
    );

    assert.equal(context.files[0]?.path, "index.ts");
    assert.equal(context.confidence, "medium");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder selects a relevant window from large files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-window-"));

  try {
    const lines = Array.from({ length: 300 }, (_, index) =>
      index === 249
        ? "export function validateSessionToken() { return true; }"
        : `// filler line ${index + 1}`
    );

    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "context-window" }),
      "utf8"
    );
    await writeFile(join(projectRoot, "auth.ts"), `${lines.join("\n")}\n`, "utf8");

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is session token validation?",
      { maxLinesPerFile: 40 }
    );
    const selected = context.files.find((file) => file.path === "auth.ts");

    assert.ok(selected);
    assert.equal(selected.truncated, true);
    assert.ok(selected.startLine > 200);
    assert.ok(selected.content.includes("validateSessionToken"));
    assert.ok(selected.content.split(/\r?\n/).length <= 40);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder enforces file limits and rejects paths outside the project", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-safety-"));
  const outsidePath = join(projectRoot, "..", "outside-secret.ts");

  try {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "context-safety" }),
      "utf8"
    );

    for (let index = 0; index < 7; index += 1) {
      await writeFile(
        join(projectRoot, `auth-${index}.ts`),
        `export const authHandler${index} = "auth";\n`,
        "utf8"
      );
    }

    await writeFile(outsidePath, "export const secret = 'do-not-read';\n", "utf8");

    const snapshot = await createProjectMap(projectRoot);
    snapshot.fileIndex["../outside-secret.ts"] = {
      hash: "unsafe",
      imports: [],
      exportedSymbols: ["secret"],
      lines: 1,
      scope: "unknown",
      featureRefs: [],
      searchTerms: ["secret"],
      importance: 0
    };

    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "auth secret",
      { maxFiles: 3 }
    );

    assert.equal(context.files.length, 3);
    assert.ok(context.files.every((file) => !file.path.includes("outside-secret")));
    assert.ok(context.files.every((file) => !file.content.includes("do-not-read")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsidePath, { force: true });
  }
});

test("context builder excludes test fixtures from product questions", async () => {
  const projectRoot = await createScopedContextProject();

  try {
    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Does this project have authentication?"
    );

    assert.equal(context.files[0]?.path, "src/auth.ts");
    assert.ok(context.files.every((file) => !file.path.includes("test/fixtures")));
    assert.ok(context.files.every((file) => !file.path.endsWith(".test.ts")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder returns low confidence with no files when nothing matches", async () => {
  const projectRoot = await createScopedContextProject();

  try {
    const snapshot = await createProjectMap(projectRoot);
    snapshot.criticalFiles = [
      { path: "src/auth.test.ts", score: 20, reasons: ["fixture critical file"] },
      { path: "src/auth.ts", score: 10, reasons: ["production critical file"] }
    ];
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Explain the zqxv subsystem"
    );

    assert.equal(context.confidence, "low");
    assert.equal(context.topScore, 0);
    assert.deepEqual(context.files, []);
    assert.deepEqual(context.relevantFiles, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder exposes expanded terms and uses them for ranking", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-expanded-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-expanded" }),
      "src/billing.ts": "export function BillingPortal() { return true; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is revenue setup?",
      { expandedTerms: ["billing"] }
    );

    assert.deepEqual(context.expandedTerms, ["billing"]);
    assert.equal(context.files[0]?.path, "src/billing.ts");
    assert.ok(context.files[0]?.reasons.some((reason) =>
      reason.includes("expanded term")
    ));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder uses fileIndex searchTerms for retrieval", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-file-terms-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-file-terms" }),
      "src/billing.ts": "export function openBillingPortal() { return true; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    snapshot.fileIndex["src/billing.ts"].searchTerms.push("invoice");
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is invoice setup?"
    );

    assert.equal(context.files[0]?.path, "src/billing.ts");
    assert.ok(context.files[0]?.reasons.includes("snapshot search term matches \"invoice\""));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder uses feature searchTerms and featureRefs for retrieval", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-feature-terms-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-feature-terms" }),
      "src/member.ts": "export function inviteMember() { return true; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    snapshot.features = [{
      name: "Workspace Management",
      purpose: "Identifies workspace membership behavior.",
      files: ["src/member.ts"],
      entryPoints: [],
      searchTerms: ["invitation"],
      confidence: "high",
      evidence: ["src/member.ts"]
    }];
    snapshot.fileIndex["src/member.ts"].featureRefs = ["Workspace Management"];
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is invitation handled?"
    );

    assert.equal(context.files[0]?.path, "src/member.ts");
    assert.ok(context.files[0]?.reasons.includes("evidence for Workspace Management"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder keeps direct keyword matches above expanded matches", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-direct-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-direct" }),
      "src/session.ts": "export function getSession() { return true; }\n",
      "src/oauth.ts": "export function OAuthClient() { return true; }\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is session setup?",
      { expandedTerms: ["oauth"] }
    );

    assert.equal(context.files[0]?.path, "src/session.ts");
    assert.ok(context.files.some((file) => file.path === "src/oauth.ts"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder excludes files that only score below the relevance threshold", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-threshold-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-threshold" }),
      "src/readme-helper.ts": "import './tiny-theme';\nexport const helper = true;\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is the color system?",
      { expandedTerms: ["tiny-theme"] }
    );

    assert.equal(context.confidence, "low");
    assert.equal(context.topScore < 25, true);
    assert.deepEqual(context.files, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("expanded term normalization keeps safe JSON-array output only", () => {
  assert.deepEqual(
    normalizeExpandedTerms(
      [" OAuth ", "auth.ts", "very long generated project term", "logic", "oauth"],
      ["auth"]
    ),
    ["oauth", "auth ts"]
  );
});

test("context builder does not treat analyzer internals as a product feature match", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-meta-feature-"));

  try {
    const files = {
      "package.json": JSON.stringify({ name: "context-meta-feature" }),
      "src/analyzers/featureDetector.ts": [
        "export function detectFeatures() { return ['Authentication']; }",
        "const terms = ['auth', 'login', 'session'];"
      ].join("\n"),
      "src/ai/types.ts": "export type TokenUsage = { totalTokens: number };\n",
      "src/analyzers/projectMap.ts": "import { detectFeatures } from './featureDetector.js';\n"
    };

    for (const [path, content] of Object.entries(files)) {
      const target = join(projectRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${content}\n`, "utf8");
    }

    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "if i want to add login-regis feature, where i started?"
    );

    assert.equal(context.intent, "add_feature");
    assert.equal(context.confidence, "low");
    assert.deepEqual(context.files, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder includes tests only when the English query requests them", async () => {
  const projectRoot = await createScopedContextProject();

  try {
    const snapshot = await createProjectMap(projectRoot);
    const context = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Which tests and fixtures cover authentication?"
    );

    assert.ok(context.files.some((file) => file.path.endsWith("auth.test.ts")));
    assert.ok(context.files.some((file) => file.path.includes("test/fixtures")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("context builder boosts explicit CLI and web scopes without hard exclusion", async () => {
  const projectRoot = await createScopedContextProject();

  try {
    const snapshot = await createProjectMap(projectRoot);
    const cliContext = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is the CLI dashboard command?"
    );
    const webContext = await buildQuestionContext(
      projectRoot,
      snapshot,
      "Where is the web UI dashboard component?"
    );

    assert.equal(cliContext.files[0]?.path, "packages/cli/src/dashboard.ts");
    assert.equal(webContext.files[0]?.path, "apps/web/src/Dashboard.ts");
    assert.ok(cliContext.files.length <= 2);
    assert.ok(webContext.files.length <= 2);
    assert.ok(cliContext.files.every((file) =>
      file.content.split(/\r?\n/).length <= 60
    ));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function createScopedContextProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-context-scope-"));
  const files = {
    "package.json": JSON.stringify({ name: "context-scope" }),
    "src/auth.ts": "export function authenticateUser() { return true; }\n",
    "src/auth.test.ts": "export function authenticationTest() { return true; }\n",
    "test/fixtures/auth.ts": "export function fixtureAuthentication() { return true; }\n",
    "packages/cli/src/dashboard.ts": "export function dashboardCommand() { return true; }\n",
    "apps/web/src/Dashboard.ts": "export function DashboardComponent() { return true; }\n"
  };

  for (const [path, content] of Object.entries(files)) {
    const target = join(projectRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  return projectRoot;
}
