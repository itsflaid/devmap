import type { DevmapConfig } from "../utils/config.js";
import { DevmapError } from "../utils/errors.js";
import type { AiClient } from "./types.js";
import { PROVIDERS } from "./registry.js";

export type AiTask = "analyze" | "flowNarration" | "explain";
export type ProviderInspection = { reachable: true; modelAvailable: boolean };

export function createAiClient(config: DevmapConfig): AiClient {
  const descriptor = PROVIDERS[config.provider];
  if (descriptor.requiresBaseUrl && !config.baseUrl?.trim()) {
    throw new DevmapError(
      `${descriptor.displayName} requires an endpoint base URL.`,
      "Run devmap init and set the base URL of your OpenAI-compatible endpoint."
    );
  }
  return descriptor.createClient(config.apiKey ?? "", config.baseUrl);
}

export function resolveAiRouting(
  config: DevmapConfig,
  task: AiTask
): { model: string; fallbackModels: readonly string[] } {
  if (config.model !== "auto") {
    return { model: config.model, fallbackModels: [] };
  }

  const descriptor = PROVIDERS[config.provider];
  const resolved = descriptor.supportsAutoModel
    ? descriptor.resolveAutoModel?.(task)
    : undefined;

  if (!resolved) {
    throw new DevmapError(
      `${descriptor.displayName} doesn't support automatic model selection.`,
      "Run devmap init and choose a model explicitly."
    );
  }

  return resolved;
}

export function providerDisplayName(provider: DevmapConfig["provider"]): string {
  return PROVIDERS[provider].displayName;
}

export function inspectAiProvider(
  config: DevmapConfig,
  model: string
): Promise<ProviderInspection> {
  const descriptor = PROVIDERS[config.provider];
  return descriptor.inspect(config.apiKey ?? "", model, config.baseUrl);
}
