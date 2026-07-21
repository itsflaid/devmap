import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
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

test("agent navigation identifies a CLI monorepo and prioritizes its main flow", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-cli-navigation-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "devmap-cli-navigation-output-"));

  try {
    await writeFixtureFile(projectRoot, "package.json", JSON.stringify({
      name: "navigator-workspace",
      private: true,
      description: "Maps codebases for developers and AI agents."
    }));
    await writeFixtureFile(projectRoot, "pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    await writeFixtureFile(projectRoot, "packages/cli/package.json", JSON.stringify({
      name: "navigator",
      description: "CLI that scans projects and generates reusable navigation context.",
      bin: { navigator: "./dist/index.js" }
    }));
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/index.ts",
      'import { analyzeCommand } from "./commands/analyze.js";\nanalyzeCommand();\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/commands/analyze.ts",
      'import { createProjectMap } from "../analyzers/pipeline/projectMap.js";\nexport async function analyzeCommand() { return createProjectMap(); }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/analyzers/pipeline/projectMap.ts",
      'import { scanFiles } from "../fileScanner.js";\nexport async function createProjectMap() { return scanFiles(); }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/analyzers/fileScanner.ts",
      "export async function scanFiles() { return []; }\n"
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/ai/groq.ts",
      "export async function completeWithGroq() { return 'ok'; }\n"
    );

    const snapshot = await createProjectMap(projectRoot);
    const result = await writeAgentNavigationFiles(outputRoot, snapshot);
    const index = JSON.parse(await readFile(result.indexPath, "utf8")) as {
      project: {
        projectType: string;
        workspaceType: string;
        summary: string;
      };
      criticalFiles: string[];
      features: Array<{ id: string; map: string }>;
    };

    assert.equal(index.project.projectType, "node-cli");
    assert.equal(index.project.workspaceType, "monorepo");
    assert.match(index.project.summary, /TypeScript monorepo centered on a Node\.js CLI/i);
    assert.match(index.project.summary, /generates reusable navigation context/i);
    assert.deepEqual(index.criticalFiles.slice(0, 3), [
      "packages/cli/src/index.ts",
      "packages/cli/src/commands/analyze.ts",
      "packages/cli/src/analyzers/pipeline/projectMap.ts"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("agent navigation describes mixed CLI workspaces without misleading agents", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-mixed-navigation-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "devmap-mixed-navigation-output-"));

  try {
    await writeFixtureFile(projectRoot, "package.json", JSON.stringify({
      name: "mixed-workspace",
      private: true
    }));
    await writeFixtureFile(projectRoot, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
    await writeFixtureFile(projectRoot, "README.md", "# Mixed workspace\n");
    await writeFixtureFile(projectRoot, "AGENTS.md", "# Agent guidance\n");
    await writeFixtureFile(projectRoot, "apps/web/package.json", JSON.stringify({
      name: "web",
      devDependencies: { astro: "^5.0.0" }
    }));
    await writeFixtureFile(projectRoot, "apps/web/src/pages/index.astro", "<h1>Landing</h1>\n");
    await writeFixtureFile(projectRoot, "apps/web/src/assets/README.md", "# Asset notes\n");
    await writeFixtureFile(projectRoot, "packages/cli/package.json", JSON.stringify({
      name: "navigator",
      bin: { navigator: "./dist/index.js" }
    }));
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/index.ts",
      'import { analyzeCommand } from "./commands/analyze.js"; analyzeCommand();\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/commands/analyze.ts",
      'import { createProjectMap } from "../analyzers/pipeline/projectMap.js"; import type { Project } from "../ai/types.js"; export function analyzeCommand(): Project { return createProjectMap() as Project; }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/analyzers/projectMap.ts",
      'import { scanFiles } from "./fileScanner.js"; import type { Project } from "../ai/types.js"; export function createProjectMap(): Project { return scanFiles() as Project; }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/analyzers/fileScanner.ts",
      "export function scanFiles() { return []; }\n"
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/ai/types.ts",
      "export type Project = { ready: boolean };\n"
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/ai/provider.ts",
      'import type { Project } from "./types.js"; export function createAiClient() { return {} as Project; } export function resolveAiRouting() { return "auto"; }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/ai/groq.ts",
      'import type { Project } from "./types.js"; export class GroqClient { project?: Project; }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/ai/openrouter.ts",
      'import type { Project } from "./types.js"; export class OpenRouterClient { project?: Project; }\n'
    );
    await writeFixtureFile(projectRoot, "packages/cli/src/ai/contextBuilder.ts", "export function buildQuestionContext() {}\n");
    await writeFixtureFile(projectRoot, "packages/cli/src/ai/prompts.ts", "export function buildAskMessages() {}\n");
    await writeFixtureFile(projectRoot, "packages/cli/src/ai/completion.ts", "export function completeWithOptionalStreaming() {}\n");

    const snapshot = await createProjectMap(projectRoot);
    const result = await writeAgentNavigationFiles(outputRoot, snapshot);
    const index = JSON.parse(await readFile(result.indexPath, "utf8")) as {
      project: { framework: string; frameworks: string[]; projectType: string };
      features: Array<{ id: string; map: string }>;
    };

    assert.equal(index.project.projectType, "node-cli");
    assert.equal(index.project.framework, "unknown");
    assert.deepEqual(index.project.frameworks, ["astro"]);

    const documentation = index.features.find((feature) => feature.id === "documentation");
    assert.ok(documentation);
    const documentationMap = JSON.parse(await readFile(
      join(outputRoot, documentation.map),
      "utf8"
    )) as { entryPoints: string[]; sourcePriority: string[] };
    assert.equal(documentationMap.entryPoints[0], "README.md");
    assert.equal(documentationMap.sourcePriority[0], "README.md");

    const providerPurpose = snapshot.fileIndex["packages/cli/src/ai/provider.ts"]?.purpose ?? "";
    assert.match(providerPurpose, /selects the configured AI provider/i);
    assert.doesNotMatch(providerPurpose, /\bexposes\b/i);

    const aiIntegration = snapshot.features.find((feature) => feature.name === "AI Integration");
    assert.ok(aiIntegration);
    assert.match(aiIntegration.businessFlow.join(" "), /groq\.ts/i);
    assert.match(aiIntegration.businessFlow.join(" "), /openrouter\.ts/i);

    const scanner = snapshot.criticalFiles.find((file) =>
      file.path.endsWith("analyzers/fileScanner.ts")
    );
    const sharedTypes = snapshot.criticalFiles.find((file) =>
      file.path.endsWith("ai/types.ts")
    );
    assert.ok(scanner);
    assert.ok(sharedTypes);
    assert.ok(scanner.score > sharedTypes.score);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

async function writeFixtureFile(
  projectRoot: string,
  path: string,
  content: string
): Promise<void> {
  const target = join(projectRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
