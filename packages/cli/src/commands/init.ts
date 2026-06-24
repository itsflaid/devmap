import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { listGroqModels, validateGroqApiKey } from "../ai/groq.js";
import {
  OPENROUTER_FREE_MODEL,
  validateOpenRouterApiKey
} from "../ai/openrouter.js";
import { providerDisplayName } from "../ai/provider.js";
import { readConfig, writeConfig, type DevmapConfig } from "../utils/config.js";
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
    provider: DevmapConfig["provider"]
  ) => Promise<void>;
  listGroqModels?: (apiKey: string) => Promise<string[]>;
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
    const providerName = providerDisplayName(provider);
    const environmentApiKey = dependencies.environmentApiKey
      ?? (provider === "openrouter"
        ? dependencies.environmentOpenRouterApiKey ?? process.env.OPENROUTER_API_KEY
        : process.env.GROQ_API_KEY);
    const validateApiKey = dependencies.validateApiKey
      ?? ((key: string, selectedProvider: DevmapConfig["provider"]) => (
        selectedProvider === "openrouter"
          ? validateOpenRouterApiKey(key)
          : validateGroqApiKey(key)
      ));
    output.keyValue("Provider", providerName);

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
    await validateApiKey(apiKey, provider);
    output.success(`${providerName} API key is valid`);

    const model = await resolveInitialModel({
      provider,
      apiKey,
      prompt,
      interactive,
      existingConfig,
      listModels: dependencies.listGroqModels ?? listGroqModels
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
      model
    });

    const ignored = await ensureDevmapIgnored(projectRoot);
    const devmapFileCreated = await ensureDevmapFile(projectRoot);
    const agentsResult = await ensureAgentsFile(projectRoot, appendToExistingAgents);

    output.success("Config saved to ~/.devmap/config.json");
    if (provider === "openrouter") {
      output.note(`OpenRouter model: ${model}`);
      output.note("Change it later with: devmap config model <model-id>");
    } else if (model !== "auto") {
      output.note(`Groq model: ${model}`);
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
  provider: DevmapConfig["provider"];
};

async function resolveApiKey(options: ResolveApiKeyOptions): Promise<string> {
  if (options.environmentApiKey?.trim()) {
    return options.environmentApiKey.trim();
  }

  if (!options.interactive || !options.prompt) {
    if (options.existingApiKey?.trim()) {
      return options.existingApiKey.trim();
    }

    throw new DevmapError(
      `An ${providerDisplayName(options.provider)} API key is required to initialize DevMap.`,
      `Run devmap init in an interactive terminal or set ${readProviderEnvName(options.provider)}.`
    );
  }

  const providerName = providerDisplayName(options.provider);
  const keyPrompt = options.existingApiKey
    ? `${providerName} API key [press Enter to keep existing]: `
    : `${providerName} API key: `;
  const answer = (await options.prompt.ask(keyPrompt)).trim();
  const apiKey = answer || options.existingApiKey?.trim();

  if (!apiKey) {
    throw new DevmapError(
      `An ${providerName} API key is required.`,
      options.provider === "openrouter"
        ? "Create one at https://openrouter.ai/keys."
        : "Create one at https://console.groq.com/keys."
    );
  }

  return apiKey;
}

async function resolveProvider(
  prompt: Prompt | null,
  interactive: boolean,
  existingConfig: DevmapConfig | null
): Promise<DevmapConfig["provider"]> {
  if (!interactive || !prompt) {
    if (existingConfig) return existingConfig.provider;
    return process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY
      ? "openrouter"
      : "groq";
  }

  return prompt.select("AI provider", [
    { label: "Groq", value: "groq" },
    { label: "OpenRouter", value: "openrouter" }
  ], existingConfig?.provider ?? "groq");
}

type ResolveInitialModelOptions = {
  provider: DevmapConfig["provider"];
  apiKey: string;
  prompt: Prompt | null;
  interactive: boolean;
  existingConfig: DevmapConfig | null;
  listModels: (apiKey: string) => Promise<string[]>;
};

async function resolveInitialModel(
  options: ResolveInitialModelOptions
): Promise<string> {
  if (options.provider === "groq") {
    const existingModel = options.existingConfig?.provider === "groq"
      ? options.existingConfig.model
      : undefined;
    if (!options.interactive || !options.prompt) return existingModel ?? "auto";

    const models = await options.listModels(options.apiKey);
    if (models.length === 0) {
      throw new DevmapError(
        "Groq did not return any available models.",
        "Try again shortly or run devmap doctor."
      );
    }

    const defaultModel = existingModel && models.includes(existingModel)
      ? existingModel
      : models[0]!;
    return options.prompt.select(
      "Groq model",
      models.map((model) => ({ label: model, value: model })),
      defaultModel
    );
  }

  const existingModel = options.existingConfig?.provider === "openrouter"
    ? options.existingConfig.model
    : undefined;
  const defaultModel = existingModel && existingModel !== "auto"
    ? existingModel
    : OPENROUTER_FREE_MODEL;
  if (!options.interactive || !options.prompt) return defaultModel;

  const answer = await options.prompt.ask(
    `OpenRouter model [${defaultModel}]: `
  );
  return answer.trim() || defaultModel;
}

function readProviderEnvName(provider: DevmapConfig["provider"]): string {
  return provider === "openrouter" ? "OPENROUTER_API_KEY" : "GROQ_API_KEY";
}
