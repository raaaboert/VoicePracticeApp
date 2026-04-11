import {
  AppConfig,
  Difficulty,
  OrgCustomScenario,
  PersonaStyle,
  SimulationCompletionLevel,
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
  OrgCustomScenario,
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
  communicationScore: number;
  outcomeScore: number;
  overallScore: number;
  completionLevel: SimulationCompletionLevel;
  objectiveAchieved: boolean;
  persuasion: number;
  clarity: number;
  empathy: number;
  assertiveness: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

export interface ScoredSimulationEvaluationResult {
  status: "scored";
  scorecard: SimulationScorecard;
  record: {
    id: string;
    createdAt: string;
    trainingPackId?: string | null;
    model: string | null;
    promptVersion: string | null;
    rubricVersion: string | null;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
}

export interface NotScoredSimulationEvaluationResult {
  status: "not_scored";
  reason: "insufficient_evidence";
  userTurnCount: number;
  minimumUserTurns: number;
  message: string;
}

export type SimulationEvaluationResult =
  | ScoredSimulationEvaluationResult
  | NotScoredSimulationEvaluationResult;

export interface SimulationConfig {
  simulationSessionId: string;
  scenario: Scenario;
  industryId: string;
  industryLabel: string;
  industryBaseline: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  voiceProfile: AiVoiceProfile;
  voiceGender: AiVoiceGender;
  remoteTtsEnabled: boolean;
  maxSimulationMinutes: number | null;
  trainingId?: string | null;
}

export interface SessionTiming {
  simulationSessionId: string;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
  usedMockMode: boolean;
  trainingId?: string | null;
  trainingPackId?: string | null;
}
