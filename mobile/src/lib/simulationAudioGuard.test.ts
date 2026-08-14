import {
  getSimulationCaptureFailureStatus,
  SIMULATION_AUDIO_GUARD_MIN_BYTES,
  SIMULATION_AUDIO_GUARD_MIN_DURATION_MS,
  shouldAttemptSimulationTranscription,
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

runTest("explicit submit attempts transcription despite inconclusive metering", () => {
  const shouldAttempt = shouldAttemptSimulationTranscription({
    trigger: "submit",
    meteringSeen: true,
    detectedVoice: false,
    heardVoice: false,
    turnDurationSeconds: 4,
  });

  assert(shouldAttempt, "an explicit submit must reach audio validation and transcription");
});

runTest("explicit submit attempts transcription when no metering was available", () => {
  const shouldAttempt = shouldAttemptSimulationTranscription({
    trigger: "submit",
    meteringSeen: false,
    detectedVoice: false,
    heardVoice: false,
    turnDurationSeconds: 1,
  });

  assert(shouldAttempt, "an explicit submit must not depend on metering availability");
});

runTest("automatic handling preserves voice-evidence decisions", () => {
  assert(
    shouldAttemptSimulationTranscription({
      trigger: "automatic",
      meteringSeen: true,
      detectedVoice: true,
      heardVoice: false,
      turnDurationSeconds: 1,
    }),
    "automatic handling should accept detected voice",
  );
  assert(
    !shouldAttemptSimulationTranscription({
      trigger: "automatic",
      meteringSeen: true,
      detectedVoice: false,
      heardVoice: false,
      turnDurationSeconds: 4,
    }),
    "automatic handling should still reject metered turns without voice evidence",
  );
  assert(
    shouldAttemptSimulationTranscription({
      trigger: "automatic",
      meteringSeen: false,
      detectedVoice: false,
      heardVoice: false,
      turnDurationSeconds: 3,
    }),
    "automatic handling should preserve the duration fallback when metering is unavailable",
  );
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

runTest("allows a valid multi-second recording with inconclusive voice detection", () => {
  const result = validateSimulationAudioForUpload({
    audioUri: "file:///voice-input.m4a",
    fileExists: true,
    audioBytes: SIMULATION_AUDIO_GUARD_MIN_BYTES + 10_000,
    durationMs: 4_000,
    voiceEvidence: false,
  });

  assert(result.ok, "a valid multi-second recording should reach transcription");
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

runTest("capture failures provide actionable retry feedback", () => {
  for (const reason of ["missing_file", "too_small", "too_short", "no_usable_transcript"] as const) {
    const status = getSimulationCaptureFailureStatus(reason);
    assert(status.trim().length > 0, `${reason} should produce a visible status`);
    assert(status.includes("received your response"), `${reason} should acknowledge the submission`);
    assert(status.includes("microphone"), `${reason} should identify the likely capture area`);
    assert(status.includes("try again"), `${reason} should explain how to recover`);
    assert(!/bytes|audio guard|STT|URI|VAD/i.test(status), `${reason} should not expose technical jargon`);
  }
});
