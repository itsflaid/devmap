import { DevmapError } from "../utils/errors.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult,
  AiDeltaHandler,
  AiTokenUsage
} from "./types.js";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_RATE_LIMIT_DELAY_MS = 1000;
const MAX_RATE_LIMIT_DELAY_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 3;

export const DEFAULT_AI_MODELS = {
  ask: "llama-3.1-8b-instant",
  analyze: "openai/gpt-oss-20b",
  deepAnalyze: "openai/gpt-oss-120b",
  fallback: "openai/gpt-oss-20b"
} as const;

export type GroqClientDependencies = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type GroqProviderInspection = {
  reachable: true;
  modelAvailable: boolean;
};

export class GroqClient implements AiClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    dependencies: GroqClientDependencies = {}
  ) {
    this.fetchImplementation = dependencies.fetch ?? fetch;
    this.sleep = dependencies.sleep ?? wait;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const primaryResult = await this.requestModel(request, request.model);

    if (primaryResult.ok) {
      return primaryResult.result;
    }

    if (
      primaryResult.modelUnavailable
      && request.fallbackModel
      && request.fallbackModel !== request.model
    ) {
      const fallbackResult = await this.requestModel(request, request.fallbackModel);
      if (fallbackResult.ok) {
        return fallbackResult.result;
      }

      throw fallbackResult.error;
    }

    throw primaryResult.error;
  }

  async stream(
    request: AiCompletionRequest,
    onDelta: AiDeltaHandler
  ): Promise<AiCompletionResult> {
    const primaryResult = await this.requestModelStream(
      request,
      request.model,
      onDelta
    );

    if (primaryResult.ok) {
      return primaryResult.result;
    }

    if (
      primaryResult.modelUnavailable
      && request.fallbackModel
      && request.fallbackModel !== request.model
    ) {
      const fallbackResult = await this.requestModelStream(
        request,
        request.fallbackModel,
        onDelta
      );
      if (fallbackResult.ok) {
        return fallbackResult.result;
      }

      throw fallbackResult.error;
    }

    throw primaryResult.error;
  }

  private async requestModel(
    request: AiCompletionRequest,
    model: string
  ): Promise<GroqRequestResult> {
    const response = await this.sendWithRateLimitRetries(request, model, false);

    if (!response.ok) {
      return readFailedRequest(response);
    }

    const payload = await readCompletionPayload(response);
    const content = payload.choices[0]?.message?.content?.trim();

    if (!content) {
      return emptyResponseResult();
    }

    return {
      ok: true,
      result: {
        content,
        model: payload.model || model,
        ...(payload.usage ? { usage: normalizeUsage(payload.usage) } : {})
      }
    };
  }

  private async requestModelStream(
    request: AiCompletionRequest,
    model: string,
    onDelta: AiDeltaHandler
  ): Promise<GroqRequestResult> {
    const response = await this.sendWithRateLimitRetries(request, model, true);

    if (!response.ok) {
      return readFailedRequest(response);
    }

    const payload = await readCompletionStream(response, model, onDelta);
    if (!payload.content.trim()) {
      return emptyResponseResult();
    }

    return {
      ok: true,
      result: {
        content: payload.content.trim(),
        model: payload.model,
        ...(payload.usage ? { usage: payload.usage } : {})
      }
    };
  }

  private async sendWithRateLimitRetries(
    request: AiCompletionRequest,
    model: string,
    stream: boolean
  ): Promise<Response> {
    let response = await this.sendRequest(request, model, stream);

    for (
      let retryAttempt = 0;
      response.status === 429 && retryAttempt < MAX_RATE_LIMIT_RETRIES;
      retryAttempt += 1
    ) {
      const delay = Math.min(
        readRetryDelay(response) * (2 ** retryAttempt),
        MAX_RATE_LIMIT_DELAY_MS
      );
      await this.sleep(delay);
      response = await this.sendRequest(request, model, stream);
    }

    return response;
  }

  private async sendRequest(
    request: AiCompletionRequest,
    model: string,
    stream = false
  ): Promise<Response> {
    try {
      return await this.fetchImplementation(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
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
      throw new DevmapError(
        "Could not connect to Groq.",
        "Check your internet connection and run devmap doctor."
      );
    }
  }
}

export async function validateGroqApiKey(apiKey: string): Promise<void> {
  await inspectGroqProvider(apiKey);
}

export async function inspectGroqProvider(
  apiKey: string,
  model?: string,
  dependencies: Pick<GroqClientDependencies, "fetch"> = {}
): Promise<GroqProviderInspection> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  let response: Response;

  try {
    response = await fetchImplementation(GROQ_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
  } catch {
    throw new DevmapError(
      "Could not connect to Groq.",
      "Check your internet connection and run devmap init again."
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The Groq API key is invalid.",
      "Create or copy a valid key from https://console.groq.com/keys."
    );
  }

  if (!response.ok) {
    throw new DevmapError(
      `Groq validation failed with HTTP ${response.status}.`,
      "Try again shortly or check https://status.groq.com."
    );
  }

  const modelIds = await readModelIds(response);
  return {
    reachable: true,
    modelAvailable: !model || modelIds.includes(model)
  };
}

type GroqCompletionPayload = {
  model?: string;
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type GroqStreamPayload = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: GroqCompletionPayload["usage"];
  x_groq?: {
    usage?: GroqCompletionPayload["usage"];
  };
};

type GroqRequestResult =
  | { ok: true; result: AiCompletionResult }
  | { ok: false; modelUnavailable: boolean; error: DevmapError };

async function readFailedRequest(response: Response): Promise<GroqRequestResult> {
  const providerMessage = await readProviderError(response);
  return {
    ok: false,
    modelUnavailable: isModelUnavailable(response.status, providerMessage),
    error: mapGroqError(response.status, providerMessage)
  };
}

function emptyResponseResult(): GroqRequestResult {
  return {
    ok: false,
    modelUnavailable: false,
    error: new DevmapError(
      "Groq returned an empty response.",
      "Try the question again or run devmap doctor."
    )
  };
}

async function readCompletionPayload(response: Response): Promise<GroqCompletionPayload> {
  try {
    const payload = await response.json() as Partial<GroqCompletionPayload>;
    return {
      model: payload.model,
      choices: Array.isArray(payload.choices) ? payload.choices : [],
      usage: payload.usage
    };
  } catch {
    throw new DevmapError(
      "Groq returned an unreadable response.",
      "Try again shortly or check https://status.groq.com."
    );
  }
}

async function readProviderError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as {
      error?: { message?: unknown };
    };
    return typeof payload.error?.message === "string"
      ? payload.error.message
      : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function readCompletionStream(
  response: Response,
  requestedModel: string,
  onDelta: AiDeltaHandler
): Promise<{
  content: string;
  model: string;
  usage?: AiTokenUsage;
}> {
  if (!response.body) {
    throw new DevmapError(
      "Groq returned an unreadable streaming response.",
      "Try again shortly or run devmap doctor."
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model = requestedModel;
  let usage: AiTokenUsage | undefined;

  const consumeEvent = (event: string): boolean => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (!data) return false;
    if (data.trim() === "[DONE]") return true;

    let payload: GroqStreamPayload;
    try {
      payload = JSON.parse(data) as GroqStreamPayload;
    } catch {
      throw new DevmapError(
        "Groq returned an unreadable streaming response.",
        "Try again shortly or check https://status.groq.com."
      );
    }

    model = payload.model || model;
    const delta = payload.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      onDelta(delta);
    }

    const rawUsage = payload.usage ?? payload.x_groq?.usage;
    if (rawUsage) {
      usage = normalizeUsage(rawUsage);
    }

    return false;
  };

  try {
    let done = false;
    while (!done) {
      const readResult = await reader.read();
      buffer += decoder.decode(readResult.value, { stream: !readResult.done });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        if (consumeEvent(event)) {
          done = true;
          break;
        }
      }

      if (readResult.done) {
        if (!done && buffer.trim()) {
          consumeEvent(buffer);
        }
        break;
      }
    }
  } catch (error) {
    if (error instanceof DevmapError) {
      throw error;
    }

    throw new DevmapError(
      "The Groq response stream ended unexpectedly.",
      "Try again or run devmap doctor if the problem continues."
    );
  }

  return {
    content,
    model,
    ...(usage ? { usage } : {})
  };
}

function mapGroqError(status: number, providerMessage: string): DevmapError {
  if (status === 401 || status === 403) {
    return new DevmapError(
      "The Groq API key is invalid or no longer authorized.",
      "Run devmap init again with a valid Groq API key."
    );
  }

  if (status === 429) {
    return new DevmapError(
      "Groq rate limit reached after retrying.",
      "Wait briefly, ask a narrower question, or try again later."
    );
  }

  if (status >= 500) {
    return new DevmapError(
      "Groq is temporarily unavailable.",
      "Try again shortly or check https://status.groq.com."
    );
  }

  return new DevmapError(
    `Groq could not complete the request (${providerMessage}).`,
    "Run devmap doctor and verify the selected model."
  );
}

function isModelUnavailable(status: number, message: string): boolean {
  return (
    status === 404
    || (
      status === 400
      && /model|decommissioned|not available|not found|permission/i.test(message)
    )
  );
}

function readRetryDelay(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_RATE_LIMIT_DELAY_MS;
  }

  return Math.min(seconds * 1000, MAX_RATE_LIMIT_DELAY_MS);
}

function normalizeUsage(usage: NonNullable<GroqCompletionPayload["usage"]>): AiTokenUsage {
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readModelIds(response: Response): Promise<string[]> {
  try {
    const payload = await response.json() as {
      data?: Array<{ id?: unknown }>;
    };

    return (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string");
  } catch {
    throw new DevmapError(
      "Groq returned an unreadable model list.",
      "Try again shortly or check https://status.groq.com."
    );
  }
}
