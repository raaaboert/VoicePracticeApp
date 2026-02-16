import { AiVoiceGender, AiVoiceProfile, AppColorScheme } from "../types";

export const COLOR_SCHEME_OPTIONS: Array<{
  id: AppColorScheme;
  label: string;
  description: string;
}> = [
  {
    id: "soft_light",
    label: "Soft Light",
    description: "Off-white background with high-contrast text.",
  },
  {
    id: "classic_blue",
    label: "Classic Blue",
    description: "Current blue gradient visual style.",
  },
];

export const AI_VOICE_OPTIONS: Array<{
  id: AiVoiceProfile;
  label: string;
  description: string;
  speechRate: number;
  speechPitch: number;
}> = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Neutral pacing and tone for most scenarios.",
    speechRate: 0.97,
    speechPitch: 1.0,
  },
  {
    id: "warm",
    label: "Warm",
    description: "Slightly slower and lower tone.",
    speechRate: 0.92,
    speechPitch: 0.92,
  },
  {
    id: "bright",
    label: "Bright",
    description: "Faster and slightly higher tone.",
    speechRate: 1.03,
    speechPitch: 1.12,
  },
];

export const AI_VOICE_GENDER_OPTIONS: Array<{
  id: AiVoiceGender;
  label: string;
}> = [
  {
    id: "female",
    label: "Female",
  },
  {
    id: "male",
    label: "Male",
  },
];

const AI_VOICE_MAP: Record<AiVoiceProfile, (typeof AI_VOICE_OPTIONS)[number]> = AI_VOICE_OPTIONS.reduce(
  (accumulator, option) => {
    accumulator[option.id] = option;
    return accumulator;
  },
  {} as Record<AiVoiceProfile, (typeof AI_VOICE_OPTIONS)[number]>,
);

export function getAiVoiceOption(profile: AiVoiceProfile): (typeof AI_VOICE_OPTIONS)[number] {
  return AI_VOICE_MAP[profile] ?? AI_VOICE_MAP.balanced;
}

function containsAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

const MALE_HINTS = [
  "male",
  "#male",
  "male_",
  "male-",
  "_male",
  "-male",
  "man",
  "guy",
  "voice_m",
  "iom",
  "ion",
  "male_1",
  "m_1",
  "david",
  "alex",
  "tom",
  "matt",
  "daniel",
  "james",
  "george",
  "fred",
];

const FEMALE_HINTS = [
  "female",
  "#female",
  "female_",
  "female-",
  "_female",
  "-female",
  "woman",
  "voice_f",
  "iof",
  "ioa",
  "female_1",
  "f_1",
  "samantha",
  "victoria",
  "karen",
  "lisa",
  "anna",
  "allison",
  "ava",
  "zoe",
  "emily",
];

export function selectSpeechVoiceIdentifier(
  voices: Array<{ identifier: string; name?: string; language?: string }>,
  gender: AiVoiceGender,
): string | undefined {
  if (!voices || voices.length === 0) {
    return undefined;
  }

  const englishVoices = voices.filter((voice) => voice.language?.toLowerCase().startsWith("en"));
  const candidates = englishVoices.length > 0 ? englishVoices : voices;
  const hints = gender === "male" ? MALE_HINTS : FEMALE_HINTS;

  const preferred = candidates.find((voice) => {
    const searchable = `${voice.identifier ?? ""} ${voice.name ?? ""}`.toLowerCase();
    return containsAny(searchable, hints);
  });

  if (preferred?.identifier) {
    return preferred.identifier;
  }

  if (gender === "male" && candidates.length > 1) {
    return candidates[candidates.length - 1]?.identifier ?? candidates[0]?.identifier;
  }

  return candidates[0]?.identifier;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getVoiceSpeechTuning(
  profile: AiVoiceProfile,
  gender: AiVoiceGender,
): { speechRate: number; speechPitch: number } {
  const base = getAiVoiceOption(profile);
  let speechRate = base.speechRate;
  let speechPitch = base.speechPitch;

  if (gender === "male") {
    if (profile === "warm") {
      speechRate *= 0.84;
      speechPitch *= 0.64;
    } else if (profile === "bright") {
      speechRate *= 1.12;
      speechPitch *= 0.9;
    } else {
      speechRate *= 0.94;
      speechPitch *= 0.76;
    }
  }

  return {
    speechRate: clamp(speechRate, 0.6, 1.4),
    speechPitch: clamp(speechPitch, 0.5, 2),
  };
}
