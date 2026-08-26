import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomProviderClient,
  inspectCustomProvider,
  listCustomModels
} from "../src/ai/custom.js";
import { DevmapError } from "../src/utils/errors.js";

const BASE_URL = "http://localhost:20128/v1";

test("Custom client posts to the configured endpoint with the selected model", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new CustomProviderClient("custom-key-fixture", `${BASE_URL}/`, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse({
        model: "qwen3-coder-30b",
        choices: [{ message: { content: "Endpoint answer." } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
      });
    }
  });

  const result = await client.complete({
    messages: [{ role: "user", content: "Explain the project." }],
    model: "qwen3-coder-30b"
  });

  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(requests[0]?.url, `${BASE_URL}/chat/completions`);
  assert.equal(headers.get("authorization"), "Bearer custom-key-fixture");
  const body = JSON.parse(String(requests[0]?.init?.body)) as { model?: string };
  assert.equal(body.model, "qwen3-coder-30b");
  assert.equal(result.content, "Endpoint answer.");
  assert.equal(result.model, "qwen3-coder-30b");
  assert.deepEqual(result.usage, {
    promptTokens: 12,
    completionTokens: 4,
    totalTokens: 16
  });
});

test("Custom client streams deltas from the endpoint", async () => {
  const deltas: string[] = [];
  const encoder = new TextEncoder();
  const client = new CustomProviderClient("custom-key-fixture", BASE_URL, {
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"model":"llama-3.1-8b","choices":[{"delta":{"content":"Local "}}]}\n\n'
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"answer."}}],"usage":{"prompt_tokens":6,"completion_tokens":2,"total_tokens":8}}\n\n'
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }))
  });

  const result = await client.stream({
    messages: [{ role: "user", content: "Explain the project." }],
    model: "llama-3.1-8b"
  }, (delta) => deltas.push(delta));

  assert.deepEqual(deltas, ["Local ", "answer."]);
  assert.equal(result.content, "Local answer.");
  assert.equal(result.model, "llama-3.1-8b");
  assert.deepEqual(result.usage, {
    promptTokens: 6,
    completionTokens: 2,
    totalTokens: 8
  });
});

test("Custom client maps empty responses to an actionable error", async () => {
  const client = new CustomProviderClient("custom-key-fixture", BASE_URL, {
    fetch: async () => jsonResponse({ model: "qwen3-coder-30b", choices: [] })
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain the project." }],
      model: "qwen3-coder-30b"
    }),
    (error: unknown) => error instanceof DevmapError
      && /empty response/i.test(error.message)
  );
});

test("Custom client reports unreachable endpoints distinctly", async () => {
  const client = new CustomProviderClient("custom-key-fixture", "http://localhost:59999/v1", {
    fetch: async () => {
      throw new TypeError("fetch failed");
    }
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain the project." }],
      model: "qwen3-coder-30b"
    }),
    (error: unknown) => error instanceof DevmapError
      && /Could not connect to the configured endpoint/i.test(error.message)
      && /server is running/i.test(error.hint ?? "")
  );
});

test("Custom client maps unknown models to a safe error", async () => {
  const client = new CustomProviderClient("custom-key-fixture", BASE_URL, {
    fetch: async () => jsonResponse({
      error: { message: "Model nosuch-model does not exist on this server." }
    }, 404)
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain the project." }],
      model: "nosuch-model"
    }),
    (error: unknown) => error instanceof DevmapError
      && /HTTP 404/.test(error.message)
      && !error.message.includes("nosuch-model does not exist")
  );
});

test("Custom client reports rejected keys without echoing them", async () => {
  const client = new CustomProviderClient("custom-secret-key", BASE_URL, {
    fetch: async () => jsonResponse({ error: { message: "invalid" } }, 401)
  });

  await assert.rejects(
    client.complete({
      messages: [{ role: "user", content: "Explain the project." }],
      model: "qwen3-coder-30b"
    }),
    (error: unknown) => error instanceof DevmapError
      && /rejected the API key/i.test(error.message)
      && !error.message.includes("custom-secret-key")
  );
});

test("listCustomModels returns endpoint model ids without Groq filtering", async () => {
  const models = await listCustomModels("custom-key-fixture", BASE_URL, {
    fetch: async () => jsonResponse({
      data: [
        { id: "zeta-model" },
        { id: "alpha-model" },
        { id: "whisper-large-v3" }
      ]
    })
  });

  assert.deepEqual(models, ["alpha-model", "whisper-large-v3", "zeta-model"]);
});

test("inspectCustomProvider checks reachability and model availability", async () => {
  const inspection = await inspectCustomProvider(
    "custom-key-fixture",
    BASE_URL,
    "alpha-model",
    {
      fetch: async () => jsonResponse({ data: [{ id: "alpha-model" }] })
    }
  );

  assert.deepEqual(inspection, { reachable: true, modelAvailable: true });
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
