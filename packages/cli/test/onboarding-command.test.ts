import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { saveSnapshot } from "../src/cache/snapshot.js";
import { onboardingCommand } from "../src/commands/onboarding.js";
import type { Prompt } from "../src/utils/prompt.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const nextFixture = join(testDirectory, "fixtures", "nextjs-project");

test("onboarding command renders a snapshot-based guide", async () => {
  const projectRoot = await createOnboardingProject();

  try {
    const logs = await captureOutput(() => onboardingCommand({ projectRoot }));
    const plainLogs = stripAnsi(logs);

    assert.match(plainLogs, /DevMap Onboarding/);
    assert.match(plainLogs, /Project Overview/);
    assert.match(plainLogs, /Snapshot is stale/);
    assert.match(plainLogs, /Snapshot status: stale - run devmap analyze --fresh/);
    assert.match(plainLogs, /Entry Points/);
    assert.match(plainLogs, /External Services/);
    assert.match(plainLogs, /Critical Files/);
    assert.match(plainLogs, /Recommended Reading Path/);
    assert.match(plainLogs, /Feature Map/);
    assert.match(plainLogs, /Important Flows/);
    assert.match(plainLogs, /Agent Workflow/);
    assert.match(plainLogs, /Navigation policy: snapshot-first/);
    assert.match(plainLogs, /app\/page\.tsx/);
    assert.match(plainLogs, /Authentication/);
    assert.match(plainLogs, /Request \/api\/session/);
    assert.doesNotMatch(plainLogs, /not inferred yet/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("onboarding command writes ONBOARDING.md when requested", async () => {
  const projectRoot = await createOnboardingProject();

  try {
    const logs = await captureOutput(() => onboardingCommand({ projectRoot, write: true }));
    const outputPath = join(projectRoot, "ONBOARDING.md");
    await access(outputPath);
    const content = await readFile(outputPath, "utf8");

    assert.match(stripAnsi(logs), /Wrote ONBOARDING\.md/);
    assert.match(content, /^# Project Onboarding/m);
    assert.match(content, /## Recommended Reading Path/);
    assert.match(content, /app\/page\.tsx/);
    assert.match(content, /## Agent Workflow/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("onboarding write can generate Indonesian markdown after language prompt", async () => {
  const projectRoot = await createOnboardingProject();
  const prompt = createFakePrompt(["id"]);

  try {
    await captureOutput(() => onboardingCommand({ projectRoot, write: true, prompt }));
    const content = await readFile(join(projectRoot, "ONBOARDING.md"), "utf8");

    assert.equal(prompt.closed, true);
    assert.match(prompt.questions.join("\n"), /Onboarding language/);
    assert.match(content, /^# Onboarding Project/m);
    assert.match(content, /## Gambaran Project/);
    assert.match(content, /## Urutan Baca yang Disarankan/);
    assert.match(content, /Dibuat oleh DevMap/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function createOnboardingProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-onboarding-test-"));
  const snapshot = await createProjectMap(nextFixture);
  await saveSnapshot(projectRoot, {
    ...snapshot,
    projectRoot,
    project: {
      ...snapshot.project,
      root: projectRoot
    }
  });
  return projectRoot;
}

async function captureOutput(action: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  console.error = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    await action();
    return logs.join("\n");
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function createFakePrompt(answers: string[]): Prompt & { closed: boolean; questions: string[] } {
  return {
    closed: false,
    questions: [],
    async ask(question: string): Promise<string> {
      this.questions.push(question);
      return answers.shift() ?? "";
    },
    close(): void {
      this.closed = true;
    }
  };
}
