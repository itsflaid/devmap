import type { DevmapConfig } from "../utils/config.js";
import type { AiClient } from "./types.js";
import {
  DEFAULT_AI_FALLBACKS,
  DEFAULT_AI_MODELS,
  GroqClient,
  inspectGroqProvider
} from "./groq.js";
import {
  inspectOpenRouterProvider,
  OpenRouterClient,
  OPENROUTER_FREE_MODEL
} from "./openrouter.js";

export type AiTask = "ask" | "analyze" | "deepAnalyze";
export type ProviderInspection = { reachable: true; modelAvailable: boolean };

export function createAiClient(config: DevmapConfig): AiClient {
  return config.provider === "openrouter"
    ? new OpenRouterClient(config.apiKey ?? "")
    : new GroqClient(config.apiKey ?? "");
}

export function resolveAiRouting(
  config: DevmapConfig,
  task: AiTask
): { model: string; fallbackModels: readonly string[] } {
  if (config.model !== "auto") {
    return { model: config.model, fallbackModels: [] };
  }

  if (config.provider === "openrouter") {
    return { model: OPENROUTER_FREE_MODEL, fallbackModels: [] };
  }

  return {
    model: DEFAULT_AI_MODELS[task],
    fallbackModels: DEFAULT_AI_FALLBACKS[task]
  };
}

export function providerDisplayName(provider: DevmapConfig["provider"]): string {
  return provider === "openrouter" ? "OpenRouter" : "Groq";
}

export function inspectAiProvider(
  provider: DevmapConfig["provider"],
  apiKey: string,
  model: string
): Promise<ProviderInspection> {
  return provider === "openrouter"
    ? inspectOpenRouterProvider(apiKey, model)
    : inspectGroqProvider(apiKey, model);
}
