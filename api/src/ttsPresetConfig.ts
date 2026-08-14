export const TTS_PRESETS = [
  "male-balanced",
  "male-warm",
  "male-bright",
  "female-balanced",
  "female-warm",
  "female-bright",
] as const;

export type TtsPreset = (typeof TTS_PRESETS)[number];

export interface TtsPresetConfig {
  voice: string;
  speed: number;
  instructions: string;
}

export interface TtsRequestConfig extends TtsPresetConfig {
  model: string;
  instructionsIncluded: boolean;
  responseFormat: "mp3";
}

export interface TtsSpeechRequest {
  model: string;
  voice: string;
  text: string;
  format: "mp3";
  speed: number;
  instructions?: string;
  timeoutMs?: number;
}

const TTS_RESPONSE_FORMAT = "mp3" as const;
const TTS_PRESET_SET = new Set<string>(TTS_PRESETS);
const TTS_PRESET_CONFIG: Record<TtsPreset, TtsPresetConfig> = {
  "male-balanced": {
    voice: "cedar",
    speed: 1.03,
    instructions:
      "Use a confident, grounded adult male voice with a neutral, professional, conversational tone. Maintain a natural conversational pace; do not sound drawn-out, theatrical, or like an announcer.",
  },
  "male-warm": {
    voice: "cedar",
    speed: 0.98,
    instructions:
      "Use a warm, grounded adult male voice with a reassuring, supportive, professional tone. Maintain a natural conversational pace; do not sound slow or sleepy.",
  },
  "male-bright": {
    voice: "cedar",
    speed: 1.13,
    instructions:
      "Use a confident, energetic adult male voice with a grounded, professional tone. Speak slightly briskly, but not rushed; do not sound shrill, squeaky, exaggerated, or overly high-pitched.",
  },
  "female-balanced": {
    voice: "marin",
    speed: 0.98,
    instructions:
      "Use a natural, polished female voice with a clear, engaged, professional, conversational tone. Maintain a natural conversational pace; do not sound drawn-out.",
  },
  "female-warm": {
    voice: "shimmer",
    speed: 1.03,
    instructions:
      "Use a warm, supportive female voice with an approachable, reassuring, professional tone. Maintain a natural conversational pace; do not sound slow or sleepy.",
  },
  "female-bright": {
    voice: "marin",
    speed: 1.13,
    instructions:
      "Speak with crisp, engaged, bright professional energy. Keep the pitch natural and adult, and the pace slightly brisk but not rushed. Do not sound high-pitched, cartoonish, or theatrical.",
  },
};

export function parseTtsPreset(value: unknown): TtsPreset | null {
  if (typeof value !== "string") {
    return null;
  }

  const preset = value.trim();
  return TTS_PRESET_SET.has(preset) ? preset as TtsPreset : null;
}

function ttsModelSupportsInstructions(model: string): boolean {
  return model.trim().toLowerCase() === "gpt-4o-mini-tts";
}

export function resolveTtsRequestConfig(preset: TtsPreset, model: string): TtsRequestConfig {
  const presetConfig = TTS_PRESET_CONFIG[preset];
  const instructionsIncluded = ttsModelSupportsInstructions(model);

  return {
    ...presetConfig,
    model,
    instructionsIncluded,
    responseFormat: TTS_RESPONSE_FORMAT,
  };
}

export function buildTtsSpeechRequest(params: {
  preset: TtsPreset;
  model: string;
  text: string;
  timeoutMs?: number;
}): { config: TtsRequestConfig; request: TtsSpeechRequest } {
  const config = resolveTtsRequestConfig(params.preset, params.model);
  return {
    config,
    request: {
      model: config.model,
      voice: config.voice,
      text: params.text,
      format: config.responseFormat,
      speed: config.speed,
      instructions: config.instructionsIncluded ? config.instructions : undefined,
      timeoutMs: params.timeoutMs,
    },
  };
}
