import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configModelCommand } from "../src/commands/config.js";
import {
  getLocalConfigPath,
  readLocalConfig,
  resolveEffectiveConfig,
  writeLocalConfig,
  type DevmapConfig
} from "../src/utils/config.js";

const globalConfig: DevmapConfig = {
  provider: "groq",
  apiKey: "gsk_fixture",
  model: "auto"
};

test("config model --local writes a project-local config with only model", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-config-local-"));

  try {
    await configModelCommand("qwen/qwen3.6-27b", {
      local: true,
      projectRoot,
      loadConfig: async () => globalConfig,
      persistConfig: async () => {
        throw new Error("global config must not be written in local mode");
      }
    });

    const raw = JSON.parse(
      await readFile(getLocalConfigPath(projectRoot), "utf8")
    );
    assert.deepEqual(raw, { model: "qwen/qwen3.6-27b" });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveEffectiveConfig merges the local model over the global config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-effective-local-"));

  try {
    await writeLocalConfig(projectRoot, { model: "local-override-model" });

    const effective = await resolveEffectiveConfig(projectRoot, {
      readGlobal: async () => globalConfig
    });

    assert.equal(effective?.model, "local-override-model");
    assert.equal(effective?.provider, "groq");
    assert.equal(effective?.apiKey, "gsk_fixture");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveEffectiveConfig returns the global config when no local override exists", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-effective-global-"));

  try {
    const effective = await resolveEffectiveConfig(projectRoot, {
      readGlobal: async () => globalConfig
    });

    assert.equal(effective?.model, "auto");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("resolveEffectiveConfig returns null when global config is missing", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-effective-null-"));

  try {
    await writeLocalConfig(projectRoot, { model: "local-override-model" });

    const effective = await resolveEffectiveConfig(projectRoot, {
      readGlobal: async () => null
    });

    assert.equal(effective, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("readLocalConfig ignores apiKey/provider fields and warns once", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-local-warn-"));

  try {
    await mkdir(join(projectRoot, ".devmap"), { recursive: true });
    await writeFile(
      getLocalConfigPath(projectRoot),
      JSON.stringify({
        model: "local-override-model",
        apiKey: "should-be-ignored",
        provider: "openrouter"
      }),
      "utf8"
    );

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.join(" "));

    try {
      const local = await readLocalConfig(projectRoot);
      assert.deepEqual(local, { model: "local-override-model" });
    } finally {
      console.log = originalLog;
    }

    const warnings = logs.join("\n").match(
      /config\.local\.json only supports "model"/g
    );
    assert.equal(warnings?.length, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("readLocalConfig returns null when model is not a string", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "devmap-local-invalid-"));

  try {
    await mkdir(join(projectRoot, ".devmap"), { recursive: true });
    await writeFile(
      getLocalConfigPath(projectRoot),
      JSON.stringify({ model: 42 }),
      "utf8"
    );

    const local = await readLocalConfig(projectRoot);
    assert.equal(local, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
