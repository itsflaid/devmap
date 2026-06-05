import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DevmapConfig = {
  provider: "groq";
  apiKey?: string;
  model: "auto" | string;
};

export function getConfigPath(): string {
  return join(homedir(), ".devmap", "config.json");
}

export async function readConfig(): Promise<DevmapConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    return JSON.parse(raw) as DevmapConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: DevmapConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
