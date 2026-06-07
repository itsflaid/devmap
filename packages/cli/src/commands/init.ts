import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { scanFiles } from "../analyzers/fileScanner.js";
import { detectFramework } from "../analyzers/frameworkDetector.js";
import { validateGroqApiKey } from "../ai/groq.js";
import { readConfig, writeConfig, type DevmapConfig } from "../utils/config.js";
import { ensureDevmapFile } from "../utils/devmapFile.js";
import { DevmapError } from "../utils/errors.js";
import { ensureDevmapIgnored } from "../utils/gitignore.js";
import { output } from "../utils/output.js";
import { createPrompt, type Prompt } from "../utils/prompt.js";

export type InitDependencies = {
  projectRoot?: string;
  prompt?: Prompt;
  validateApiKey?: (apiKey: string) => Promise<void>;
  isInteractive?: boolean;
  environmentApiKey?: string;
  loadConfig?: () => Promise<DevmapConfig | null>;
  persistConfig?: (config: DevmapConfig) => Promise<void>;
};

export async function initCommand(dependencies: InitDependencies = {}): Promise<void> {
  const projectRoot = resolve(dependencies.projectRoot ?? process.cwd());
  const interactive = dependencies.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
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

    output.keyValue("Project", framework);
    output.success("Config saved to ~/.devmap/config.json");
    output.success(ignored ? "Added .devmap/ to .gitignore" : ".devmap/ already ignored");
    output.success(devmapFileCreated ? "Created DEVMAP.md" : "DEVMAP.md already exists");
    output.step("Next: devmap analyze");
  } finally {
    prompt?.close();
  }
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
