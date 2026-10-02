import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
).replace(/\r\n/g, "\n");
const registrySource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "services/simulationSpeechPrefetchRegistry.ts"),
  "utf8",
);

const ttsRouteStart = source.indexOf('app.post("/mobile/users/:userId/ai/tts"');
const openingRouteStart = source.indexOf('app.post("/mobile/users/:userId/ai/opening"', ttsRouteStart);
assert.ok(ttsRouteStart >= 0 && openingRouteStart > ttsRouteStart, "Could not locate TTS route.");
const ttsRoute = source.slice(ttsRouteStart, openingRouteStart);

test("foreground TTS consumes matching in-flight prefetch before starting another provider request", () => {
  const consumeIndex = ttsRoute.indexOf("simulationSpeechPrefetchRegistry.consume({");
  const providerIndex = ttsRoute.indexOf("requestSpeechSynthesis(speechRequest)");
  assert.ok(consumeIndex >= 0, "TTS route does not consume the in-flight prefetch registry.");
  assert.ok(providerIndex > consumeIndex, "provider TTS must only run after prefetch reuse is attempted.");
  assert.match(ttsRoute, /audioSource: "in_flight_prefetch"/);
  assert.match(ttsRoute, /audioSource: "foreground_generation"/);
  assert.match(ttsRoute, /X-TTS-Audio-Source", "in_flight_prefetch"/);
  assert.match(ttsRoute, /X-TTS-Audio-Source", "foreground_generation"/);
  assert.match(source, /const SIMULATION_SPEECH_PREFETCH_REUSE_WAIT_MS = 2_000/);
  assert.match(ttsRoute, /waitMs: SIMULATION_SPEECH_PREFETCH_REUSE_WAIT_MS/);
  assert.match(ttsRoute, /speech_prefetch_reuse_timeout/);
});

test("turn and opening prefetches are registered before their short payload window resolves", () => {
  assert.equal(source.match(/registerSimulationSpeechPrefetchForForegroundReuse\(\{/g)?.length, 2);

  const turnRegistration = source.indexOf("registerSimulationSpeechPrefetchForForegroundReuse({", source.indexOf("async function generateSimulationTurnReply"));
  const turnWindow = source.indexOf("resolveSpeechPrefetchForAssistantPayload({", turnRegistration);
  assert.ok(turnRegistration >= 0 && turnWindow > turnRegistration);

  const openingRegistration = source.lastIndexOf("registerSimulationSpeechPrefetchForForegroundReuse({");
  const openingWindow = source.indexOf("resolveSpeechPrefetchForAssistantPayload({", openingRegistration);
  assert.ok(openingRegistration > turnRegistration && openingWindow > openingRegistration);
});

test("prefetch reuse is identity-, preset-, text-, and correlation-bound", () => {
  assert.match(ttsRoute, /correlationId,\n\s*userId,\n\s*preset,\n\s*text,/);
  assert.match(registrySource, /textHash: hashText\(params\.text\)/);
});
