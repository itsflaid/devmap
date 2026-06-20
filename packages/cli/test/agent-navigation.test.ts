import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      'import { createProjectMap } from "../analyzers/projectMap.js";\nexport async function analyzeCommand() { return createProjectMap(); }\n'
    );
    await writeFixtureFile(
      projectRoot,
      "packages/cli/src/analyzers/projectMap.ts",
      'import { scanFiles } from "./fileScanner.js";\nexport async function createProjectMap() { return scanFiles(); }\n'
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
      "packages/cli/src/analyzers/projectMap.ts"
    ]);

    const analysis = index.features.find((feature) => feature.id === "analysis-engine");
    assert.ok(analysis);
    const featureMap = JSON.parse(await readFile(
      join(outputRoot, analysis.map),
      "utf8"
    )) as { sourcePriority: string[]; flow?: string[] };
    assert.equal(featureMap.sourcePriority[0], "packages/cli/src/analyzers/projectMap.ts");
    assert.match(featureMap.flow?.join(" ") ?? "", /Scan project files/i);
    assert.doesNotMatch(featureMap.flow?.join(" ") ?? "", /Follow dependency/i);
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
