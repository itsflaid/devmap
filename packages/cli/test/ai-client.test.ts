import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
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

test("Groq client retries rate limits using retry-after", async () => {
  let requestCount = 0;
  const delays: number[] = [];
  const dependencies: GroqClientDependencies = {
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return jsonResponse(
          { error: { message: "Rate limit reached." } },
          429,
          { "retry-after": "2" }
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

  assert.equal(requestCount, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.content, "Recovered.");
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
    keywords: ["auth", "session"],
    files: [
      {
        path: "lib/auth.ts",
        score: 20,
        reasons: ["evidence for Authentication"],
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
