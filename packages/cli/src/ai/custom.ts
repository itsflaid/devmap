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
  readCompletionPayload
} from "./openaiCompatibleStream.js";

const CUSTOM_PAYLOAD_MESSAGES = {
  unreadable: () => new DevmapError(
    "The custom endpoint returned an unreadable response.",
    "Verify the base URL points to an OpenAI-compatible API and try again."
  )
};

const CUSTOM_STREAM_MESSAGES = {
  missingBody: () => new DevmapError(
    "The custom endpoint returned an unreadable streaming response.",
    "Verify the base URL points to an OpenAI-compatible API and try again."
  ),
  unreadable: () => new DevmapError(
    "The custom endpoint returned an unreadable streaming response.",
    "Verify the base URL points to an OpenAI-compatible API and try again."
  ),
  interrupted: () => new DevmapError(
    "The custom endpoint response stream ended unexpectedly.",
    "Check that the server is running correctly and try again."
  )
};

export type CustomProviderClientDependencies = {
  fetch?: typeof fetch;
};

export type CustomProviderInspection = {
  reachable: true;
  modelAvailable: boolean;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function unreachableEndpointError(): DevmapError {
  return new DevmapError(
    "Could not connect to the configured endpoint.",
    "Check the base URL and that the server is running."
  );
}

export class CustomProviderClient implements AiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    dependencies: CustomProviderClientDependencies = {}
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImplementation = dependencies.fetch ?? fetch;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await this.sendRequest(request, false);
    if (!response.ok) throw await mapCustomResponseError(response);

    const payload = await readCompletionPayload(response, CUSTOM_PAYLOAD_MESSAGES);
    const content = payload.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new DevmapError(
        "The custom endpoint returned an empty response.",
        "Try again or choose another model on the endpoint."
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
    if (!response.ok) throw await mapCustomResponseError(response);

    const payload = await parseSseStream(
      response,
      request.model,
      onDelta,
      { messages: CUSTOM_STREAM_MESSAGES }
    );
    if (!payload.content.trim()) {
      throw new DevmapError(
        "The custom endpoint returned an empty response.",
        "Try again or choose another model on the endpoint."
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
    try {
      return await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_completion_tokens: request.maxCompletionTokens ?? 1200,
          temperature: request.temperature ?? 0.2,
          ...(stream ? {
            stream: true,
            stream_options: { include_usage: true }
          } : {})
        })
      });
    } catch {
      throw unreachableEndpointError();
    }
  }
}

export async function listCustomModels(
  apiKey: string,
  baseUrl: string,
  dependencies: Pick<CustomProviderClientDependencies, "fetch"> = {}
): Promise<string[]> {
  const response = await fetchCustomModels(apiKey, baseUrl, dependencies);
  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The custom endpoint rejected the API key.",
      "Check the key configured for the endpoint and run devmap init again."
    );
  }

  if (!response.ok) {
    throw new DevmapError(
      `Custom model lookup failed with HTTP ${response.status}.`,
      "Check the base URL and that the server is running."
    );
  }

  return readModelIds(response);
}

export async function inspectCustomProvider(
  apiKey: string,
  baseUrl: string,
  model?: string,
  dependencies: Pick<CustomProviderClientDependencies, "fetch"> = {}
): Promise<CustomProviderInspection> {
  const response = await fetchCustomModels(apiKey, baseUrl, dependencies);

  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The custom endpoint rejected the API key.",
      "Check the key configured for the endpoint and run devmap init again."
    );
  }

  if (!response.ok) {
    throw new DevmapError(
      `Custom endpoint validation failed with HTTP ${response.status}.`,
      "Check the base URL and that the server is running."
    );
  }

  const modelIds = await readModelIds(response);
  return {
    reachable: true,
    modelAvailable: !model || modelIds.includes(model)
  };
}

async function fetchCustomModels(
  apiKey: string,
  baseUrl: string,
  dependencies: Pick<CustomProviderClientDependencies, "fetch"> = {}
): Promise<Response> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const normalizedBase = normalizeBaseUrl(baseUrl);

  try {
    return await fetchImplementation(`${normalizedBase}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
  } catch {
    throw unreachableEndpointError();
  }
}

async function readModelIds(response: Response): Promise<string[]> {
  try {
    const payload = await response.json() as {
      data?: Array<{ id?: unknown }>;
    };

    return (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string")
      .sort((a, b) => a.localeCompare(b));
  } catch {
    throw new DevmapError(
      "The custom endpoint returned an unreadable model list.",
      "Verify the base URL points to an OpenAI-compatible API and try again."
    );
  }
}

async function mapCustomResponseError(response: Response): Promise<DevmapError> {
  if (response.status === 401 || response.status === 403) {
    return new DevmapError(
      "The custom endpoint rejected the API key.",
      "Check the key configured for the endpoint and run devmap init again."
    );
  }
  if (response.status === 429) {
    return new DevmapError(
      "Custom endpoint rate limit reached.",
      "Wait briefly or choose another model on the endpoint."
    );
  }
  if (response.status >= 500) {
    return new DevmapError(
      "The custom endpoint is temporarily unavailable.",
      "Check that the server is running and try again shortly."
    );
  }
  return new DevmapError(
    `The custom endpoint could not complete the request (HTTP ${response.status}).`,
    "Run devmap doctor and verify the selected model."
  );
}
