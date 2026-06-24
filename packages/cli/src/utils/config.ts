import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DevmapConfig = {
  provider: "groq" | "openrouter";
  apiKey?: string;
  model: "auto" | string;
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

  if (provider !== "groq" && provider !== "openrouter") {
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

  return config;
}
