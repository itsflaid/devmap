import { DevmapError } from "../utils/errors.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult,
  AiDeltaHandler
} from "./types.js";
import {
  normalizeUsage,
  parseSseStream,
  readCompletionPayload,
  type PayloadUnreadableMessages,
  type StreamInterruptedMessages
} from "./openaiCompatibleStream.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/auth/key";
export const OPENROUTER_FREE_MODEL = "openrouter/free";

function unreadableResponseError(): DevmapError {
  return new DevmapError(
    "OpenRouter returned an unreadable response.",
    "Try again shortly or choose another model."
  );
}

const OPENROUTER_PAYLOAD_MESSAGES: PayloadUnreadableMessages = {
  unreadable: unreadableResponseError
};

const OPENROUTER_STREAM_MESSAGES: StreamInterruptedMessages = {
  missingBody: unreadableResponseError,
  unreadable: unreadableResponseError,
  interrupted: unreadableResponseError
};

export type OpenRouterClientDependencies = {
  fetch?: typeof fetch;
};

export type OpenRouterProviderInspection = {
  reachable: true;
  modelAvailable: boolean;
};

export class OpenRouterClient implements AiClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly apiKey: string,
    dependencies: OpenRouterClientDependencies = {}
  ) {
    this.fetchImplementation = dependencies.fetch ?? fetch;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await this.sendRequest(request, false);
    if (!response.ok) throw await mapOpenRouterResponseError(response);

    const payload = await readCompletionPayload(response, OPENROUTER_PAYLOAD_MESSAGES);
    const content = payload.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new DevmapError(
        "OpenRouter returned an empty response.",
        "Try again or choose another model."
      );
    }

    return {
      content,
      model: payload.model || request.model,
      ...(payload.usage ? { usage: normalizeUsage(payload.usage) } : {})
    };
  }

  async stream(
    request: AiCompletionRequest,
    onDelta: AiDeltaHandler
  ): Promise<AiCompletionResult> {
    const response = await this.sendRequest(request, true);
    if (!response.ok) throw await mapOpenRouterResponseError(response);

    const payload = await parseSseStream(
      response,
      request.model,
      onDelta,
      { messages: OPENROUTER_STREAM_MESSAGES }
    );
    if (!payload.content.trim()) {
      throw new DevmapError(
        "OpenRouter returned an empty response.",
        "Try again or choose another model."
      );
    }
    return {
      content: payload.content.trim(),
      model: payload.model,
      ...(payload.usage ? { usage: payload.usage } : {})
    };
  }

  private async sendRequest(
    request: AiCompletionRequest,
    stream: boolean
  ): Promise<Response> {
    const models = resolveModels(request);
    try {
      return await this.fetchImplementation(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/itsflaid/devmap",
          "X-OpenRouter-Title": "DevMap"
        },
        body: JSON.stringify({
          ...(models.length > 1 ? { models } : { model: models[0] }),
          messages: request.messages,
          max_tokens: request.maxCompletionTokens ?? 1200,
          temperature: request.temperature ?? 0.2,
          ...(stream ? { stream: true } : {})
        })
      });
    } catch {
      throw new DevmapError(
        "Could not connect to OpenRouter.",
        "Check your internet connection and run devmap doctor."
      );
    }
  }
}

export async function validateOpenRouterApiKey(
  apiKey: string,
  dependencies: OpenRouterClientDependencies = {}
): Promise<void> {
  await inspectOpenRouterProvider(apiKey, undefined, dependencies);
}

export async function inspectOpenRouterProvider(
  apiKey: string,
  _model?: string,
  dependencies: OpenRouterClientDependencies = {}
): Promise<OpenRouterProviderInspection> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
  } catch {
    throw new DevmapError(
      "Could not connect to OpenRouter.",
      "Check your internet connection and run devmap init again."
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The OpenRouter API key is invalid.",
      "Create or copy a valid key from https://openrouter.ai/keys."
    );
  }
  if (!response.ok) {
    throw new DevmapError(
      `OpenRouter validation failed with HTTP ${response.status}.`,
      "Try again shortly or check https://openrouter.ai/status."
    );
  }

  return { reachable: true, modelAvailable: true };
}

function resolveModels(request: AiCompletionRequest): string[] {
  return Array.from(new Set([
    request.model,
    ...(request.fallbackModels ?? []),
    ...(request.fallbackModel ? [request.fallbackModel] : [])
  ].filter((model) => model.trim().length > 0)));
}

async function mapOpenRouterResponseError(response: Response): Promise<DevmapError> {
  if (response.status === 401 || response.status === 403) {
    return new DevmapError(
      "The OpenRouter API key is invalid or no longer authorized.",
      "Run devmap init again with a valid OpenRouter API key."
    );
  }
  if (response.status === 429) {
    return new DevmapError(
      "OpenRouter rate limit reached.",
      "Wait briefly or choose another model."
    );
  }
  if (response.status >= 500) {
    return new DevmapError(
      "OpenRouter is temporarily unavailable.",
      "Try again shortly or check https://openrouter.ai/status."
    );
  }
  return new DevmapError(
    `OpenRouter could not complete the request (HTTP ${response.status}).`,
    "Run devmap doctor and verify the selected model."
  );
}
