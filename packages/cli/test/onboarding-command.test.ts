import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
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
    assert.match(plainLogs, /What this is/);
    assert.match(plainLogs, /Snapshot is stale/);
    assert.match(plainLogs, /stale — run.*--fresh/);
    assert.match(plainLogs, /How it works/);
    assert.match(plainLogs, /What's inside/);
    assert.match(plainLogs, /Start here/);
    assert.match(plainLogs, /Key flows/);
    assert.match(plainLogs, /Go deeper/);
    assert.match(plainLogs, /app\/page\.tsx/);
    assert.match(plainLogs, /Authentication/);
    assert.match(plainLogs, /devmap explain/);
    assert.match(plainLogs, /devmap onboarding --write/);
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
    assert.match(content, /^# nextjs-fixture/m);
    assert.match(content, /## What this is/);
    assert.match(content, /## How it works/);
    assert.match(content, /## Start here/);
    assert.match(content, /app\/page\.tsx/);
    assert.doesNotMatch(content, /score \d+/);
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
    assert.match(content, /^# nextjs-fixture/m);
    assert.match(content, /## Tentang project ini/);
    assert.match(content, /## Fitur yang ada/);
    assert.match(content, /## Mulai dari sini/);
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
    async select<T extends string>(
      _question: string,
      options: Array<{ label: string; value: T }>
    ): Promise<T> {
      return options[0]!.value;
    },
    close(): void {
      this.closed = true;
    }
  };
}
