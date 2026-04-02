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
  transcribeRequestStartedAtMs?: number | null;
  transcribeResponseAtMs?: number | null;
  assistantRequestStartedAtMs?: number | null;
  assistantResponseAtMs?: number | null;
  ttsPipelineStartedAtMs?: number | null;
  playbackStartedAtMs?: number | null;
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
    transcribeRoundTripMs: durationMs(input.transcribeRequestStartedAtMs, input.transcribeResponseAtMs),
    submitToTranscriptMs: durationMs(input.submitStartedAtMs, input.transcribeResponseAtMs),
    assistantRoundTripMs: durationMs(input.assistantRequestStartedAtMs, input.assistantResponseAtMs),
    submitToAssistantMs: durationMs(input.submitStartedAtMs, input.assistantResponseAtMs),
    ttsStartupMs: durationMs(input.ttsPipelineStartedAtMs, input.playbackStartedAtMs),
    submitToPlaybackMs: durationMs(input.submitStartedAtMs, input.playbackStartedAtMs),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}
