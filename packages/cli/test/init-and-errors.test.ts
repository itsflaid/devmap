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
  const content = buildDevmapFile("nextjs");

  assert.match(content, /Detected framework: nextjs/);
  assert.match(content, /devmap analyze/);
  assert.match(content, /Guidance For AI Agents/);
  assert.match(content, /\.devmap\/snapshot\.json/);
  assert.match(content, /Never commit API keys/);
});

test("DEVMAP.md is not overwritten when it already exists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-file-test-"));

  try {
    assert.equal(await ensureDevmapFile(projectRoot, "express"), true);
    assert.equal(await ensureDevmapFile(projectRoot, "nextjs"), false);

    const content = await readFile(join(projectRoot, "DEVMAP.md"), "utf8");
    assert.match(content, /Detected framework: express/);
    assert.doesNotMatch(content, /Detected framework: nextjs/);
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
    assert.match(await readFile(join(projectRoot, "DEVMAP.md"), "utf8"), /Detected framework: Not detected yet/);
    assert.match(await readFile(join(projectRoot, "AGENTS.md"), "utf8"), /DevMap Context/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("interactive init appends DevMap instructions only after confirmation", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-agents-confirm-test-"));
  const original = "# Existing Instructions\n\nKeep this content.\n";

  try {
    await writeFile(join(projectRoot, "AGENTS.md"), original, "utf8");

    await initCommand({
      projectRoot,
      prompt: createFakePrompt(["", "gsk_fixture", "yes"]),
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined
    });

    const content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    assert.ok(content.startsWith(original));
    assert.match(content, /<!-- DevMap Instruction Block -->/);
    assert.match(content, /read `DEVMAP\.md` first/);
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
      prompt: createFakePrompt(["", "gsk_fixture", "no"]),
      isInteractive: true,
      loadConfig: async () => null,
      persistConfig: async () => undefined,
      validateApiKey: async () => undefined
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
  } finally {
    restoreEnvironment("HOME", originalHome);
    restoreEnvironment("USERPROFILE", originalUserProfile);
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("interactive init rejects unsupported providers without persisting config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-init-provider-test-"));
  let persisted = false;
  const prompt = createFakePrompt(["openai"]);

  try {
    await assert.rejects(
      initCommand({
        projectRoot,
        prompt,
        isInteractive: true,
        loadConfig: async () => null,
        persistConfig: async () => {
          persisted = true;
        },
        validateApiKey: async () => undefined
      }),
      (error: unknown) => error instanceof DevmapError && /not available/.test(error.message)
    );

    assert.equal(prompt.closed, true);
    assert.equal(persisted, false);
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

type FakePrompt = Prompt & {
  closed: boolean;
};

function createFakePrompt(answers: string[]): FakePrompt {
  let index = 0;

  return {
    closed: false,
    async ask(): Promise<string> {
      const answer = answers[index] ?? "";
      index += 1;
      return answer;
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
