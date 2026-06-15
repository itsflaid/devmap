import { output } from "../utils/output.js";
import type {
  AiClient,
  AiCompletionRequest,
  AiCompletionResult
} from "./types.js";

export type AiCompletionExecution = {
  result: AiCompletionResult;
  streamed: boolean;
};

export async function completeWithOptionalStreaming(
  client: AiClient,
  request: AiCompletionRequest,
  enabled: boolean,
  onStreamStart?: () => void
): Promise<AiCompletionExecution> {
  if (!enabled || !client.stream) {
    return {
      result: await client.complete(request),
      streamed: false
    };
  }

  const renderer = output.markdownStream();
  let started = false;
  try {
    const result = await client.stream(request, (delta) => {
      if (!started) {
        onStreamStart?.();
        started = true;
      }
      renderer.write(delta);
    });
    renderer.end();
    return { result, streamed: true };
  } catch (error) {
    renderer.end();
    throw error;
  }
}
