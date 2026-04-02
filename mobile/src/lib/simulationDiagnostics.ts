export type TtsCancellationReason =
  | "superseded"
  | "session_ending"
  | "screen_changing"
  | "abort_signal"
  | "unknown";

export interface TtsCancellationAnalysisInput {
  source: "simulation" | "sample";
  correlationId?: string | null;
  simulationSessionId?: string | null;
  sourceKind?: "inline" | "file" | null;
  playbackStarted: boolean;
  fallbackAttempted: boolean;
  fallbackSucceeded: boolean;
  chunkIndex?: number | null;
  chunkCount?: number | null;
  abortSignaled: boolean;
  superseded: boolean;
  sessionEnding: boolean;
  screenChanging: boolean;
}

export interface TtsCancellationAnalysis extends TtsCancellationAnalysisInput {
  expected: boolean;
  reason: TtsCancellationReason;
  likelyUserFacing: boolean;
  summary: string;
}

export function analyzeTtsCancellation(input: TtsCancellationAnalysisInput): TtsCancellationAnalysis {
  let reason: TtsCancellationReason = "unknown";
  if (input.superseded) {
    reason = "superseded";
  } else if (input.sessionEnding) {
    reason = "session_ending";
  } else if (input.screenChanging) {
    reason = "screen_changing";
  } else if (input.abortSignaled) {
    reason = "abort_signal";
  }

  const expected = reason !== "unknown";
  const likelyUserFacing = !expected && !input.playbackStarted;

  const reasonLabel =
    reason === "superseded"
      ? "superseded by a newer playback request"
      : reason === "session_ending"
        ? "session was ending"
        : reason === "screen_changing"
          ? "screen was changing"
          : reason === "abort_signal"
            ? "playback request was aborted"
            : "cancellation source was unclear";

  const summary = `TTS playback cancelled (${reasonLabel}; playbackStarted=${input.playbackStarted ? "yes" : "no"}; sourceKind=${input.sourceKind ?? "unknown"}; fallbackAttempted=${input.fallbackAttempted ? "yes" : "no"}; fallbackSucceeded=${input.fallbackSucceeded ? "yes" : "no"}).`;

  return {
    ...input,
    expected,
    reason,
    likelyUserFacing,
    summary,
  };
}

type UsageRecordGuardField = "simulationSessionId" | "userId" | "segmentId" | "scenarioId";

export function getMissingUsageRecordFields(input: {
  simulationSessionId?: string | null;
  userId?: string | null;
  segmentId?: string | null;
  scenarioId?: string | null;
}): UsageRecordGuardField[] {
  const requiredFields: UsageRecordGuardField[] = [
    "simulationSessionId",
    "userId",
    "segmentId",
    "scenarioId",
  ];

  return requiredFields.filter((field) => {
    const value = input[field];
    return typeof value !== "string" || !value.trim();
  });
}

export function getLongPollFailureReportDecision(params: {
  consecutiveFailures: number;
  sinceFirstFailureMs: number;
}): {
  shouldReport: boolean;
  reason: "transient" | "threshold_crossed" | "persistent";
} {
  if (params.consecutiveFailures < 3) {
    return { shouldReport: false, reason: "transient" };
  }

  if (params.consecutiveFailures === 3) {
    return { shouldReport: true, reason: "threshold_crossed" };
  }

  if (params.sinceFirstFailureMs >= 120_000 && params.consecutiveFailures % 10 === 0) {
    return { shouldReport: true, reason: "persistent" };
  }

  return { shouldReport: false, reason: "persistent" };
}

export function buildNoTranscriptDiagnostics(params: {
  audioBytes?: number | null;
  recordingDurationSeconds: number;
  contentType?: string | null;
  fileExtension?: string | null;
  remoteTranscriptionAttempted: boolean;
  transcriptionRequestFailed: boolean;
  transcriptionErrorMessage?: string | null;
  transcriptText?: string | null;
  usedLocalFallback: boolean;
  localFallbackReason?: string | null;
}): {
  classification:
    | "local_fallback"
    | "transcription_not_attempted"
    | "request_failed"
    | "tiny_or_empty_recording"
    | "empty_transcript_result";
  suspiciouslyTinyAudio: boolean;
  audioBytes: number | null;
  recordingDurationSeconds: number;
  contentType: string | null;
  fileExtension: string | null;
  remoteTranscriptionAttempted: boolean;
  transcriptionRequestFailed: boolean;
  transcriptionErrorMessage: string | null;
  transcriptLength: number;
  usedLocalFallback: boolean;
  localFallbackReason: string | null;
} {
  const audioBytes = typeof params.audioBytes === "number" && Number.isFinite(params.audioBytes)
    ? Math.max(0, Math.floor(params.audioBytes))
    : null;
  const transcriptLength = params.transcriptText?.trim().length ?? 0;
  const suspiciouslyTinyAudio =
    (audioBytes !== null && audioBytes <= 4_096) ||
    (audioBytes === null && params.recordingDurationSeconds <= 1);

  let classification:
    | "local_fallback"
    | "transcription_not_attempted"
    | "request_failed"
    | "tiny_or_empty_recording"
    | "empty_transcript_result";

  if (params.usedLocalFallback) {
    classification = "local_fallback";
  } else if (!params.remoteTranscriptionAttempted) {
    classification = "transcription_not_attempted";
  } else if (params.transcriptionRequestFailed) {
    classification = "request_failed";
  } else if (suspiciouslyTinyAudio) {
    classification = "tiny_or_empty_recording";
  } else {
    classification = "empty_transcript_result";
  }

  return {
    classification,
    suspiciouslyTinyAudio,
    audioBytes,
    recordingDurationSeconds: params.recordingDurationSeconds,
    contentType: params.contentType?.trim() || null,
    fileExtension: params.fileExtension?.trim() || null,
    remoteTranscriptionAttempted: params.remoteTranscriptionAttempted,
    transcriptionRequestFailed: params.transcriptionRequestFailed,
    transcriptionErrorMessage: params.transcriptionErrorMessage?.trim() || null,
    transcriptLength,
    usedLocalFallback: params.usedLocalFallback,
    localFallbackReason: params.localFallbackReason?.trim() || null,
  };
}
