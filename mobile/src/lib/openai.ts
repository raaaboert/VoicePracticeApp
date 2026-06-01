import { Platform } from "react-native";
import { Difficulty, DialogueMessage, PersonaStyle, Scenario, SimulationEvaluationResult } from "../types";
import {
  awaitSimulationTurnResultViaApi,
  fetchAiOpeningLine,
  fetchAiScore,
  fetchAiTurn,
  submitSimulationTurnViaApi,
  transcribeAudioViaApi,
} from "./api";
import type { PrefetchedRemoteSpeechChunk, RemoteTtsPreset, UnifiedSimulationTurnPayload } from "./api";
import { getSimulationTranscriptionMimeType } from "./simulationRecordingProfile";
export {
  isUsableSimulationTranscript,
  shouldFallbackToLegacyAssistantReply,
  shouldFallbackToLegacyUnifiedSubmit,
} from "./unifiedSubmit";

// Remote AI calls now go through the Node API. This flag simply controls whether the app
// should attempt calling the backend or stay in local test mode.
const REMOTE_AI_ENABLED = process.env.EXPO_PUBLIC_REMOTE_AI_ENABLED === "true";
const UNIFIED_SIMULATION_SUBMIT_ENABLED = process.env.EXPO_PUBLIC_SIMULATION_UNIFIED_SUBMIT_ENABLED !== "false";
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log(
    `[openai-config] EXPO_PUBLIC_REMOTE_AI_ENABLED=${String(process.env.EXPO_PUBLIC_REMOTE_AI_ENABLED)} resolvedRemote=${REMOTE_AI_ENABLED}`,
  );
}

export function isOpenAiConfigured(): boolean {
  return REMOTE_AI_ENABLED;
}

export function isUnifiedSimulationSubmitEnabled(): boolean {
  return REMOTE_AI_ENABLED && UNIFIED_SIMULATION_SUBMIT_ENABLED;
}

export async function createOpeningLine(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenario: Scenario;
  trainingId?: string | null;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  speechPrefetchPreset?: RemoteTtsPreset | null;
  correlationId?: string;
}): Promise<{ assistantText: string; trainingPackId: string | null; speechPrefetch: PrefetchedRemoteSpeechChunk | null }> {
  const payload = await fetchAiOpeningLine({
    userId: params.userId,
    authToken: params.authToken,
    simulationSessionId: params.simulationSessionId,
    scenarioId: params.scenario.id,
    trainingId: params.trainingId ?? undefined,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
    speechPrefetch: params.speechPrefetchPreset ? { preset: params.speechPrefetchPreset } : null,
    correlationId: params.correlationId,
  });

  return {
    assistantText: payload.assistantText?.trim() ?? "",
    trainingPackId: payload.trainingPack?.applied === true ? payload.trainingPack.id ?? null : null,
    speechPrefetch: payload.speechPrefetch,
  };
}

export async function generateAssistantReply(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenario: Scenario;
  trainingId?: string | null;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
  trainingPackId?: string | null;
  speechPrefetchPreset?: RemoteTtsPreset | null;
  correlationId?: string;
  signal?: AbortSignal;
}): Promise<{ assistantText: string; speechPrefetch: PrefetchedRemoteSpeechChunk | null }> {
  const payload = await fetchAiTurn({
    userId: params.userId,
    authToken: params.authToken,
    simulationSessionId: params.simulationSessionId,
    scenarioId: params.scenario.id,
    trainingId: params.trainingId ?? undefined,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
    history: params.history,
    trainingPackId: params.trainingPackId ?? undefined,
    speechPrefetch: params.speechPrefetchPreset ? { preset: params.speechPrefetchPreset } : null,
    correlationId: params.correlationId,
    signal: params.signal,
  });

  return {
    assistantText: payload.assistantText?.trim() ?? "",
    speechPrefetch: payload.speechPrefetch,
  };
}

export async function transcribeAudio(params: {
  userId: string;
  authToken: string;
  audioUri: string;
  preferredMimeType?: string;
  correlationId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const defaultMimeType = getSimulationTranscriptionMimeType(Platform.OS);
  const mimeType = params.preferredMimeType ?? defaultMimeType;

  return transcribeAudioViaApi({
    userId: params.userId,
    authToken: params.authToken,
    audioUri: params.audioUri,
    mimeType,
    correlationId: params.correlationId,
    signal: params.signal,
  });
}

export async function submitRecordedSimulationTurn(params: {
  userId: string;
  authToken: string;
  audioUri: string;
  preferredMimeType?: string;
  simulationSessionId: string;
  scenario: Scenario;
  trainingId?: string | null;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  history: DialogueMessage[];
  trainingPackId?: string | null;
  speechPrefetchPreset?: RemoteTtsPreset | null;
  responseMode?: "complete" | "transcript_first_v1";
  correlationId?: string;
  signal?: AbortSignal;
}): Promise<UnifiedSimulationTurnPayload> {
  const defaultMimeType = getSimulationTranscriptionMimeType(Platform.OS);
  const mimeType = params.preferredMimeType ?? defaultMimeType;

  return submitSimulationTurnViaApi({
    userId: params.userId,
    authToken: params.authToken,
    audioUri: params.audioUri,
    mimeType,
    simulationSessionId: params.simulationSessionId,
    scenarioId: params.scenario.id,
    trainingId: params.trainingId ?? undefined,
    industryId: params.industryId,
    industryBaseline: params.industryBaseline,
    difficulty: params.difficulty,
    personaStyle: params.personaStyle,
    history: params.history,
    trainingPackId: params.trainingPackId ?? undefined,
    speechPrefetch: params.speechPrefetchPreset ? { preset: params.speechPrefetchPreset } : null,
    responseMode: params.responseMode ?? "complete",
    correlationId: params.correlationId,
    signal: params.signal,
  });
}

export async function awaitSubmittedSimulationTurnReply(params: {
  userId: string;
  authToken: string;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<{
  outcome: "assistant_reply" | "no_clear_speech";
  transcriptText: string;
  noClearSpeechReason?: "empty_transcript" | "assistant_echo" | null;
  assistantText?: string;
  speechPrefetch?: PrefetchedRemoteSpeechChunk | null;
  runtime: UnifiedSimulationTurnPayload["runtime"];
}> {
  const payload = await awaitSimulationTurnResultViaApi({
    userId: params.userId,
    authToken: params.authToken,
    correlationId: params.correlationId,
    signal: params.signal,
  });

  if (payload.outcome === "assistant_reply") {
    return {
      outcome: "assistant_reply",
      transcriptText: payload.transcriptText,
      assistantText: payload.assistantText,
      speechPrefetch: payload.speechPrefetch,
      runtime: payload.runtime,
    };
  }

  return {
    outcome: "no_clear_speech",
    transcriptText: payload.transcriptText,
    noClearSpeechReason: payload.noClearSpeechReason,
    runtime: payload.runtime,
  };
}

export async function evaluateSimulation(params: {
  userId: string;
  authToken: string;
  simulationSessionId: string;
  scenario: Scenario;
  trainingId?: string | null;
  industryId?: string;
  industryBaseline?: string;
  difficulty: Difficulty;
  segmentLabel: string;
  personaStyle: PersonaStyle;
  startedAt: string;
  endedAt: string;
  history: DialogueMessage[];
  trainingPackId?: string | null;
}): Promise<SimulationEvaluationResult> {
  return fetchAiScore({
    userId: params.userId,
    authToken: params.authToken,
    simulationSessionId: params.simulationSessionId,
    scenarioId: params.scenario.id,
    trainingId: params.trainingId ?? undefined,
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
