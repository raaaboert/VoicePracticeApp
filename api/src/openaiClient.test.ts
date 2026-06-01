import assert from "node:assert/strict";
import test from "node:test";

import { requestCompletion } from "./openaiClient.js";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

async function captureRequest(
  callback: () => Promise<unknown>,
  responsePayload: unknown
): Promise<CapturedRequest> {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest | null = null;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (input, init) => {
    captured = {
      url: String(input),
      init,
    };
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    await callback();
    assert.ok(captured);
    return captured;
  } finally {
    globalThis.fetch = originalFetch;
    if (typeof originalApiKey === "string") {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
}

function parseJsonBody(request: CapturedRequest): Record<string, unknown> {
  const body = request.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected a JSON string request body.");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

test("configured Chat Completions requests send the legacy simulation shape", async () => {
  const request = await captureRequest(
    () =>
      requestCompletion({
        apiFamily: "chat_completions",
        model: "chat-model",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "user prompt" },
        ],
        temperature: 0.75,
        maxOutputTokens: 220,
        reasoningEffort: "low",
      }),
    {
      choices: [{ message: { content: "reply" } }],
      model: "chat-model-response",
    }
  );

  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(parseJsonBody(request), {
    model: "chat-model",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ],
    temperature: 0.75,
    max_tokens: 220,
  });
});

test("configured Responses requests send output caps and optional reasoning without temperature", async () => {
  const request = await captureRequest(
    () =>
      requestCompletion({
        apiFamily: "responses",
        model: "responses-model",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "user prompt" },
        ],
        temperature: 0.75,
        maxOutputTokens: 220,
        reasoningEffort: "low",
      }),
    {
      output_text: "reply",
      model: "responses-model-response",
    }
  );

  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(parseJsonBody(request), {
    model: "responses-model",
    input: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ],
    max_output_tokens: 220,
    reasoning: {
      effort: "low",
    },
  });
});

test("default Responses requests omit reasoning and temperature", async () => {
  const request = await captureRequest(
    () =>
      requestCompletion({
        apiFamily: "responses",
        model: "responses-model",
        messages: [{ role: "user", content: "user prompt" }],
        temperature: 0.75,
        maxOutputTokens: 160,
      }),
    {
      output_text: "reply",
      model: "responses-model-response",
    }
  );

  assert.deepEqual(parseJsonBody(request), {
    model: "responses-model",
    input: [{ role: "user", content: "user prompt" }],
    max_output_tokens: 160,
  });
});
