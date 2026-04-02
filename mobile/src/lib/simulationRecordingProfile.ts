const ANDROID_OUTPUT_FORMAT_MPEG_4 = 2;
const ANDROID_AUDIO_ENCODER_AAC = 3;
const IOS_OUTPUT_FORMAT_MPEG4_AAC = "aac ";
const IOS_AUDIO_QUALITY_MAX = 0x7f;

export const SIMULATION_RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  android: {
    extension: ".m4a",
    outputFormat: ANDROID_OUTPUT_FORMAT_MPEG_4,
    audioEncoder: ANDROID_AUDIO_ENCODER_AAC,
    sampleRate: 32_000,
    numberOfChannels: 1,
    bitRate: 64_000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: IOS_OUTPUT_FORMAT_MPEG4_AAC,
    audioQuality: IOS_AUDIO_QUALITY_MAX,
    sampleRate: 32_000,
    numberOfChannels: 1,
    bitRate: 64_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128_000,
  },
};

export function getSimulationTranscriptionMimeType(platformOs: string): string {
  return platformOs === "web" ? "audio/webm" : "audio/m4a";
}
