import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as apiErrors from "./apiError";
import * as ttsOrigin from "./ttsAudioOrigin";
import { createSimulationStartupCoordinator } from "./simulationStartup";

function harness(fetch: typeof globalThis.fetch) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./api.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, fetch, Error, TypeError, AbortController, URL, URLSearchParams, FormData, Blob, Uint8Array,
    process: { env: { EXPO_PUBLIC_API_BASE_URL: "https://test.invalid" } }, __DEV__: false, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "./apiError") return apiErrors;
      if (name === "./ttsAudioOrigin") return ttsOrigin;
      if (name === "react-native") return { Platform: { OS: "web" }, NativeModules: {} };
      if (name === "expo-file-system") return { File: class {} };
      throw new Error(`Unexpected native dependency: ${name}`);
    } });
  return exports as typeof import("./api");
}

test("actual mobile speech requests send full session identity and TTS authorization; legacy fields remain optional", async () => {
  const requests: Array<{ path: string; body: any }> = [];
  const api = harness(async (url, init) => {
    if (String(url).startsWith("memory:")) return new Response(new Uint8Array([1, 2]));
    requests.push({ path: String(url), body: init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body)) });
    return String(url).endsWith("/tts") ? new Response(new Uint8Array([1, 2, 3])) : Response.json({ text: "Real transcription" });
  });
  await api.transcribeAudioViaApi({ userId: "u", authToken: "auth", audioUri: "memory:clip", mimeType: "audio/m4a", simulationSessionId: "full-authoritative-session" });
  assert.equal(requests[0]!.body.get("simulationSessionId"), "full-authoritative-session");
  await api.fetchAiTtsAudio({ userId: "u", authToken: "auth", simulationSessionId: "full-authoritative-session", speechAuthorization: "server-issued", text: "Server response", preset: "female-balanced" });
  assert.deepEqual(requests[1]!.body, { simulationSessionId: "full-authoritative-session", speechAuthorization: "server-issued", text: "Server response", preset: "female-balanced" });
  await api.fetchAiTtsAudio({ userId: "u", authToken: "auth", text: "Legacy speech", preset: "female-balanced" });
  assert.deepEqual(requests[2]!.body, { text: "Legacy speech", preset: "female-balanced" });
});

test("opening, turn and interrupted-turn recovery retain additive response authorization", async () => {
  const api = harness(async () => Response.json({ outcome: "assistant_reply", transcriptText: "Real user response", assistantText: "Server response",
    speechAuthorization: "server-issued", speechPrefetch: null, usage: {}, model: "mock", promptVersion: "v1", trainingPack: { applied: false } }));
  const params = { userId: "u", authToken: "auth", simulationSessionId: "session", scenarioId: "scenario", difficulty: "medium" as const, personaStyle: "skeptical" as const };
  assert.equal((await api.fetchAiOpeningLine(params)).speechAuthorization, "server-issued");
  assert.equal((await api.fetchAiTurn({ ...params, history: [] })).speechAuthorization, "server-issued");
  const recovered = await api.awaitSimulationTurnResultViaApi({ userId: "u", authToken: "auth", correlationId: "recovery" });
  assert.equal(recovered.outcome, "assistant_reply");
  if (recovered.outcome === "assistant_reply") assert.equal(recovered.speechAuthorization, "server-issued");
});

test("speech authorization failures do not automatically repeat a synthesis request", async () => {
  let requests = 0;
  const api = harness(async () => { requests++; return Response.json({ error: "Speech response unavailable", code: "speech_authorization_invalid" }, { status: 403 }); });
  await assert.rejects(api.fetchAiTtsAudio({ userId: "u", authToken: "auth", text: "Response", preset: "female-balanced", simulationSessionId: "session" }),
    (error: unknown) => error instanceof apiErrors.MobileApiError && error.code === "speech_authorization_invalid");
  assert.equal(requests, 1);
});

test("session-owned speech state survives remount use and is excluded from histories and other sessions", () => {
  const startup = createSimulationStartupCoordinator();
  startup.speechAuthorizations.set("Server response", "server-issued");
  const remount = startup;
  assert.equal(remount.speechAuthorizations.get("Server response"), "server-issued");
  assert.equal(createSimulationStartupCoordinator().speechAuthorizations.size, 0);
  assert.doesNotMatch(JSON.stringify(startup.messages), /server-issued/);
});
