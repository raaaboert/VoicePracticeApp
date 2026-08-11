import {
  getSimulationAudioRecorderOptions,
  getSimulationTranscriptionMimeType,
  SIMULATION_RECORDING_OPTIONS,
} from "./simulationRecordingProfile";

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
  assert(SIMULATION_RECORDING_OPTIONS.extension === ".m4a", "native recording should keep the m4a container");
  assert(SIMULATION_RECORDING_OPTIONS.numberOfChannels === 1, "native recording should stay mono");
  assert(SIMULATION_RECORDING_OPTIONS.bitRate === 64_000, "native bitrate should remain speech-optimized");
  assert(SIMULATION_RECORDING_OPTIONS.sampleRate === 32_000, "native sample rate should stay speech-safe");
  assert(SIMULATION_RECORDING_OPTIONS.isMeteringEnabled, "recording metering should remain enabled");
  assert(SIMULATION_RECORDING_OPTIONS.android.outputFormat === "mpeg4", "android should use the mpeg4 format");
  assert(SIMULATION_RECORDING_OPTIONS.android.audioEncoder === "aac", "android should use the aac encoder");

  const androidOptions = getSimulationAudioRecorderOptions("android");
  const iosOptions = getSimulationAudioRecorderOptions("ios");
  assert(androidOptions.numberOfChannels === 1, "imperative android options should include common fields");
  assert("audioEncoder" in androidOptions && androidOptions.audioEncoder === "aac", "android options should be flattened");
  assert(iosOptions.bitRate === 64_000, "imperative ios options should include common fields");
  assert("audioQuality" in iosOptions && iosOptions.audioQuality === 0x7f, "ios options should be flattened");
});

runTest("keeps transcription mime types aligned with the current platform transport", () => {
  assert(getSimulationTranscriptionMimeType("android") === "audio/m4a", "native uploads should stay m4a");
  assert(getSimulationTranscriptionMimeType("ios") === "audio/m4a", "ios uploads should stay m4a");
  assert(getSimulationTranscriptionMimeType("web") === "audio/webm", "web uploads should stay webm");
});
