import { DevmapError } from "../utils/errors.js";
import type {
  AiDeltaHandler,
  AiTokenUsage
} from "./types.js";

export type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type CompletionPayload = {
  model?: string;
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: RawUsage;
};

export type StreamChunkPayload = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: RawUsage;
  x_groq?: {
    usage?: RawUsage;
  };
};

export type PayloadUnreadableMessages = {
  unreadable: () => DevmapError;
};

export type StreamInterruptedMessages = {
  missingBody: () => DevmapError;
  unreadable: () => DevmapError;
  interrupted: () => DevmapError;
};

export type ParseSseStreamOptions = {
  messages: StreamInterruptedMessages;
  readExtraUsage?: (payload: StreamChunkPayload) => RawUsage | undefined;
};

export async function parseSseStream(
  response: Response,
  requestedModel: string,
  onDelta: AiDeltaHandler,
  options: ParseSseStreamOptions
): Promise<{
  content: string;
  model: string;
  usage?: AiTokenUsage;
}> {
  if (!response.body) {
    throw options.messages.missingBody();
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

    let payload: StreamChunkPayload;
    try {
      payload = JSON.parse(data) as StreamChunkPayload;
    } catch {
      throw options.messages.unreadable();
    }

    model = payload.model || model;
    const delta = payload.choices?.[0]?.delta?.content;
    if (delta) {
      content += delta;
      onDelta(delta);
    }

    const rawUsage = payload.usage ?? options.readExtraUsage?.(payload);
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

    throw options.messages.interrupted();
  }

  return {
    content,
    model,
    ...(usage ? { usage } : {})
  };
}

export async function readCompletionPayload(
  response: Response,
  messages: PayloadUnreadableMessages
): Promise<CompletionPayload> {
  try {
    const payload = await response.json() as Partial<CompletionPayload>;
    return {
      model: payload.model,
      choices: Array.isArray(payload.choices) ? payload.choices : [],
      usage: payload.usage
    };
  } catch {
    throw messages.unreadable();
  }
}

export function normalizeUsage(usage: RawUsage): AiTokenUsage {
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0
  };
}
