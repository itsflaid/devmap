import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initCommand } from "../src/commands/init.js";
import {
  DEVMAP_AGENTS_BLOCK,
  ensureAgentsFile,
  inspectAgentsFile
} from "../src/utils/agentsFile.js";
import {
  getConfigPath,
  readConfig,
  type DevmapConfig
} from "../src/utils/config.js";
import { buildDevmapFile, ensureDevmapFile } from "../src/utils/devmapFile.js";
import { DevmapError, handleError } from "../src/utils/errors.js";
import type { Prompt } from "../src/utils/prompt.js";

test("DEVMAP.md contains workflow and AI-agent guidance", () => {
  const content = buildDevmapFile();

  assert.match(content, /devmap analyze/);
  assert.match(content, /Navigation Order/);
  assert.match(content, /\.devmap\/index\.json/);
  assert.match(content, /\.devmap\/features\/\*\.json/);
  assert.match(content, /snapshot\.json.*only when/is);
  assert.match(content, /--json/);
  assert.match(content, /\.devmap\/snapshot\.json/);
});

test("DEVMAP.md is not overwritten when it already exists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-file-test-"));

  try {
    assert.equal(await ensureDevmapFile(projectRoot), true);
    const firstWrite = await readFile(join(projectRoot, "DEVMAP.md"), "utf8");
    assert.equal(firstWrite, buildDevmapFile());

    await writeFile(join(projectRoot, "DEVMAP.md"), "custom user content\n", "utf8");
    assert.equal(await ensureDevmapFile(projectRoot), false);

    const content = await readFile(join(projectRoot, "DEVMAP.md"), "utf8");
    assert.equal(content, "custom user content\n");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("init uses environment API key and creates project setup files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-test-"));
  let validatedKey = "";
  let savedConfig: DevmapConfig | null = null;

  try {
    await initCommand({
      projectRoot,
      isInteractive: false,
      environmentApiKey: "gsk_fixture",
      loadConfig: async () => null,
      persistConfig: async (config) => {
        savedConfig = config;
      },
      validateApiKey: async (apiKey) => {
        validatedKey = apiKey;
      }
    });

    assert.equal(validatedKey, "gsk_fixture");
    assert.deepEqual(savedConfig, {
      provider: "groq",
      apiKey: "gsk_fixture",
      model: "auto"
    });

    await access(join(projectRoot, ".devmap"));
    assert.match(await readFile(join(projectRoot, ".gitignore"), "utf8"), /\.devmap\//);
    assert.match(await readFile(join(projectRoot, "DEVMAP.md"), "utf8"), /Navigation Order/);
    assert.match(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), /DevMap Context/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("readConfig backfills provider and model for legacy Groq configs", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "devmap-legacy-config-test-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.HOME = temporaryHome;
    process.env.USERPROFILE = temporaryHome;
    const configPath = getConfigPath();
    await mkdir(join(temporaryHome, ".devmap"), { recursive: true });

    await writeFile(configPath, JSON.stringify({
      apiKey: "gsk_legacy_fixture"
    }), "utf8");

    assert.deepEqual(await readConfig(), {
      provider: "groq",
      apiKey: "gsk_legacy_fixture",
      model: "auto"
    });
  } finally {
    restoreEnvironment("HOME", originalHome);
    restoreEnvironment("USERPROFILE", originalUserProfile);
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("interactive init appends DevMap instructions only after confirmation", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-confirm-test-"));
  const original = "# Existing Instructions\n\nKeep this content.\n";

  try {
    await writeFile(join(projectRoot, "AGENTS.md"), original, "utf8");

    await initCommand({
      projectRoot,
      prompt: createFakePrompt(["gsk_fixture", "yes"]),
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined,
      listGroqModels: async () => ["openai/gpt-oss-20b"]
    });

    const content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    assert.ok(content.startsWith(original));
    assert.match(content, /<!-- DevMap Instruction Block -->/);
    assert.match(content, /read `DEVMAP\.md` for project metadata and available commands/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("interactive init preserves existing AGENTS.md when confirmation is declined", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-decline-test-"));
  const original = "# Existing Instructions\n\nKeep this content.\n";

  try {
    await writeFile(join(projectRoot, "AGENTS.md"), original, "utf8");

    await initCommand({
      projectRoot,
      prompt: createFakePrompt(["gsk_fixture", "no"]),
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined,
      listGroqModels: async () => ["openai/gpt-oss-20b"]
    });

    assert.equal(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), original);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("non-interactive init never appends to an existing AGENTS.md", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-noninteractive-test-"));
  const original = "# Existing Instructions\n\nKeep this content.\n";

  try {
    await writeFile(join(projectRoot, "AGENTS.md"), original, "utf8");

    await initCommand({
      projectRoot,
      isInteractive: false,
      environmentApiKey: "gsk_fixture",
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined
    });

    assert.equal(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), original);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("AGENTS.md integration is idempotent", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-idempotent-test-"));

  try {
    assert.equal(await ensureAgentsFile(projectRoot, false), "created");
    assert.equal(await ensureAgentsFile(projectRoot, true), "unchanged");

    const content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    assert.equal(content.match(/<!-- DevMap Instruction Block -->/g)?.length, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("AGENTS.md recognizes canonical and legacy DevMap markers", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-marker-test-"));

  try {
    await writeFile(join(projectRoot, "AGENTS.md"), DEVMAP_AGENTS_BLOCK, "utf8");
    assert.equal(await inspectAgentsFile(projectRoot), "integrated");

    await writeFile(
      join(projectRoot, "AGENTS.md"),
      "<!-- DEVMap Instruction Block -->\nLegacy block.\n",
      "utf8"
    );
    assert.equal(await inspectAgentsFile(projectRoot), "integrated");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("readConfig returns null for invalid config schemas", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "devmap-config-test-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.HOME = temporaryHome;
    process.env.USERPROFILE = temporaryHome;
    const configPath = getConfigPath();
    await mkdir(join(temporaryHome, ".devmap"), { recursive: true });

    await writeFile(configPath, JSON.stringify({
      provider: "openai",
      model: 42
    }), "utf8");
    assert.equal(await readConfig(), null);

    await writeFile(configPath, JSON.stringify({
      provider: "groq",
      model: "auto",
      apiKey: "gsk_fixture"
    }), "utf8");
    assert.deepEqual(await readConfig(), {
      provider: "groq",
      model: "auto",
      apiKey: "gsk_fixture"
    });

    await writeFile(configPath, JSON.stringify({
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
      apiKey: "sk-or-fixture"
    }), "utf8");
    assert.deepEqual(await readConfig(), {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
      apiKey: "sk-or-fixture"
    });
  } finally {
    restoreEnvironment("HOME", originalHome);
    restoreEnvironment("USERPROFILE", originalUserProfile);
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("interactive init selects Groq with the provider menu", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-provider-test-"));
  const prompt = createFakePrompt(["gsk_fixture"], ["groq", "llama-3.3-70b-versatile"]);
  let savedConfig: DevmapConfig | null = null;

  try {
    await initCommand({
      projectRoot,
      prompt,
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async (config) => {
        savedConfig = config;
      },
      validateApiKey: async () => undefined,
      listGroqModels: async () => [
        "openai/gpt-oss-20b",
        "llama-3.3-70b-versatile"
      ]
    });

    assert.equal(prompt.closed, true);
    assert.deepEqual(savedConfig, {
      provider: "groq",
      apiKey: "gsk_fixture",
      model: "llama-3.3-70b-versatile"
    });
    assert.deepEqual(prompt.selections, ["AI provider", "Groq model"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("interactive init stores the OpenRouter model selected by the user", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-openrouter-test-"));
  const prompt = createFakePrompt(
    ["sk-or-fixture", "anthropic/claude-3.5-haiku"],
    ["openrouter"]
  );
  let savedConfig: DevmapConfig | null = null;
  let validatedKey = "";

  try {
    await initCommand({
      projectRoot,
      prompt,
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async (config) => {
        savedConfig = config;
      },
      validateApiKey: async (apiKey) => {
        validatedKey = apiKey;
      }
    });

    assert.equal(validatedKey, "sk-or-fixture");
    assert.deepEqual(savedConfig, {
      provider: "openrouter",
      apiKey: "sk-or-fixture",
      model: "anthropic/claude-3.5-haiku"
    });
    assert.deepEqual(prompt.selections, ["AI provider"]);
    assert.ok(prompt.questions.some((question) => /OpenRouter model/i.test(question)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("interactive OpenRouter init defaults to the free router on Enter", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-openrouter-free-test-"));
  const prompt = createFakePrompt(["sk-or-fixture", ""], ["openrouter"]);
  let savedConfig: DevmapConfig | null = null;

  try {
    await initCommand({
      projectRoot,
      prompt,
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async (config) => {
        savedConfig = config;
      },
      validateApiKey: async () => undefined
    });

    assert.deepEqual(savedConfig, {
      provider: "openrouter",
      apiKey: "sk-or-fixture",
      model: "openrouter/free"
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("non-interactive init explains how to provide an API key", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-key-test-"));

  try {
    await assert.rejects(
      initCommand({
        projectRoot,
        isInteractive: false,
        loadConfig: async () => null,
        persistConfig: async () => undefined,
        validateApiKey: async () => undefined
      }),
      (error: unknown) => error instanceof DevmapError
        && /API key is required/.test(error.message)
        && error.hint?.includes("GROQ_API_KEY") === true
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("global error handler returns an exit code without exposing stack output", () => {
  const logs: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;

  console.error = (...values: unknown[]) => logs.push(values.join(" "));
  console.log = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    const exitCode = handleError(new DevmapError("Readable failure.", "Try the safe command."));
    const output = logs.join("\n");

    assert.equal(exitCode, 1);
    assert.match(output, /Readable failure/);
    assert.match(output, /Try the safe command/);
    assert.doesNotMatch(output, /\sat\s.*\(/);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("global error handler translates missing paths into actionable output", () => {
  const logs: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  const missingPathError = Object.assign(new Error("internal ENOENT details"), {
    code: "ENOENT"
  });

  console.error = (...values: unknown[]) => logs.push(values.join(" "));
  console.log = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    assert.equal(handleError(missingPathError), 1);

    const output = logs.join("\n");
    assert.match(output, /project path could not be found/i);
    assert.match(output, /Check the path/i);
    assert.doesNotMatch(output, /internal ENOENT details/);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("global error handler emits parseable JSON for machine output", () => {
  const logs: string[] = [];
  const originalLog = console.log;

  console.log = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    assert.equal(
      handleError(new DevmapError("Readable failure.", "Use doctor."), true),
      1
    );
    assert.deepEqual(JSON.parse(logs.join("\n")), {
      status: "error",
      error: "Readable failure.",
      hint: "Use doctor."
    });
  } finally {
    console.log = originalLog;
  }
});

type FakePrompt = Prompt & {
  closed: boolean;
  questions: string[];
  selections: string[];
};

function createFakePrompt(answers: string[], selectedValues: string[] = []): FakePrompt {
  let index = 0;
  let selectionIndex = 0;

  return {
    closed: false,
    questions: [],
    selections: [],
    async ask(question: string): Promise<string> {
      this.questions.push(question);
      const answer = answers[index] ?? "";
      index += 1;
      return answer;
    },
    async select<T extends string>(
      question: string,
      options: Array<{ label: string; value: T }>
    ): Promise<T> {
      this.selections.push(question);
      const selected = selectedValues[selectionIndex] as T | undefined;
      selectionIndex += 1;
      return selected ?? options[0]!.value;
    },
    close(): void {
      this.closed = true;
    }
  };
}

function restoreEnvironment(name: "HOME" | "USERPROFILE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
