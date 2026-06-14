import {
  readConfig,
  writeConfig,
  type DevmapConfig
} from "../utils/config.js";
import { output } from "../utils/output.js";

export type ConfigDependencies = {
  loadConfig?: () => Promise<DevmapConfig | null>;
  persistConfig?: (config: DevmapConfig) => Promise<void>;
};

export async function configModelCommand(
  model: string,
  dependencies: ConfigDependencies = {}
): Promise<void> {
  const selectedModel = model.trim();
  if (!selectedModel) {
    output.error("Model name cannot be empty.");
    return;
  }

  const loadConfig = dependencies.loadConfig ?? readConfig;
  const persistConfig = dependencies.persistConfig ?? writeConfig;
  const config = await loadConfig();

  if (!config) {
    output.error("DevMap is not configured yet.");
    output.note("Run devmap init before changing the model.");
    return;
  }

  await persistConfig({
    ...config,
    model: selectedModel
  });

  output.success(
    selectedModel === "auto"
      ? "Restored automatic command-based model routing."
      : `Default model override set to ${selectedModel}.`
  );
}
