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
    return isDevmapConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeConfig(config: DevmapConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function isDevmapConfig(value: unknown): value is DevmapConfig {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "provider" in value
    && (value.provider === "groq" || value.provider === "openrouter")
    && "model" in value
    && typeof value.model === "string"
  );
}
