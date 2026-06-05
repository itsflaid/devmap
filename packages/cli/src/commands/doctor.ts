import { existsSync } from "node:fs";
import { readConfig, getConfigPath } from "../utils/config.js";
import { getSnapshotPath } from "../cache/snapshot.js";
import { output } from "../utils/output.js";

export async function doctorCommand(): Promise<void> {
  const config = await readConfig();

  output.section("DevMap Doctor");
  output.keyValue("Node.js", process.version);
  output.keyValue("Provider", config?.provider ?? "not configured");
  output.keyValue("API key", config?.apiKey ? "set" : "not set");
  output.keyValue("Config", existsSync(getConfigPath()) ? "exists" : "missing");
  output.keyValue("Snapshot", existsSync(getSnapshotPath(process.cwd())) ? "exists" : "missing");

  if (!config) {
    output.warning("Run devmap init to create ~/.devmap/config.json");
  } else if (!config.apiKey) {
    output.warning("Groq API key is not set yet. Add it before Phase 2 AI commands.");
  } else {
    output.success("Base configuration looks ready");
  }
}
