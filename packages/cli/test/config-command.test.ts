import assert from "node:assert/strict";
import test from "node:test";
import { configModelCommand } from "../src/commands/config.js";
import type { DevmapConfig } from "../src/utils/config.js";

test("config model updates the model while preserving Groq credentials", async () => {
  const current: DevmapConfig = {
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "auto"
  };
  let saved: DevmapConfig | null = null;

  await configModelCommand("openai/gpt-oss-120b", {
    loadConfig: async () => current,
    persistConfig: async (config) => {
      saved = config;
    }
  });

  assert.deepEqual(saved, {
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "openai/gpt-oss-120b"
  });
});

test("config model accepts auto to restore command-based routing", async () => {
  const current: DevmapConfig = {
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "openai/gpt-oss-120b"
  };
  let saved: DevmapConfig | null = null;

  await configModelCommand("auto", {
    loadConfig: async () => current,
    persistConfig: async (config) => {
      saved = config;
    }
  });

  assert.equal(saved?.model, "auto");
});

test("config model requires an existing initialized config", async () => {
  let persisted = false;
  const logs = await captureOutput(() => configModelCommand(
    "llama-3.1-8b-instant",
    {
      loadConfig: async () => null,
      persistConfig: async () => {
        persisted = true;
      }
    }
  ));

  assert.equal(persisted, false);
  assert.match(logs, /Run devmap init/i);
});

test("config model auto explains OpenRouter free routing", async () => {
  let saved: DevmapConfig | null = null;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => logs.push(values.join(" "));

  try {
    await configModelCommand("auto", {
      loadConfig: async () => ({
        provider: "openrouter",
        apiKey: "sk-or-fixture",
        model: "qwen/qwen3-coder"
      }),
      persistConfig: async (config) => {
        saved = config;
      }
    });

    assert.equal(saved?.model, "auto");
    assert.match(logs.join("\n"), /openrouter\/free/i);
  } finally {
    console.log = originalLog;
  }
});

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
