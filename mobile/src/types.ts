import {
  AppConfig,
  Difficulty,
  PersonaStyle,
  Scenario,
  SegmentDefinition,
  TierDefinition,
  TierId,
  UserEntitlementsResponse,
  UserProfile,
} from "@voicepractice/shared";

export type {
  AppConfig,
  Difficulty,
  PersonaStyle,
  Scenario,
  SegmentDefinition,
  TierDefinition,
  TierId,
  UserEntitlementsResponse,
  UserProfile,
};

export type TrainingSegmentId = string;

export type DialogueRole = "user" | "assistant";
export type AppColorScheme = "soft_light" | "classic_blue";
export type AiVoiceProfile = "balanced" | "warm" | "bright";
export type AiVoiceGender = "female" | "male";

export interface DialogueMessage {
  id: string;
  role: DialogueRole;
  content: string;
}

export interface SimulationScorecard {
  overallScore: number;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

export interface SimulationConfig {
  scenario: Scenario;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  voiceProfile: AiVoiceProfile;
  voiceGender: AiVoiceGender;
  maxSimulationMinutes: number | null;
}

export interface SessionTiming {
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
}
