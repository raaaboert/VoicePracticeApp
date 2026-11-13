import assert from "node:assert/strict";
import test from "node:test";

import { requestCompletion, requestTranscription, requestSpeechSynthesis } from "./openaiClient.js";
import { loadOpenAiModelConfig } from "./openaiModelConfig.js";
import { buildTtsSpeechRequest } from "./ttsPresetConfig.js";

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

test("GPT-Transcribe sends the current multipart contract and accepts a valid empty transcript", async () => {
  let transcript: string | undefined;
  const request = await captureRequest(async () => {
    transcript = await requestTranscription({ model: "gpt-transcribe", audioBuffer: Buffer.alloc(3000),
      fileName: "synthetic.m4a", mimeType: "audio/mp4", language: "en" });
  }, { text: "", languages: [] });
  assert.equal(transcript, "");
  const form = request.init!.body as FormData;
  assert.equal(form.get("model"), "gpt-transcribe");
  assert.equal(form.get("response_format"), "json");
  assert.equal(form.has("chunking_strategy"), false, "diarization/VAD options are not needed for the documented file-model contract");
  assert.deepEqual(form.getAll("languages[]"), ["en"]);
  assert.equal(form.has("languages[0][code]"), false);
  assert.equal(form.has("language"), false);
  assert.equal((form.get("file") as File).type, "audio/mp4");
});

test("legacy Whisper confidence metadata can reject hallucinations before a simulation turn", async () => {
  let transcript: string | undefined;
  const request = await captureRequest(async () => {
    transcript = await requestTranscription({ model: "whisper-1", audioBuffer: Buffer.alloc(3000),
      fileName: "synthetic.m4a", mimeType: "audio/mp4", language: "en" });
  }, { text: "Thank you for watching", segments: [{ no_speech_prob: .99, avg_logprob: -1.2 }] });
  assert.equal(transcript, "");
  const form = request.init!.body as FormData;
  assert.equal(form.get("response_format"), "verbose_json");
  assert.equal(form.get("language"), "en");
  assert.equal(form.has("languages[]"), false);
});

test("explicit mini-TTS rollback uses the existing speech HTTP request and MP3 response contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "offline-rollback-key";
  const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-4o-mini-tts");
    assert.equal(body.voice, "cedar");
    assert.equal(body.response_format, "mp3");
    assert.ok(body.instructions);
    return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  try {
    const model = loadOpenAiModelConfig({ OPENAI_TTS_MODEL: "gpt-4o-mini-tts" }).speech.model;
    const { request } = buildTtsSpeechRequest({ model, preset: "male-balanced", text: "A synthetic recovery response." });
    const result = await requestSpeechSynthesis(request);
    assert.equal(result.contentType, "audio/mpeg");
    assert.deepEqual(new Uint8Array(result.audioBuffer), audio);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("GPT-6 Luna Chat keeps nonreasoning behavior with the supported token field", async () => {
  const request = await captureRequest(() => requestCompletion({ apiFamily: "chat_completions", model: "gpt-6-luna",
    messages: [{ role: "user", content: "A scenario" }], maxOutputTokens: 1600, reasoningEffort: "none", temperature: .7 }),
  { choices: [{ message: { content: "Scenario" } }] });
  const body = parseJsonBody(request);
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.max_completion_tokens, 1600);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, .7);
});

test("Luna reasoning requests omit incompatible sampling fields in both API families", async () => {
  for (const apiFamily of ["chat_completions", "responses"] as const) {
    const request = await captureRequest(() => requestCompletion({ apiFamily, model: "gpt-6-luna",
      messages: [{ role: "user", content: "Synthetic scenario" }], maxOutputTokens: 1600, reasoningEffort: "low", temperature: .7 }),
    { choices: [{ message: { content: "Scenario" } }], output_text: "Scenario" });
    const body = parseJsonBody(request);
    assert.equal(body.temperature, undefined);
    assert.equal(apiFamily === "responses" ? (body.reasoning as any).effort : body.reasoning_effort, "low");
  }
});

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
