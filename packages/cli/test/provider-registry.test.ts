import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CustomProviderClient
} from "../src/ai/custom.js";
import { GroqClient } from "../src/ai/groq.js";
import { OpenRouterClient, OPENROUTER_FREE_MODEL } from "../src/ai/openrouter.js";
import {
  createAiClient,
  providerDisplayName,
  resolveAiRouting
} from "../src/ai/provider.js";
import { PROVIDERS, type ProviderId } from "../src/ai/registry.js";
import { getConfigPath, readConfig } from "../src/utils/config.js";
import { DevmapError } from "../src/utils/errors.js";

test("provider registry exposes every supported provider in menu order", () => {
  assert.deepEqual(
    Object.values(PROVIDERS).map((descriptor) => descriptor.id),
    ["groq", "openrouter", "custom"] satisfies ProviderId[]
  );
});

test("registry descriptors carry provider metadata", () => {
  assert.equal(PROVIDERS.groq.envVarName, "GROQ_API_KEY");
  assert.equal(PROVIDERS.groq.supportsAutoModel, true);
  assert.equal(PROVIDERS.openrouter.defaultModel, OPENROUTER_FREE_MODEL);
  assert.equal(PROVIDERS.openrouter.requiresBaseUrl, false);
  assert.equal(PROVIDERS.custom.displayName, "Custom (OpenAI-compatible)");
  assert.equal(PROVIDERS.custom.envVarName, "CUSTOM_API_KEY");
  assert.equal(PROVIDERS.custom.requiresBaseUrl, true);
  assert.equal(PROVIDERS.custom.defaultBaseUrl, "http://localhost:20128/v1");
  assert.equal(PROVIDERS.custom.supportsAutoModel, false);
});

test("registry creates the matching client for each provider", () => {
  assert.ok(createAiClient({
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "auto"
  }) instanceof GroqClient);

  assert.ok(createAiClient({
    provider: "openrouter",
    apiKey: "sk-or-fixture",
    model: OPENROUTER_FREE_MODEL
  }) instanceof OpenRouterClient);

  assert.ok(createAiClient({
    provider: "custom",
    apiKey: "custom-key-fixture",
    baseUrl: "http://localhost:20128/v1",
    model: "qwen3-coder-30b"
  }) instanceof CustomProviderClient);
});

test("custom clients require a base URL before creation", () => {
  assert.throws(
    () => createAiClient({
      provider: "custom",
      apiKey: "custom-key-fixture",
      model: "qwen3-coder-30b"
    }),
    (error: unknown) => error instanceof DevmapError
      && /requires an endpoint base URL/i.test(error.message)
  );
});

test("automatic routing resolves per provider and rejects unsupported providers", () => {
  const groqRouting = resolveAiRouting({
    provider: "groq",
    apiKey: "gsk_fixture",
    model: "auto"
  }, "analyze");
  assert.equal(groqRouting.model.length > 0, true);
  assert.equal(groqRouting.fallbackModels.length > 0, true);

  const openRouterRouting = resolveAiRouting({
    provider: "openrouter",
    apiKey: "sk-or-fixture",
    model: "auto"
  }, "analyze");
  assert.deepEqual(openRouterRouting, {
    model: OPENROUTER_FREE_MODEL,
    fallbackModels: []
  });

  assert.throws(
    () => resolveAiRouting({
      provider: "custom",
      apiKey: "custom-key-fixture",
      baseUrl: "http://localhost:20128/v1",
      model: "auto"
    }, "analyze"),
    (error: unknown) => error instanceof DevmapError
      && /doesn't support automatic model selection/i.test(error.message)
      && /choose a model explicitly/i.test(error.hint ?? "")
  );

  const explicitCustomRouting = resolveAiRouting({
    provider: "custom",
    apiKey: "custom-key-fixture",
    baseUrl: "http://localhost:20128/v1",
    model: "qwen3-coder-30b"
  }, "analyze");
  assert.deepEqual(explicitCustomRouting, {
    model: "qwen3-coder-30b",
    fallbackModels: []
  });
});

test("provider display names come from the registry", () => {
  assert.equal(providerDisplayName("groq"), "Groq");
  assert.equal(providerDisplayName("openrouter"), "OpenRouter");
  assert.equal(providerDisplayName("custom"), "Custom (OpenAI-compatible)");
});

test("config normalization accepts custom providers only with a base URL", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "devmap-custom-config-test-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.HOME = temporaryHome;
    process.env.USERPROFILE = temporaryHome;
    const configPath = getConfigPath();
    await mkdir(join(temporaryHome, ".devmap"), { recursive: true });

    await writeFile(configPath, JSON.stringify({
      provider: "custom",
      apiKey: "custom-key-fixture",
      model: "qwen3-coder-30b"
    }), "utf8");
    assert.equal(await readConfig(), null);

    await writeFile(configPath, JSON.stringify({
      provider: "custom",
      apiKey: "custom-key-fixture",
      model: "qwen3-coder-30b",
      baseUrl: "  http://localhost:20128/v1  "
    }), "utf8");

    const config = await readConfig();
    assert.deepEqual(config, {
      provider: "custom",
      apiKey: "custom-key-fixture",
      model: "qwen3-coder-30b",
      baseUrl: "http://localhost:20128/v1"
    });
  } finally {
    restoreEnvironment("HOME", originalHome);
    restoreEnvironment("USERPROFILE", originalUserProfile);
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

function restoreEnvironment(name: "HOME" | "USERPROFILE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
