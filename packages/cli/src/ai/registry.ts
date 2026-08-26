import type { AiClient } from "./types.js";
import {
  DEFAULT_AI_FALLBACKS,
  DEFAULT_AI_MODELS,
  GroqClient,
  inspectGroqProvider,
  listGroqModels
} from "./groq.js";
import {
  inspectOpenRouterProvider,
  OpenRouterClient,
  OPENROUTER_FREE_MODEL
} from "./openrouter.js";
import {
  CustomProviderClient,
  inspectCustomProvider,
  listCustomModels
} from "./custom.js";

export type ProviderId = "groq" | "openrouter" | "custom";

export type ProviderDescriptor = {
  id: ProviderId;
  displayName: string;
  envVarName: string;
  requiresBaseUrl: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  apiKeyHintUrl?: string;
  supportsAutoModel: boolean;
  resolveAutoModel?: (
    task: "analyze" | "flowNarration" | "explain"
  ) => { model: string; fallbackModels: readonly string[] };
  createClient: (apiKey: string, baseUrl?: string) => AiClient;
  listModels?: (apiKey: string, baseUrl?: string) => Promise<string[]>;
  inspect: (
    apiKey: string,
    model: string | undefined,
    baseUrl?: string
  ) => Promise<{ reachable: true; modelAvailable: boolean }>;
};

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  groq: {
    id: "groq",
    displayName: "Groq",
    envVarName: "GROQ_API_KEY",
    requiresBaseUrl: false,
    supportsAutoModel: true,
    apiKeyHintUrl: "https://console.groq.com/keys",
    resolveAutoModel: (task) => ({
      model: DEFAULT_AI_MODELS[task],
      fallbackModels: DEFAULT_AI_FALLBACKS[task]
    }),
    createClient: (apiKey) => new GroqClient(apiKey),
    listModels: (apiKey) => listGroqModels(apiKey),
    inspect: (apiKey, model) => inspectGroqProvider(apiKey, model)
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    envVarName: "OPENROUTER_API_KEY",
    requiresBaseUrl: false,
    supportsAutoModel: true,
    defaultModel: OPENROUTER_FREE_MODEL,
    apiKeyHintUrl: "https://openrouter.ai/keys",
    resolveAutoModel: () => ({
      model: OPENROUTER_FREE_MODEL,
      fallbackModels: []
    }),
    createClient: (apiKey) => new OpenRouterClient(apiKey),
    inspect: (apiKey, model) => inspectOpenRouterProvider(apiKey, model)
  },
  custom: {
    id: "custom",
    displayName: "Custom (OpenAI-compatible)",
    envVarName: "CUSTOM_API_KEY",
    requiresBaseUrl: true,
    defaultBaseUrl: "http://localhost:20128/v1",
    supportsAutoModel: false,
    createClient: (apiKey, baseUrl) => new CustomProviderClient(apiKey, baseUrl ?? ""),
    listModels: (apiKey, baseUrl) => listCustomModels(apiKey, baseUrl ?? ""),
    inspect: (apiKey, model, baseUrl) => inspectCustomProvider(apiKey, baseUrl ?? "", model)
  }
};
