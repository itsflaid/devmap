export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiCompletionRequest = {
  messages: AiMessage[];
  model: string;
  fallbackModel?: string;
  maxCompletionTokens?: number;
  temperature?: number;
};

export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AiCompletionResult = {
  content: string;
  model: string;
  usage?: AiTokenUsage;
};

export type AiDeltaHandler = (delta: string) => void;

export interface AiClient {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  stream?(
    request: AiCompletionRequest,
    onDelta: AiDeltaHandler
  ): Promise<AiCompletionResult>;
}
