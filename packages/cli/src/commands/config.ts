import {
  readConfig,
  writeConfig,
  type DevmapConfig
} from "../utils/config.js";
import { output, withJsonOutput } from "../utils/output.js";

export type ConfigDependencies = {
  json?: boolean;
  loadConfig?: () => Promise<DevmapConfig | null>;
  persistConfig?: (config: DevmapConfig) => Promise<void>;
};

export async function configModelCommand(
  model: string,
  dependencies: ConfigDependencies = {}
): Promise<void> {
  if (dependencies.json) {
    await withJsonOutput(async () => {
      output.json(await updateModel(model, dependencies));
    });
    return;
  }

  await updateModel(model, dependencies);
}

async function updateModel(
  model: string,
  dependencies: ConfigDependencies
): Promise<Record<string, unknown>> {
  const selectedModel = model.trim();
  if (!selectedModel) {
    output.error("Model name cannot be empty.");
    return { status: "error", error: "Model name cannot be empty." };
  }

  const loadConfig = dependencies.loadConfig ?? readConfig;
  const persistConfig = dependencies.persistConfig ?? writeConfig;
  const config = await loadConfig();

  if (!config) {
    output.error("DevMap is not configured yet.");
    output.note("Run devmap init before changing the model.");
    return {
      status: "error",
      error: "DevMap is not configured yet.",
      hint: "Run devmap init before changing the model."
    };
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

  return {
    status: "ok",
    provider: config.provider,
    model: selectedModel,
    automaticRouting: selectedModel === "auto"
  };
}
