import {
  getSimulationCaptureFailureStatus,
  SIMULATION_AUDIO_GUARD_MIN_BYTES,
  SIMULATION_AUDIO_GUARD_MIN_DURATION_MS,
  shouldAttemptSimulationTranscription,
  validateSimulationAudioForUpload,
  emptyRecordingSignal,
  observeRecordingSignal,
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
  for (const reason of ["missing_file", "too_small", "too_short", "silent_signal", "no_usable_transcript"] as const) {
    const status = getSimulationCaptureFailureStatus(reason);
    assert(status.trim().length > 0, `${reason} should produce a visible status`);
    assert(status.includes("received your response"), `${reason} should acknowledge the submission`);
    assert(status.includes("microphone"), `${reason} should identify the likely capture area`);
    assert(status.includes("try again"), `${reason} should explain how to recover`);
    assert(!/bytes|audio guard|STT|URI|VAD/i.test(status), `${reason} should not expose technical jargon`);
  }
});

function validateLevels(levels: number[], durationMs = 4000) {
  const signal = emptyRecordingSignal();
  levels.forEach((level, index) => observeRecordingSignal(signal, level, index * durationMs / Math.max(1, levels.length - 1)));
  return validateSimulationAudioForUpload({ audioUri: "file:///synthetic.m4a", fileExists: true,
    audioBytes: 32_000, durationMs, voiceEvidence: false, signal });
}
runTest("reliable low flat meters reject near-silence as a client hint, not server speech detection", () => {
  for (const levels of [Array(16).fill(-80), [-74, -73, -74, -73, -74, -73]]) {
    const result = validateLevels(levels);
    assert(!result.ok && result.reason === "silent_signal", "silent capture must stop before ASR, bubbles or scoring");
  }
});
runTest("Android failed-meter sentinel never classifies a recording as silence", () => {
  assert(validateLevels(Array(16).fill(-160)).ok, "repeated measurement failures must reach server validation");
  assert(validateLevels([-80, -80, -160, -80, -80, -80]).ok, "a failed interval may contain genuine speech");
  const signal = emptyRecordingSignal();
  for (const [index, level] of [-80, -80, undefined, -80, -80].entries()) observeRecordingSignal(signal, level, index * 1000);
  assert(validateSimulationAudioForUpload({ audioUri: "file:///test.m4a", durationMs: 4000, audioBytes: 32000, signal }).ok,
    "an unavailable reading invalidates otherwise flat meter evidence");
});
runTest("quiet modulated speech and ordinary speech remain controls, without phrase blocklists", () => {
  for (const levels of [[-89, -76, -80, -73, -82, -75], [-65, -48, -37, -55, -44, -58], [-80, -68, -72, -63, -78, -70]]) {
    assert(validateLevels(levels).ok, "speech must not depend on old voice-threshold hits");
  }
});
runTest("missing, invalid, stale and sparse meters do not falsely classify quiet speech as silence", () => {
  for (const levels of [[], [NaN, Infinity, 10], [-160], [-90, -90, -90]]) {
    assert(validateLevels(levels).ok, "inconclusive metering should reach ASR");
  }
  const signal = emptyRecordingSignal();
  for (const elapsed of [0, 10, 20, 30]) observeRecordingSignal(signal, -100, elapsed);
  assert(validateSimulationAudioForUpload({ audioUri: "file:///test.m4a", durationMs: 4000, audioBytes: 32000, signal }).ok,
    "four stale callbacks are not sustained capture evidence");
});
