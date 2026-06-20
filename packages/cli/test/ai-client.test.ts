import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_AI_FALLBACKS,
  DEFAULT_AI_MODELS,
  GroqClient,
  type GroqClientDependencies
} from "../src/ai/groq.js";
import { buildAnalyzeMessages, buildAskMessages } from "../src/ai/prompts.js";
import type { QuestionContext } from "../src/ai/contextBuilder.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";
import { DevmapError } from "../src/utils/errors.js";

test("Groq client returns normalized content and token usage", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new GroqClient("gsk_test", {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        model: DEFAULT_AI_MODELS.ask,
        choices: [{ message: { content: "Authentication uses a session handler." } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 18,
          total_tokens: 138
        }
      });
    }
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(result.content, "Authentication uses a session handler.");
  assert.equal(result.model, DEFAULT_AI_MODELS.ask);
  assert.deepEqual(result.usage, {
    promptTokens: 120,
    completionTokens: 18,
    totalTokens: 138
  });
});

test("Groq client streams split SSE deltas and returns the complete result", async () => {
  const deltas: string[] = [];
  const encoder = new TextEncoder();
  const client = new GroqClient("gsk_test", {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        stream?: boolean;
        stream_options?: { include_usage?: boolean };
      };
      assert.equal(body.stream, true);
      assert.equal(body.stream_options?.include_usage, true);

      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"model":"llama-3.1-8b-instant","choices":[{"delta":{"content":"Auth"}}]}\n'
          ));
          controller.enqueue(encoder.encode(
            '\ndata: {"model":"llama-3.1-8b-instant","choices":[{"delta":{"content":" works."}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'
          ));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }), {
        headers: { "content-type": "text/event-stream" }
      });
    }
  });

  const result = await client.stream({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask
  }, (delta) => {
    deltas.push(delta);
  });

  assert.deepEqual(deltas, ["Auth", " works."]);
  assert.equal(result.content, "Auth works.");
  assert.equal(result.model, DEFAULT_AI_MODELS.ask);
  assert.deepEqual(result.usage, {
    promptTokens: 10,
    completionTokens: 2,
    totalTokens: 12
  });
});

test("Groq client retries rate limits with exponential backoff", async () => {
  let requestCount = 0;
  const delays: number[] = [];
  const dependencies: GroqClientDependencies = {
    fetch: async () => {
      requestCount += 1;
      if (requestCount <= 3) {
        return jsonResponse(
          { error: { message: "Rate limit reached." } },
          429,
          { "retry-after": "1" }
        );
      }

      return jsonResponse({
        model: DEFAULT_AI_MODELS.ask,
        choices: [{ message: { content: "Recovered." } }]
      });
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  };
  const client = new GroqClient("gsk_test", dependencies);

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask
  });

  assert.equal(requestCount, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(result.content, "Recovered.");
});

test("Groq client stops after three rate-limit retries", async () => {
  let requestCount = 0;
  const delays: number[] = [];
  const client = new GroqClient("gsk_test", {
    fetch: async () => {
      requestCount += 1;
      return jsonResponse(
        { error: { message: "Rate limit reached." } },
        429
      );
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain auth." }],
      model: DEFAULT_AI_MODELS.ask
    }),
    (error: unknown) => error instanceof DevmapError
      && /rate limit reached after retrying/i.test(error.message)
  );

  assert.equal(requestCount, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test("Groq client falls back when the primary model is unavailable", async () => {
  const requestedModels: string[] = [];
  const client = new GroqClient("gsk_test", {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);

      if (body.model === DEFAULT_AI_MODELS.ask) {
        return jsonResponse(
          { error: { message: "The model is not available." } },
          404
        );
      }

      return jsonResponse({
        model: DEFAULT_AI_MODELS.fallback,
        choices: [{ message: { content: "Fallback answer." } }]
      });
    }
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask,
    fallbackModel: DEFAULT_AI_MODELS.fallback
  });

  assert.deepEqual(requestedModels, [
    DEFAULT_AI_MODELS.ask,
    DEFAULT_AI_MODELS.fallback
  ]);
  assert.equal(result.content, "Fallback answer.");
  assert.equal(result.model, DEFAULT_AI_MODELS.fallback);
});

test("Groq client follows an ordered fallback chain after unavailable and rate-limited models", async () => {
  const requestedModels: string[] = [];
  const delays: number[] = [];
  const [qwenModel, versatileModel] = DEFAULT_AI_FALLBACKS.ask;
  const client = new GroqClient("gsk_test", {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);

      if (body.model === DEFAULT_AI_MODELS.ask) {
        return jsonResponse(
          { error: { message: "The model is not available." } },
          404
        );
      }

      if (body.model === qwenModel) {
        return jsonResponse(
          { error: { message: "Rate limit reached." } },
          429
        );
      }

      return jsonResponse({
        model: versatileModel,
        choices: [{ message: { content: "Recovered on the next model." } }]
      });
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask,
    fallbackModels: DEFAULT_AI_FALLBACKS.ask
  });

  assert.deepEqual(requestedModels, [
    DEFAULT_AI_MODELS.ask,
    qwenModel,
    qwenModel,
    qwenModel,
    qwenModel,
    versatileModel
  ]);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(result.content, "Recovered on the next model.");
  assert.equal(result.model, versatileModel);
});

test("Groq client removes duplicate models from the fallback chain", async () => {
  const requestedModels: string[] = [];
  const client = new GroqClient("gsk_test", {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);

      if (body.model === DEFAULT_AI_MODELS.ask) {
        return jsonResponse(
          { error: { message: "The model is not available." } },
          404
        );
      }

      return jsonResponse({
        model: DEFAULT_AI_MODELS.fallback,
        choices: [{ message: { content: "Fallback answer." } }]
      });
    }
  });

  await client.complete({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask,
    fallbackModels: [
      DEFAULT_AI_MODELS.ask,
      DEFAULT_AI_MODELS.fallback,
      DEFAULT_AI_MODELS.fallback
    ],
    fallbackModel: DEFAULT_AI_MODELS.fallback
  });

  assert.deepEqual(requestedModels, [
    DEFAULT_AI_MODELS.ask,
    DEFAULT_AI_MODELS.fallback
  ]);
});

test("Groq streaming follows the fallback chain before emitting deltas", async () => {
  const requestedModels: string[] = [];
  const deltas: string[] = [];
  const fallbackModel = DEFAULT_AI_FALLBACKS.ask[0];
  const encoder = new TextEncoder();
  const client = new GroqClient("gsk_test", {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream?: boolean;
      };
      requestedModels.push(body.model);
      assert.equal(body.stream, true);

      if (body.model === DEFAULT_AI_MODELS.ask) {
        return jsonResponse(
          { error: { message: "The model is not available." } },
          404
        );
      }

      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: {"model":"${fallbackModel}","choices":[{"delta":{"content":"Fallback stream."}}]}\n\n`
          ));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }), {
        headers: { "content-type": "text/event-stream" }
      });
    }
  });

  const result = await client.stream({
    messages: [{ role: "user", content: "Explain auth." }],
    model: DEFAULT_AI_MODELS.ask,
    fallbackModels: DEFAULT_AI_FALLBACKS.ask
  }, (delta) => {
    deltas.push(delta);
  });

  assert.deepEqual(requestedModels, [DEFAULT_AI_MODELS.ask, fallbackModel]);
  assert.deepEqual(deltas, ["Fallback stream."]);
  assert.equal(result.model, fallbackModel);
});

test("Groq client does not fall back after authentication errors", async () => {
  let requestCount = 0;
  const client = new GroqClient("invalid", {
    fetch: async () => {
      requestCount += 1;
      return jsonResponse(
        { error: { message: "Invalid API key." } },
        401
      );
    }
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain auth." }],
      model: DEFAULT_AI_MODELS.ask,
      fallbackModels: DEFAULT_AI_FALLBACKS.ask
    }),
    (error: unknown) => error instanceof DevmapError
      && /API key is invalid/i.test(error.message)
  );

  assert.equal(requestCount, 1);
});

test("Groq client maps invalid credentials to an actionable error", async () => {
  const client = new GroqClient("invalid", {
    fetch: async () => jsonResponse(
      { error: { message: "Invalid API key." } },
      401
    )
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain auth." }],
      model: DEFAULT_AI_MODELS.ask
    }),
    (error: unknown) => error instanceof DevmapError
      && /API key is invalid/i.test(error.message)
      && error.hint?.includes("devmap init") === true
  );
});

test("ask prompt grounds the answer in snapshot context and preserves language", () => {
  const context: QuestionContext = {
    question: "Bagaimana autentikasi bekerja?",
    intent: "explain",
    keywords: ["auth", "session"],
    expandedTerms: ["middleware"],
    confidence: "high",
    topScore: 72,
    relevantFiles: [],
    files: [
      {
        path: "lib/auth.ts",
        score: 20,
        reasons: ["evidence for Authentication"],
        exports: ["getSession"],
        topFunctions: [],
        startLine: 1,
        endLine: 4,
        truncated: false,
        content: "export async function getSession() {\n  return auth();\n}"
      }
    ]
  };

  const messages = buildAskMessages(context, {
    projectName: "fixture",
    framework: "nextjs"
  });

  assert.match(messages[0]?.content ?? "", /only the supplied DevMap context/i);
  assert.match(messages[0]?.content ?? "", /same language/i);
  assert.match(messages[0]?.content ?? "", /Do not restate the question/i);
  assert.match(messages[0]?.content ?? "", /Do not repeat/i);
  assert.match(messages[0]?.content ?? "", /Only mention files as existing files/i);
  assert.match(messages[0]?.content ?? "", /suggested new or possible file/i);
  assert.match(messages[0]?.content ?? "", /EXPANDED_TERMS/i);
  assert.match(messages[0]?.content ?? "", /Key Files/);
  assert.match(messages[0]?.content ?? "", /Limits/);
  assert.match(messages[0]?.content ?? "", /existing supplied files/i);
  assert.match(messages[1]?.content ?? "", /INTENT: explain/);
  assert.match(messages[1]?.content ?? "", /EXPANDED_TERMS: middleware/);
  assert.match(messages[1]?.content ?? "", /RETRIEVAL_CONFIDENCE: high/);
  assert.match(messages[1]?.content ?? "", /EXPORTS: getSession/);
  assert.match(messages[1]?.content ?? "", /Bagaimana autentikasi bekerja/);
  assert.match(messages[1]?.content ?? "", /lib\/auth\.ts/);
  assert.match(messages[1]?.content ?? "", /getSession/);
});

test("analyze prompt contains structured snapshot facts without raw source", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const snapshot = await createProjectMap(join(testDirectory, "fixtures", "nextjs-project"));
  const messages = buildAnalyzeMessages(snapshot);

  assert.match(messages[0]?.content ?? "", /only facts supported/i);
  assert.match(messages[1]?.content ?? "", /"entryPoints"/);
  assert.match(messages[1]?.content ?? "", /"criticalFiles"/);
  assert.doesNotMatch(messages[1]?.content ?? "", /return <main>/);
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
