import { resolve } from "node:path";
import {
  readConfig,
  writeConfig,
  writeLocalConfig,
  type DevmapConfig
} from "../utils/config.js";
import { PROVIDERS } from "../ai/registry.js";
import { output, withJsonOutput } from "../utils/output.js";

export type ConfigDependencies = {
  json?: boolean;
  local?: boolean;
  projectRoot?: string;
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

  const descriptor = PROVIDERS[config.provider];
  const autoRouting = descriptor.supportsAutoModel
    ? descriptor.resolveAutoModel?.("analyze")
    : undefined;
  const resolvedModel = autoRouting && autoRouting.fallbackModels.length === 0
    ? autoRouting.model
    : undefined;

  if (dependencies.local) {
    const projectRoot = resolve(dependencies.projectRoot ?? process.cwd());
    await writeLocalConfig(projectRoot, { model: selectedModel });

    output.success(
      `Project model override set to ${selectedModel} (.devmap/config.local.json).`
    );

    return {
      status: "ok",
      scope: "local",
      provider: config.provider,
      model: selectedModel,
      automaticRouting: selectedModel === "auto",
      ...(selectedModel === "auto" && resolvedModel
        ? { resolvedModel }
        : {})
    };
  }

  await persistConfig({
    ...config,
    model: selectedModel
  });

  output.success(
    selectedModel === "auto"
      ? resolvedModel
        ? `Restored ${descriptor.displayName} free model routing (${resolvedModel}).`
        : "Restored automatic command-based model routing."
      : `Default model override set to ${selectedModel}.`
  );

  return {
    status: "ok",
    provider: config.provider,
    model: selectedModel,
    automaticRouting: selectedModel === "auto",
    ...(selectedModel === "auto" && resolvedModel
      ? { resolvedModel }
      : {})
  };
}
