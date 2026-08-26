import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { output } from "./output.js";

export type DevmapProvider = "groq" | "openrouter" | "custom";

export type DevmapConfig = {
  provider: DevmapProvider;
  apiKey?: string;
  model: "auto" | string;
  baseUrl?: string;
};

export type LocalDevmapConfig = {
  model?: string;
};

export function getConfigPath(): string {
  return join(homedir(), ".devmap", "config.json");
}

export async function readConfig(): Promise<DevmapConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeConfig(parsed);
  } catch {
    return null;
  }
}

export async function writeConfig(config: DevmapConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getLocalConfigPath(projectRoot: string): string {
  return join(projectRoot, ".devmap", "config.local.json");
}

export async function readLocalConfig(
  projectRoot: string
): Promise<LocalDevmapConfig | null> {
  try {
    const raw = await readFile(getLocalConfigPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    if ("apiKey" in record || "provider" in record) {
      output.warning(
        "config.local.json only supports \"model\", apiKey/provider are always read from the global config and were ignored here."
      );
    }

    return typeof record.model === "string"
      ? { model: record.model }
      : null;
  } catch {
    return null;
  }
}

export async function writeLocalConfig(
  projectRoot: string,
  config: LocalDevmapConfig
): Promise<void> {
  const configPath = getLocalConfigPath(projectRoot);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export type ConfigReaders = {
  readGlobal?: () => Promise<DevmapConfig | null>;
  readLocal?: (projectRoot: string) => Promise<LocalDevmapConfig | null>;
};

export async function resolveEffectiveConfig(
  projectRoot: string,
  readers: ConfigReaders = {}
): Promise<DevmapConfig | null> {
  const global = await (readers.readGlobal ?? readConfig)();
  if (!global) return null;

  const local = await (readers.readLocal ?? readLocalConfig)(projectRoot);
  return local?.model ? { ...global, model: local.model } : global;
}

function normalizeConfig(value: unknown): DevmapConfig | null {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const provider = record.provider === undefined
    ? "groq"
    : record.provider;
  const model = record.model === undefined
    ? "auto"
    : record.model;

  if (provider !== "groq" && provider !== "openrouter" && provider !== "custom") {
    return null;
  }

  if (typeof model !== "string") {
    return null;
  }

  const config: DevmapConfig = {
    provider,
    model
  };

  if (record.apiKey !== undefined) {
    if (typeof record.apiKey !== "string") {
      return null;
    }
    config.apiKey = record.apiKey;
  }

  if (provider === "custom") {
    if (typeof record.baseUrl !== "string" || record.baseUrl.trim().length === 0) {
      return null;
    }
    config.baseUrl = record.baseUrl.trim();
  } else if (typeof record.baseUrl === "string") {
    if (record.baseUrl.trim().length === 0) {
      return null;
    }
    config.baseUrl = record.baseUrl.trim();
  }

  return config;
}
