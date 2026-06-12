import {
  SIMULATION_AUDIO_GUARD_MIN_BYTES,
  SIMULATION_AUDIO_GUARD_MIN_DURATION_MS,
  validateSimulationAudioForUpload,
} from "./simulationAudioGuard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-audio-guard.test] PASS ${name}`);
}

runTest("rejects missing audio files before upload", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "",
    fileExists: false,
    audioBytes: null,
    durationMs: null,
  });

  assert(!result.ok && result.reason === "missing_file", "missing files should be rejected");
});

runTest("rejects obviously tiny audio files before upload", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "file:///voice-input.m4a",
    fileExists: true,
    audioBytes: SIMULATION_AUDIO_GUARD_MIN_BYTES - 1,
    durationMs: 1_200,
    voiceEvidence: true,
  });

  assert(!result.ok && result.reason === "too_small", "tiny files should be rejected even with voice evidence");
});

runTest("rejects very short clips when no voice evidence was seen", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "file:///voice-input.m4a",
    fileExists: true,
    audioBytes: SIMULATION_AUDIO_GUARD_MIN_BYTES + 1,
    durationMs: SIMULATION_AUDIO_GUARD_MIN_DURATION_MS - 1,
    voiceEvidence: false,
  });

  assert(!result.ok && result.reason === "too_short", "sub-threshold clips without voice evidence should be rejected");
});

runTest("allows short answers when voice evidence exists", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "file:///voice-input.m4a",
    fileExists: true,
    audioBytes: SIMULATION_AUDIO_GUARD_MIN_BYTES + 1,
    durationMs: SIMULATION_AUDIO_GUARD_MIN_DURATION_MS - 1,
    voiceEvidence: true,
  });

  assert(result.ok, "short voice-confirmed answers should still upload");
});

runTest("passes conservatively when metadata is unavailable but a URI exists", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "file:///voice-input.m4a",
    fileExists: null,
    audioBytes: null,
    durationMs: null,
    voiceEvidence: false,
  });

  assert(result.ok && result.metadataUnavailable, "missing metadata alone should not block upload");
});
