import { Platform } from "react-native";
import { Difficulty, DialogueMessage, PersonaStyle, Scenario, SimulationScorecard } from "../types";
import { fetchAiOpeningLine, fetchAiScore, fetchAiTurn, transcribeAudioViaApi } from "./api";

// Remote AI calls now go through the Node API. This flag simply controls whether the app
// should attempt calling the backend or stay in local test mode.
const REMOTE_AI_ENABLED = process.env.EXPO_PUBLIC_REMOTE_AI_ENABLED === "true";
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log(
    `[openai-config] EXPO_PUBLIC_REMOTE_AI_ENABLED=${String(process.env.EXPO_PUBLIC_REMOTE_AI_ENABLED)} resolvedRemote=${REMOTE_AI_ENABLED}`,
  );
}

export function isOpenAiConfigured(): boolean {
  return REMOTE_AI_ENABLED;
}

export async function createOpeningLine(params: {
  userId: string;
  authToken: string;
  scenario: Scenario;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
}): Promise<{ assistantText: string; trainingPackId: string | null }> {
  const payload = await fetchAiOpeningLine({
    userId: params.userId,
    authToken: params.authToken,
    scenarioId: params.scenario.id,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
  });

  return {
    assistantText: payload.assistantText?.trim() ?? "",
    trainingPackId: payload.trainingPack?.applied === true ? payload.trainingPack.id ?? null : null,
  };
}

export async function generateAssistantReply(params: {
  userId: string;
  authToken: string;
  scenario: Scenario;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
  trainingPackId?: string | null;
}): Promise<string> {
  const payload = await fetchAiTurn({
    userId: params.userId,
    authToken: params.authToken,
    scenarioId: params.scenario.id,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
    history: params.history,
    trainingPackId: params.trainingPackId ?? undefined,
  });

  return payload.assistantText?.trim() ?? "";
}

export async function transcribeAudio(params: {
  userId: string;
  authToken: string;
  audioUri: string;
  preferredMimeType?: string;
}): Promise<string> {
  const defaultMimeType = Platform.OS === "web" ? "audio/webm" : "audio/m4a";
  const mimeType = params.preferredMimeType ?? defaultMimeType;

  return transcribeAudioViaApi({
    userId: params.userId,
    authToken: params.authToken,
    audioUri: params.audioUri,
    mimeType,
  });
}

export async function evaluateSimulation(params: {
  userId: string;
  authToken: string;
  scenario: Scenario;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  startedAt: string;
  endedAt: string;
  history: DialogueMessage[];
  trainingPackId?: string | null;
}): Promise<{
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
}> {
  return fetchAiScore({
    userId: params.userId,
    authToken: params.authToken,
    scenarioId: params.scenario.id,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    history: params.history,
    trainingPackId: params.trainingPackId ?? undefined,
  });
}
