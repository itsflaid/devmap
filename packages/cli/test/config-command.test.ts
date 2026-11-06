import assert from "node:assert/strict";
import test from "node:test";
import { configKeyCommand, configModelCommand } from "../src/commands/config.js";
import { DevmapError } from "../src/utils/errors.js";
import type { DevmapConfig } from "../src/utils/config.js";

function persist<T>(ref: { value: T | null }) {
  return async (config: T) => { ref.value = config; };
}

test("config model updates the model while preserving Groq credentials", async () => {
  const current: DevmapConfig = {
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "auto"
  };
  const saved: { value: DevmapConfig | null } = { value: null };

  await configModelCommand("openai/gpt-oss-120b", {
    loadConfig: async () => current,
    persistConfig: persist(saved)
  });

  assert.deepEqual(saved.value, {
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
  const saved: { value: DevmapConfig | null } = { value: null };

  await configModelCommand("auto", {
    loadConfig: async () => current,
    persistConfig: persist(saved)
  });

  assert.ok(saved.value);
  assert.equal(saved.value.model, "auto");
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
  assert.match(logs, /Run devmap config key/i);
});

test("config model auto explains OpenRouter free routing", async () => {
  const saved: { value: DevmapConfig | null } = { value: null };
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
      persistConfig: persist(saved)
    });

    assert.ok(saved.value);
    assert.equal(saved.value.model, "auto");
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

test("config key creates a keyed config on first use and validates before saving", async () => {
  const saved: { value: DevmapConfig | null } = { value: null };
  let validatedWith = "";

  await configKeyCommand("gsk_new", {
    environment: {},
    loadConfig: async () => null,
    persistConfig: persist(saved),
    validateApiKey: async (key, provider) => {
      validatedWith = `${provider}:${key}`;
    }
  });

  assert.equal(validatedWith, "groq:gsk_new");
  assert.deepEqual(saved.value, { provider: "groq", model: "auto", apiKey: "gsk_new" });
});

test("config key replaces the key and keeps provider and model", async () => {
  const saved: { value: DevmapConfig | null } = { value: null };

  await configKeyCommand("sk-or-new", {
    environment: {},
    loadConfig: async () => ({ provider: "openrouter", apiKey: "sk-or-old", model: "openrouter/free" }),
    persistConfig: persist(saved),
    validateApiKey: async () => undefined
  });

  assert.deepEqual(saved.value, { provider: "openrouter", apiKey: "sk-or-new", model: "openrouter/free" });
});

test("config key reads the key from the provider environment variable", async () => {
  const saved: { value: DevmapConfig | null } = { value: null };

  await configKeyCommand(undefined, {
    environment: { GROQ_API_KEY: "gsk_env" },
    loadConfig: async () => null,
    persistConfig: persist(saved),
    validateApiKey: async () => undefined
  });

  assert.equal(saved.value?.apiKey, "gsk_env");
});

test("config key does not save a key that fails validation", async () => {
  let persisted = false;

  await assert.rejects(
    configKeyCommand("bad", {
      environment: {},
      loadConfig: async () => null,
      persistConfig: async () => {
        persisted = true;
      },
      validateApiKey: async () => {
        throw new DevmapError("Invalid key.");
      }
    }),
    DevmapError
  );
  assert.equal(persisted, false);
});

test("config key fails clearly without a key when there is no terminal", async () => {
  await assert.rejects(
    configKeyCommand(undefined, {
      environment: {},
      isInteractive: false,
      loadConfig: async () => null,
      persistConfig: async () => undefined
    }),
    (error: unknown) => error instanceof DevmapError && /GROQ_API_KEY/.test(error.hint ?? "")
  );
});
