import assert from "node:assert/strict";
import test from "node:test";
import { requestChatCompletion, requestResponsesCompletion, requestSpeechSynthesis, requestTranscription } from "../openaiClient.js";
import { isOpenAiRequestNotDispatched } from "./aiProviderDispatch.js";

test("local request construction and serialization failures carry pre-dispatch evidence without changing errors", async () => {
  const key = process.env.OPENAI_API_KEY, fetch = globalThis.fetch, NativeFile = globalThis.File;
  process.env.OPENAI_API_KEY = "mock-key";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("test must not dispatch"); };
  try {
    const circular: any = {}; circular.self = circular;
    await assert.rejects(requestChatCompletion({ model: "mock", messages: circular }), error => error instanceof TypeError && isOpenAiRequestNotDispatched(error));
    await assert.rejects(requestResponsesCompletion({ model: "mock", messages: null as any }), isOpenAiRequestNotDispatched);
    await assert.rejects(requestSpeechSynthesis({ model: "mock", voice: "mock", text: circular }), isOpenAiRequestNotDispatched);
    const failure = new Error("local file construction failed");
    globalThis.File = class { constructor() { throw failure; } } as any;
    await assert.rejects(requestTranscription({ model: "mock", audioBuffer: Buffer.from("mock"), mimeType: "audio/wav", fileName: "mock.wav" }), error => error === failure && isOpenAiRequestNotDispatched(error));
    assert.equal(calls, 0);
    assert.equal(isOpenAiRequestNotDispatched({ notDispatched: true, statusCode: 401 }), false);
    assert.equal(isOpenAiRequestNotDispatched(new Error("missing OPENAI_API_KEY")), false, "message matching is not proof");
  } finally { globalThis.fetch = fetch; globalThis.File = NativeFile; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});

test("all adapters treat fetch rejection and provider refusal as uncertain, even with key/auth/rate-limit wording", async () => {
  const key = process.env.OPENAI_API_KEY, fetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "mock-key";
  try {
    for (const invoke of [
      () => requestChatCompletion({ model: "mock", messages: [] }),
      () => requestResponsesCompletion({ model: "mock", messages: [] }),
      () => requestSpeechSynthesis({ model: "mock", voice: "mock", text: "mock" }),
      () => requestTranscription({ model: "mock", audioBuffer: Buffer.from("mock"), mimeType: "audio/wav", fileName: "mock.wav" }),
    ]) {
      for (const status of [400, 401, 429, 500, null]) {
        globalThis.fetch = async () => {
          if (status === null) throw new TypeError("network failed after possible send");
          return new Response(JSON.stringify({ error: { message: "mock authentication/budget failure" } }), { status });
        };
        await assert.rejects(invoke(), error => !isOpenAiRequestNotDispatched(error));
      }
    }
  } finally { globalThis.fetch = fetch; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
