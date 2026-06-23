import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenRouterClient,
  OPENROUTER_FREE_MODEL,
  validateOpenRouterApiKey
} from "../src/ai/openrouter.js";
import { createAiClient, resolveAiRouting } from "../src/ai/provider.js";
import { DevmapError } from "../src/utils/errors.js";

test("OpenRouter client sends the user-selected model without replacing it", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new OpenRouterClient("sk-or-fixture", {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        model: "anthropic/claude-3.5-haiku",
        choices: [{ message: { content: "Selected model answer." } }]
      });
    }
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain the project." }],
    model: "anthropic/claude-3.5-haiku"
  });

  const body = JSON.parse(String(requests[0]?.init?.body)) as {
    model?: string;
    models?: string[];
  };
  assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(body.model, "anthropic/claude-3.5-haiku");
  assert.equal(body.models, undefined);
  assert.equal(result.model, "anthropic/claude-3.5-haiku");
});

test("OpenRouter client sends ordered native fallbacks when explicitly provided", async () => {
  let requestBody: { model?: string; models?: string[] } = {};
  const client = new OpenRouterClient("sk-or-fixture", {
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return jsonResponse({
        model: OPENROUTER_FREE_MODEL,
        choices: [{ message: { content: "Fallback answer." } }]
      });
    }
  });

  await client.complete({
    messages: [{ role: "user", content: "Explain the project." }],
    model: "custom/model",
    fallbackModels: [OPENROUTER_FREE_MODEL]
  });

  assert.equal(requestBody.model, undefined);
  assert.deepEqual(requestBody.models, ["custom/model", OPENROUTER_FREE_MODEL]);
});

test("OpenRouter client streams deltas and reports the routed model", async () => {
  const deltas: string[] = [];
  const encoder = new TextEncoder();
  const client = new OpenRouterClient("sk-or-fixture", {
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"model":"google/gemma-3-4b-it:free","choices":[{"delta":{"content":"Free "}}]}\n\n'
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"answer."}}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n'
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }))
  });

  const result = await client.stream({
    messages: [{ role: "user", content: "Explain the project." }],
    model: OPENROUTER_FREE_MODEL
  }, (delta) => deltas.push(delta));

  assert.deepEqual(deltas, ["Free ", "answer."]);
  assert.equal(result.content, "Free answer.");
  assert.equal(result.model, "google/gemma-3-4b-it:free");
  assert.deepEqual(result.usage, {
    promptTokens: 8,
    completionTokens: 2,
    totalTokens: 10
  });
});

test("OpenRouter automatic routing defaults safely to the free router", () => {
  assert.deepEqual(resolveAiRouting({
    provider: "openrouter",
    apiKey: "sk-or-fixture",
    model: "auto"
  }, "analyze"), {
    model: OPENROUTER_FREE_MODEL,
    fallbackModels: []
  });
});

test("OpenRouter routing prioritizes an explicit user model", () => {
  assert.deepEqual(resolveAiRouting({
    provider: "openrouter",
    apiKey: "sk-or-fixture",
    model: "qwen/qwen3-coder"
  }, "analyze"), {
    model: "qwen/qwen3-coder",
    fallbackModels: []
  });
});

test("provider factory creates an OpenRouter client from stored config", () => {
  assert.ok(createAiClient({
    provider: "openrouter",
    apiKey: "sk-or-fixture",
    model: OPENROUTER_FREE_MODEL
  }) instanceof OpenRouterClient);
});

test("OpenRouter validation maps invalid credentials without exposing the key", async () => {
  await assert.rejects(
    validateOpenRouterApiKey("secret-value", {
      fetch: async () => jsonResponse({ error: { message: "invalid" } }, 401)
    }),
    (error: unknown) => error instanceof DevmapError
      && /OpenRouter API key is invalid/i.test(error.message)
      && !error.message.includes("secret-value")
  );
});

test("OpenRouter client does not expose raw provider errors", async () => {
  const client = new OpenRouterClient("sk-or-fixture", {
    fetch: async () => jsonResponse({
      error: { message: "internal provider detail that should remain hidden" }
    }, 400)
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain the project." }],
      model: "custom/model"
    }),
    (error: unknown) => error instanceof DevmapError
      && /HTTP 400/.test(error.message)
      && !error.message.includes("internal provider detail")
  );
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}
