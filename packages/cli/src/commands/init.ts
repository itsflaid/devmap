import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { scanFiles } from "../analyzers/fileScanner.js";
import { detectFramework } from "../analyzers/frameworkDetector.js";
import { validateGroqApiKey } from "../ai/groq.js";
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

export type InitDependencies = {
  json?: boolean;
  projectRoot?: string;
  prompt?: Prompt;
  validateApiKey?: (apiKey: string) => Promise<void>;
  isInteractive?: boolean;
  environmentApiKey?: string;
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
  const environmentApiKey = dependencies.environmentApiKey ?? process.env.GROQ_API_KEY;
  const validateApiKey = dependencies.validateApiKey ?? validateGroqApiKey;
  const prompt = dependencies.prompt ?? (interactive ? createPrompt() : null);

  output.section("DevMap Init");
  output.keyValue("Provider", "Groq");

  try {
    const apiKey = await resolveApiKey({
      prompt,
      interactive,
      environmentApiKey,
      existingApiKey: existingConfig?.apiKey
    });

    output.step("Validating Groq API key");
    await validateApiKey(apiKey);
    output.success("Groq API key is valid");

    const agentsStatus = await inspectAgentsFile(projectRoot);
    const appendToExistingAgents = agentsStatus === "existing"
      && interactive
      && prompt
      ? isAffirmative(await prompt.ask(
        "AGENTS.md exists. Append DevMap instructions? [y/N]: "
      ))
      : false;

    const files = await scanFiles(projectRoot);
    const framework = detectFramework(files);

    await mkdir(resolve(projectRoot, ".devmap"), { recursive: true });
    await persistConfig({
      provider: "groq",
      apiKey,
      model: "auto"
    });

    const ignored = await ensureDevmapIgnored(projectRoot);
    const devmapFileCreated = await ensureDevmapFile(projectRoot, framework);
    const agentsResult = await ensureAgentsFile(projectRoot, appendToExistingAgents);

    output.keyValue("Project", framework);
    output.success("Config saved to ~/.devmap/config.json");
    output.success(ignored ? "Added .devmap/ to .gitignore" : ".devmap/ already ignored");
    output.success(devmapFileCreated ? "Created DEVMAP.md" : "DEVMAP.md already exists");
    printAgentsResult(agentsResult);
    output.step("Next: devmap analyze");
    return {
      status: "ok",
      provider: "groq",
      model: "auto",
      framework,
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
      "A Groq API key is required to initialize DevMap.",
      "Run devmap init in an interactive terminal or set GROQ_API_KEY."
    );
  }

  const provider = (await options.prompt.ask("Provider [groq]: ")).trim().toLowerCase();
  if (provider && provider !== "groq") {
    throw new DevmapError(
      `Provider "${provider}" is not available in the MVP.`,
      "Press Enter to use Groq."
    );
  }

  const keyPrompt = options.existingApiKey
    ? "Groq API key [press Enter to keep existing]: "
    : "Groq API key: ";
  const answer = (await options.prompt.ask(keyPrompt)).trim();
  const apiKey = answer || options.existingApiKey?.trim();

  if (!apiKey) {
    throw new DevmapError(
      "A Groq API key is required.",
      "Create one at https://console.groq.com/keys."
    );
  }

  return apiKey;
}
