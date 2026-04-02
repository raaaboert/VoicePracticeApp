import { getSimulationTranscriptionMimeType, SIMULATION_RECORDING_OPTIONS } from "./simulationRecordingProfile";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  // eslint-disable-next-line no-console
  console.log(`[simulation-recording-profile.test] PASS ${name}`);
}

runTest("uses speech-optimized native recording settings without changing the container format", () => {
  assert(SIMULATION_RECORDING_OPTIONS.android.extension === ".m4a", "android should keep m4a recording");
  assert(SIMULATION_RECORDING_OPTIONS.ios.extension === ".m4a", "ios should keep m4a recording");
  assert(SIMULATION_RECORDING_OPTIONS.android.numberOfChannels === 1, "android should record mono audio");
  assert(SIMULATION_RECORDING_OPTIONS.ios.numberOfChannels === 1, "ios should record mono audio");
  assert(SIMULATION_RECORDING_OPTIONS.android.bitRate === 64_000, "android bitrate should be reduced for speech");
  assert(SIMULATION_RECORDING_OPTIONS.ios.bitRate === 64_000, "ios bitrate should be reduced for speech");
  assert(SIMULATION_RECORDING_OPTIONS.android.sampleRate === 32_000, "android sample rate should stay speech-safe");
  assert(SIMULATION_RECORDING_OPTIONS.ios.sampleRate === 32_000, "ios sample rate should stay speech-safe");
});

runTest("keeps transcription mime types aligned with the current platform transport", () => {
  assert(getSimulationTranscriptionMimeType("android") === "audio/m4a", "native uploads should stay m4a");
  assert(getSimulationTranscriptionMimeType("ios") === "audio/m4a", "ios uploads should stay m4a");
  assert(getSimulationTranscriptionMimeType("web") === "audio/webm", "web uploads should stay webm");
});
