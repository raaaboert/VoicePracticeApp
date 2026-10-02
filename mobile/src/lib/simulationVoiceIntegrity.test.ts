import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const simulationSource = readFileSync(
  resolve(sourceDirectory, "../screens/SimulationScreen.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const playbackSource = readFileSync(resolve(sourceDirectory, "ttsPlayback.ts"), "utf8");

test("only an explicit user action can request user-turn submission", () => {
  assert.equal(simulationSource.match(/void finalizeTurn\(\{/g)?.length, 1);
  assert.match(
    simulationSource,
    /if \(primaryButtonRoute === "submit_response"\) \{[\s\S]*?reason: "user_submit",[\s\S]*?explicitUserAction: true/,
  );
  assert.match(simulationSource, /evaluateTurnFinalizeRequest\(\{/);
  assert.doesNotMatch(simulationSource, /recordingDurationMs\s*[<>]=?\s*\d+/);
});

test("cleanup, interruption, lifecycle, and audio-error stops remain non-submit paths", () => {
  for (const reason of [
    "recording_interruption",
    "app_background",
    "session_end",
    "component_cleanup",
    "audio_error",
  ]) {
    assert.match(simulationSource, new RegExp(`stopRecordingSafely\\(\"${reason}\"\\)`));
  }
});

test("live remote simulation TTS fails closed instead of changing to device speech", () => {
  assert.match(
    simulationSource,
    /allowFallbackSpeech:\s*!config\.remoteTtsEnabled \|\| !apiConfigured \|\| useLocalMockMode/,
  );
  assert.match(playbackSource, /if \(!fallbackSpeechAllowed\) \{[\s\S]*?fallback_blocked[\s\S]*?throw new Error/);
  assert.match(playbackSource, /phase: "foreground_tts_requested"/);
  assert.match(playbackSource, /phase: "foreground_tts_failed"/);
  assert.match(playbackSource, /params\.preparedRemoteSource\?\.audio\.audioOrigin/);
  assert.match(
    playbackSource,
    /ttsAudio = await fetchAiTtsAudio\(\{[\s\S]*?remoteAudioOrigin = ttsAudio\.audioOrigin \?\? "foreground_generation";/,
  );
});

test("audio source and stale-result diagnostics are wired at the simulation boundary", () => {
  assert.match(simulationSource, /phase: "audio_source_selected"/);
  assert.match(simulationSource, /phase: "stale_audio_ignored"/);
  assert.match(simulationSource, /audioOrigin: details\.audioOrigin/);
  assert.match(simulationSource, /phase: "turn_submit_requested"/);
  assert.match(simulationSource, /phase: "stale_event_ignored"/);
  assert.match(simulationSource, /pendingOpeningCorrelationIdRef\.current \?\? openingCorrelationId/);
  assert.match(simulationSource, /openingSpeechCorrelationId,\n\s*openingSpeechPrefetch,/);
});
