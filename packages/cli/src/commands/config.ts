import { resolve } from "node:path";
import {
  readConfig,
  writeConfig,
  writeLocalConfig,
  type DevmapConfig,
  type DevmapProvider
} from "../utils/config.js";
import { PROVIDERS } from "../ai/registry.js";
import { DevmapError } from "../utils/errors.js";
import { output, withJsonOutput } from "../utils/output.js";
import { createPrompt, type Prompt } from "../utils/prompt.js";

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
    output.note("Run devmap config key before changing the model.");
    return {
      status: "error",
      error: "DevMap is not configured yet.",
      hint: "Run devmap config key before changing the model."
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

export type ConfigKeyDependencies = ConfigDependencies & {
  provider?: DevmapProvider;
  prompt?: Prompt;
  isInteractive?: boolean;
  environment?: NodeJS.ProcessEnv;
  validateApiKey?: (
    apiKey: string,
    provider: DevmapProvider,
    baseUrl?: string
  ) => Promise<void>;
};

export async function configKeyCommand(
  apiKey: string | undefined,
  dependencies: ConfigKeyDependencies = {}
): Promise<void> {
  if (dependencies.json) {
    await withJsonOutput(async () => {
      output.json(await updateKey(apiKey, dependencies));
    });
    return;
  }

  await updateKey(apiKey, dependencies);
}

async function updateKey(
  apiKeyArgument: string | undefined,
  dependencies: ConfigKeyDependencies
): Promise<Record<string, unknown>> {
  const environment = dependencies.environment ?? process.env;
  const loadConfig = dependencies.loadConfig ?? readConfig;
  const persistConfig = dependencies.persistConfig ?? writeConfig;
  const existing = await loadConfig();

  const provider: DevmapProvider = dependencies.provider
    ?? existing?.provider
    ?? (environment.OPENROUTER_API_KEY && !environment.GROQ_API_KEY ? "openrouter" : "groq");
  const descriptor = PROVIDERS[provider];
  const base = existing?.provider === provider ? existing : undefined;

  if (descriptor.requiresBaseUrl && !base?.baseUrl) {
    throw new DevmapError(
      `${descriptor.displayName} needs a base URL before it can take a key.`,
      "Run devmap init in an interactive terminal to set the endpoint."
    );
  }

  let apiKey = apiKeyArgument?.trim() || environment[descriptor.envVarName]?.trim() || "";
  if (!apiKey) {
    const interactive = dependencies.prompt
      ? true
      : dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

    if (!interactive) {
      throw new DevmapError(
        `No ${descriptor.displayName} API key was given.`,
        `Pass it as an argument or set ${descriptor.envVarName}.`
      );
    }

    const prompt = dependencies.prompt ?? createPrompt();
    try {
      apiKey = (await prompt.ask(`${descriptor.displayName} API key: `)).trim();
    } finally {
      if (!dependencies.prompt) prompt.close();
    }

    if (!apiKey) {
      throw new DevmapError(
        `No ${descriptor.displayName} API key was given.`,
        descriptor.apiKeyHintUrl
          ? `Create one at ${descriptor.apiKeyHintUrl}.`
          : `Set ${descriptor.envVarName} or pass the key as an argument.`
      );
    }
  }

  const validate = dependencies.validateApiKey
    ?? ((key: string, selected: DevmapProvider, baseUrl?: string) =>
      PROVIDERS[selected].inspect(key, undefined, baseUrl).then(() => undefined));

  output.step(`Validating ${descriptor.displayName} API key`);
  await validate(apiKey, provider, base?.baseUrl);
  output.success(`${descriptor.displayName} API key is valid`);

  await persistConfig({
    ...(base ?? { provider, model: "auto" }),
    apiKey
  });
  output.success("API key saved to ~/.devmap/config.json");

  return {
    status: "ok",
    provider,
    model: (base ?? { model: "auto" }).model
  };
}
