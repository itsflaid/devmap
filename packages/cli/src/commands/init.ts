import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PROVIDERS, type ProviderDescriptor } from "../ai/registry.js";
import {
  readConfig,
  writeConfig,
  type DevmapConfig,
  type DevmapProvider
} from "../utils/config.js";
import {
  ensureAgentsFile,
  inspectAgentsFile,
  type AgentsFileResult
} from "../utils/agentsFile.js";
import { ensureDevmapFile } from "../utils/devmapFile.js";
import { DevmapError } from "../utils/errors.js";
import { ensureDevmapIgnored } from "../utils/gitignore.js";
import { output, withJsonOutput } from "../utils/output.js";
import { createPrompt, type Prompt } from "../utils/prompt.js";
import { renderWelcomeBrandPanel } from "../utils/welcome.js";

export type InitDependencies = {
  json?: boolean;
  projectRoot?: string;
  prompt?: Prompt;
  validateApiKey?: (
    apiKey: string,
    provider: DevmapProvider,
    baseUrl?: string
  ) => Promise<void>;
  listModels?: (apiKey: string, baseUrl?: string) => Promise<string[]>;
  isInteractive?: boolean;
  environmentApiKey?: string;
  environmentOpenRouterApiKey?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  persistConfig?: (config: DevmapConfig) => Promise<void>;
};

export async function initCommand(dependencies: InitDependencies = {}): Promise<void> {
  if (dependencies.json) {
    await withJsonOutput(async () => {
      output.json(await runInit(dependencies));
    });
    return;
  }

  await runInit(dependencies);
}

async function runInit(
  dependencies: InitDependencies
): Promise<Record<string, unknown>> {
  const projectRoot = resolve(dependencies.projectRoot ?? process.cwd());
  const interactive = dependencies.json
    ? false
    : dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const loadConfig = dependencies.loadConfig ?? readConfig;
  const persistConfig = dependencies.persistConfig ?? writeConfig;
  const existingConfig = await loadConfig();
  const prompt = dependencies.prompt ?? (interactive ? createPrompt() : null);

  if (!dependencies.json) {
    console.log(renderWelcomeBrandPanel(process.stdout.columns ?? 80));
    console.log("");
  }

  output.section("DevMap Init");

  try {
    const provider = await resolveProvider(prompt, interactive, existingConfig);
    const descriptor = PROVIDERS[provider];
    const providerName = descriptor.displayName;
    const baseUrl = await resolveBaseUrl({
      descriptor,
      prompt,
      interactive,
      existingBaseUrl: existingConfig?.provider === provider
        ? existingConfig.baseUrl
        : undefined
    });
    let environmentApiKey = dependencies.environmentApiKey;
    if (!environmentApiKey) {
      environmentApiKey = descriptor.envVarName === "OPENROUTER_API_KEY"
        ? dependencies.environmentOpenRouterApiKey ?? process.env.OPENROUTER_API_KEY
        : process.env[descriptor.envVarName];
    }
    const validateApiKey = dependencies.validateApiKey
      ?? ((key: string, selectedProvider: DevmapProvider, selectedBaseUrl?: string) => (
        PROVIDERS[selectedProvider].inspect(key, undefined, selectedBaseUrl)
          .then(() => undefined)
      ));
    output.keyValue("Provider", providerName);
    if (baseUrl) {
      output.keyValue("Base URL", baseUrl);
    }

    const apiKey = await resolveApiKey({
      prompt,
      interactive,
      environmentApiKey,
      existingApiKey: existingConfig?.provider === provider
        ? existingConfig.apiKey
        : undefined,
      provider
    });

    output.step(`Validating ${providerName} API key`);
    await validateApiKey(apiKey, provider, baseUrl);
    output.success(`${providerName} API key is valid`);

    const model = await resolveInitialModel({
      provider,
      baseUrl,
      apiKey,
      prompt,
      interactive,
      existingConfig,
      listModels: dependencies.listModels
    });

    const agentsStatus = await inspectAgentsFile(projectRoot);
    const appendToExistingAgents = agentsStatus === "existing"
      && interactive
      && prompt
      ? isAffirmative(await prompt.ask(
        "AGENTS.md exists. Append DevMap instructions? [y/N]: "
      ))
      : false;

    await mkdir(resolve(projectRoot, ".devmap"), { recursive: true });
    await persistConfig({
      provider,
      apiKey,
      model,
      ...(baseUrl ? { baseUrl } : {})
    });

    const ignored = await ensureDevmapIgnored(projectRoot);
    const devmapFileCreated = await ensureDevmapFile(projectRoot);
    const agentsResult = await ensureAgentsFile(projectRoot, appendToExistingAgents);

    output.success("Config saved to ~/.devmap/config.json");
    if (model !== "auto") {
      output.note(`${providerName} model: ${model}`);
      output.note("Change it later with: devmap config model <model-id>");
    }
    output.success(ignored ? "Added .devmap/ to .gitignore" : ".devmap/ already ignored");
    output.success(devmapFileCreated ? "Created DEVMAP.md" : "DEVMAP.md already exists");
    printAgentsResult(agentsResult);
    output.step("Next: devmap analyze");

    return {
      status: "ok",
      provider,
      model,
      files: {
        gitignoreUpdated: ignored,
        devmapFileCreated,
        agentsFile: agentsResult
      },
      next: "devmap analyze"
    };
  } finally {
    prompt?.close();
  }
}

function isAffirmative(answer: string): boolean {
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

function printAgentsResult(result: AgentsFileResult): void {
  if (result === "created") {
    output.success("Created AGENTS.md");
    return;
  }

  if (result === "appended") {
    output.success("Added DevMap instructions to AGENTS.md");
    return;
  }

  if (result === "unchanged") {
    output.success("AGENTS.md already includes DevMap context");
    return;
  }

  output.warning("Skipped AGENTS.md update; run devmap init interactively to confirm.");
}

type ResolveApiKeyOptions = {
  prompt: Prompt | null;
  interactive: boolean;
  environmentApiKey?: string;
  existingApiKey?: string;
  provider: DevmapProvider;
};

async function resolveApiKey(options: ResolveApiKeyOptions): Promise<string> {
  if (options.environmentApiKey?.trim()) {
    return options.environmentApiKey.trim();
  }

  const descriptor = PROVIDERS[options.provider];
  const providerName = descriptor.displayName;

  if (!options.interactive || !options.prompt) {
    if (options.existingApiKey?.trim()) {
      return options.existingApiKey.trim();
    }

    throw new DevmapError(
      `An ${providerName} API key is required to initialize DevMap.`,
      `Run devmap init in an interactive terminal or set ${descriptor.envVarName}.`
    );
  }

  const keyPrompt = options.existingApiKey
    ? `${providerName} API key [press Enter to keep existing]: `
    : `${providerName} API key: `;
  const answer = (await options.prompt.ask(keyPrompt)).trim();
  const apiKey = answer || options.existingApiKey?.trim();

  if (!apiKey) {
    throw new DevmapError(
      `An ${providerName} API key is required.`,
      descriptor.apiKeyHintUrl
        ? `Create one at ${descriptor.apiKeyHintUrl}.`
        : `Set ${descriptor.envVarName} or create a key in your endpoint's console.`
    );
  }

  return apiKey;
}

type ResolveBaseUrlOptions = {
  descriptor: ProviderDescriptor;
  prompt: Prompt | null;
  interactive: boolean;
  existingBaseUrl?: string;
};

async function resolveBaseUrl(
  options: ResolveBaseUrlOptions
): Promise<string | undefined> {
  const { descriptor } = options;
  if (!descriptor.requiresBaseUrl) {
    return undefined;
  }

  const prefill = options.existingBaseUrl?.trim()
    || descriptor.defaultBaseUrl
    || "";

  if (!options.interactive || !options.prompt) {
    if (prefill) {
      return prefill;
    }

    throw new DevmapError(
      `A base URL is required for ${descriptor.displayName}.`,
      "Run devmap init in an interactive terminal."
    );
  }

  const answer = (await options.prompt.ask(`Endpoint base URL [${prefill}]: `)).trim();
  const baseUrl = answer || prefill;

  if (!baseUrl) {
    throw new DevmapError(
      `A base URL is required for ${descriptor.displayName}.`,
      "Enter the root URL of your OpenAI-compatible endpoint, e.g. http://localhost:20128/v1."
    );
  }

  return baseUrl;
}

async function resolveProvider(
  prompt: Prompt | null,
  interactive: boolean,
  existingConfig: DevmapConfig | null
): Promise<DevmapProvider> {
  if (!interactive || !prompt) {
    if (existingConfig) return existingConfig.provider;
    return process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY
      ? "openrouter"
      : "groq";
  }

  return prompt.select("AI provider",
    Object.values(PROVIDERS).map((descriptor) => ({
      label: descriptor.displayName,
      value: descriptor.id
    })),
    existingConfig?.provider ?? "groq"
  );
}

type ResolveInitialModelOptions = {
  provider: DevmapProvider;
  apiKey: string;
  baseUrl?: string;
  prompt: Prompt | null;
  interactive: boolean;
  existingConfig: DevmapConfig | null;
  listModels?: (apiKey: string, baseUrl?: string) => Promise<string[]>;
};

async function resolveInitialModel(
  options: ResolveInitialModelOptions
): Promise<string> {
  const descriptor = PROVIDERS[options.provider];
  const existingModel = options.existingConfig?.provider === options.provider
    ? options.existingConfig.model
    : undefined;

  if (!options.interactive || !options.prompt) {
    if (!descriptor.supportsAutoModel && (!existingModel || existingModel === "auto")) {
      throw new DevmapError(
        `${descriptor.displayName} requires an explicit model.`,
        "Run devmap init in an interactive terminal, or set one first with: devmap config model <model-id>"
      );
    }
    return existingModel ?? "auto";
  }

  const fetchModels = descriptor.listModels
    ? async (apiKey: string, baseUrl?: string) => (
        options.listModels
          ? options.listModels(apiKey, baseUrl)
          : descriptor.listModels!(apiKey, baseUrl)
      )
    : undefined;

  if (fetchModels) {
    const models = await fetchModels(options.apiKey, options.baseUrl);
    if (models.length === 0) {
      throw new DevmapError(
        `${descriptor.displayName} did not return any available models.`,
        "Try again shortly or run devmap doctor."
      );
    }

    const defaultModel = existingModel && models.includes(existingModel)
      ? existingModel
      : models[0]!;
    return options.prompt.select(
      `${descriptor.displayName} model`,
      models.map((model) => ({ label: model, value: model })),
      defaultModel
    );
  }

  const fallbackDefault = descriptor.defaultModel ?? "auto";
  const defaultModel = existingModel && existingModel !== "auto"
    ? existingModel
    : fallbackDefault;
  const answer = await options.prompt.ask(
    `${descriptor.displayName} model [${defaultModel}]: `
  );
  return answer.trim() || defaultModel;
}
