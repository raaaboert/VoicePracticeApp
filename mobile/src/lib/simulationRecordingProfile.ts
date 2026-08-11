const IOS_OUTPUT_FORMAT_MPEG4_AAC = "aac ";
const IOS_AUDIO_QUALITY_MAX = 0x7f;

export const SIMULATION_RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  extension: ".m4a",
  sampleRate: 32_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: {
    outputFormat: "mpeg4" as const,
    audioEncoder: "aac" as const,
  },
  ios: {
    outputFormat: IOS_OUTPUT_FORMAT_MPEG4_AAC,
    audioQuality: IOS_AUDIO_QUALITY_MAX,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128_000,
  },
};

export function getSimulationAudioRecorderOptions(platformOs: string) {
  const { android, ios, web, ...commonOptions } = SIMULATION_RECORDING_OPTIONS;
  const platformOptions = platformOs === "ios" ? ios : platformOs === "android" ? android : web;

  return {
    ...commonOptions,
    ...platformOptions,
  };
}

export function getSimulationTranscriptionMimeType(platformOs: string): string {
  return platformOs === "web" ? "audio/webm" : "audio/m4a";
}
