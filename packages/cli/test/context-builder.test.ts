import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildQuestionContext } from "../src/ai/contextBuilder.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";

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
      lines: 1
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

test("context builder excludes tests from fallback context", async () => {
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

    assert.ok(context.files.some((file) => file.path === "src/auth.ts"));
    assert.ok(context.files.every((file) => !file.path.endsWith(".test.ts")));
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
