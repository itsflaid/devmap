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
  analyze: "openai/gpt-oss-20b",
  flowNarration: "openai/gpt-oss-20b",
  explain: "openai/gpt-oss-20b",
  fallback: "openai/gpt-oss-20b"
} as const;

export const DEFAULT_AI_FALLBACKS = {
  analyze: [
    "qwen/qwen3.6-27b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
  ],
  flowNarration: [
    "qwen/qwen3.6-27b",
    "llama-3.1-8b-instant"
  ],
  explain: [
    "qwen/qwen3.6-27b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
  ]
} as const;

const EXCLUDED_MODEL_PATTERNS = [
  /whisper/i,         // speech-to-text models (whisper-large-v3, distil-whisper-*)
  /prompt-guard/i,    // content moderation (llama-prompt-guard-*)
  /\bguard\b/i,       // safety classifier models (llama-guard-3-8b, etc.)
  /compound/i,        // compound-beta orchestration models — not plain chat completions
  /\btts\b/i,         // text-to-speech (playai-tts, playai-tts-arabic)
  /\bvision\b/i,      // vision-only models
  /llava/i,           // LLaVA multimodal vision family
  /\bembed\b/i,       // embedding models — no chat completions API
  /\bspeculative\b/i, // speculative decoding variants
  /\brerank\b/i,      // reranking models
];

const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
  "qwen/qwen3-32b",
  "llama-3.1-8b-instant",
];

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
    let lastError: DevmapError | undefined;

    for (const model of resolveModelChain(request)) {
      const result = await this.requestModel(request, model);
      if (result.ok) {
        return result.result;
      }

      lastError = result.error;
      if (!result.canFallback) {
        throw result.error;
      }
    }

    throw lastError ?? new DevmapError("No Groq model was configured.");
  }

  async stream(
    request: AiCompletionRequest,
    onDelta: AiDeltaHandler
  ): Promise<AiCompletionResult> {
    let lastError: DevmapError | undefined;

    for (const model of resolveModelChain(request)) {
      const result = await this.requestModelStream(request, model, onDelta);
      if (result.ok) {
        return result.result;
      }

      lastError = result.error;
      if (!result.canFallback) {
        throw result.error;
      }
    }

    throw lastError ?? new DevmapError("No Groq model was configured.");
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

export async function listGroqModels(
  apiKey: string,
  dependencies: Pick<GroqClientDependencies, "fetch"> = {}
): Promise<string[]> {
  const response = await fetchGroqModels(apiKey, dependencies);
  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The Groq API key is invalid.",
      "Create or copy a valid key from https://console.groq.com/keys."
    );
  }

  if (!response.ok) {
    throw new DevmapError(
      `Groq model lookup failed with HTTP ${response.status}.`,
      "Try again shortly or check https://status.groq.com."
    );
  }

  return readModelIds(response);
}

export async function inspectGroqProvider(
  apiKey: string,
  model?: string,
  dependencies: Pick<GroqClientDependencies, "fetch"> = {}
): Promise<GroqProviderInspection> {
  const response = await fetchGroqModels(apiKey, dependencies);

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

async function fetchGroqModels(
  apiKey: string,
  dependencies: Pick<GroqClientDependencies, "fetch"> = {}
): Promise<Response> {
  const fetchImplementation = dependencies.fetch ?? fetch;

  try {
    return await fetchImplementation(GROQ_MODELS_URL, {
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
  | { ok: false; canFallback: boolean; error: DevmapError };

async function readFailedRequest(response: Response): Promise<GroqRequestResult> {
  const providerMessage = await readProviderError(response);
  return {
    ok: false,
    canFallback: shouldTryFallback(response.status, providerMessage),
    error: mapGroqError(response.status, providerMessage)
  };
}

function emptyResponseResult(): GroqRequestResult {
  return {
    ok: false,
    canFallback: false,
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

function shouldTryFallback(status: number, message: string): boolean {
  return status === 429
    || status >= 500
    || (
      status === 404
      || (
        status === 400
        && /model|decommissioned|not available|not found|permission/i.test(message)
      )
    );
}

function resolveModelChain(request: AiCompletionRequest): string[] {
  return Array.from(new Set([
    request.model,
    ...(request.fallbackModels ?? []),
    ...(request.fallbackModel ? [request.fallbackModel] : [])
  ].filter((model) => model.trim().length > 0)));
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
      .filter((id): id is string => typeof id === "string")
      .filter((id) => !EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(id)))
      .sort((a, b) => {
        const aIndex = PREFERRED_MODELS.indexOf(a);
        const bIndex = PREFERRED_MODELS.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.localeCompare(b);
      });
  } catch {
    throw new DevmapError(
      "Groq returned an unreadable model list.",
      "Try again shortly or check https://status.groq.com."
    );
  }
}
