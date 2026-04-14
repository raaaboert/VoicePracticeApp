export type SimulationTurnSummaryMode = "remote" | "local_mock" | "local_fallback";
export type SimulationTurnSummaryOutcome =
  | "playback_started"
  | "no_clear_speech"
  | "error"
  | "playback_signal_missing";

export interface SimulationTurnTimingSummaryInput {
  simulationSessionId: string;
  correlationId: string;
  trigger: string;
  mode: SimulationTurnSummaryMode;
  outcome: SimulationTurnSummaryOutcome;
  submitStartedAtMs: number;
  recordingFinalizeCompletedAtMs?: number | null;
  unifiedSubmitRequestStartedAtMs?: number | null;
  unifiedSubmitResponseAtMs?: number | null;
  transcribeRequestStartedAtMs?: number | null;
  transcribeResponseAtMs?: number | null;
  assistantRequestStartedAtMs?: number | null;
  assistantResponseAtMs?: number | null;
  assistantTextCommittedAtMs?: number | null;
  ttsPipelineStartedAtMs?: number | null;
  audioModeResetAwaitStartedAtMs?: number | null;
  audioModeResetCompletedAtMs?: number | null;
  playbackStartedAtMs?: number | null;
  speakingCompletedAtMs?: number | null;
  transcriptChars?: number;
  replyChars?: number;
  errorMessage?: string | null;
}

function durationMs(start?: number | null, end?: number | null): number | undefined {
  if (typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }
  return Math.max(0, end - start);
}

export function buildSimulationTurnTimingSummary(input: SimulationTurnTimingSummaryInput): Record<string, unknown> {
  return {
    event: "simulation-turn-summary",
    simulationSessionId: input.simulationSessionId,
    correlationId: input.correlationId,
    trigger: input.trigger,
    mode: input.mode,
    outcome: input.outcome,
    transcriptChars: input.transcriptChars ?? 0,
    replyChars: input.replyChars ?? 0,
    submitToFinalizeMs: durationMs(input.submitStartedAtMs, input.recordingFinalizeCompletedAtMs),
    unifiedSubmitRoundTripMs: durationMs(input.unifiedSubmitRequestStartedAtMs, input.unifiedSubmitResponseAtMs),
    transcribeRoundTripMs: durationMs(input.transcribeRequestStartedAtMs, input.transcribeResponseAtMs),
    submitToTranscriptMs: durationMs(input.submitStartedAtMs, input.transcribeResponseAtMs),
    assistantRoundTripMs: durationMs(input.assistantRequestStartedAtMs, input.assistantResponseAtMs),
    submitToAssistantMs: durationMs(input.submitStartedAtMs, input.assistantResponseAtMs),
    assistantReadyToPlaybackMs: durationMs(input.assistantResponseAtMs, input.playbackStartedAtMs),
    assistantReadyToVisibleMs: durationMs(input.assistantResponseAtMs, input.assistantTextCommittedAtMs),
    submitToAssistantVisibleMs: durationMs(input.submitStartedAtMs, input.assistantTextCommittedAtMs),
    visibleLeadBeforePlaybackMs: durationMs(input.assistantTextCommittedAtMs, input.playbackStartedAtMs),
    ttsStartupMs: durationMs(input.ttsPipelineStartedAtMs, input.playbackStartedAtMs),
    audioModeResetWaitMs: durationMs(input.audioModeResetAwaitStartedAtMs, input.audioModeResetCompletedAtMs),
    submitToPlaybackMs: durationMs(input.submitStartedAtMs, input.playbackStartedAtMs),
    submitToSpeakingCompleteMs: durationMs(input.submitStartedAtMs, input.speakingCompletedAtMs),
    playbackToSpeakingCompleteMs: durationMs(input.playbackStartedAtMs, input.speakingCompletedAtMs),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}
