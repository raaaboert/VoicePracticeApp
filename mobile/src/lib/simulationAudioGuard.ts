export const SIMULATION_AUDIO_GUARD_MIN_DURATION_MS = 500;
export const SIMULATION_AUDIO_GUARD_MIN_BYTES = 1_500;

export type SimulationAudioGuardRejectReason = "missing_file" | "too_small" | "too_short" | "silent_signal";
export type SimulationCaptureFailureReason = SimulationAudioGuardRejectReason | "no_usable_transcript";
export type SimulationTranscriptionTrigger = "submit" | "automatic";

export type SimulationAudioGuardResult =
  | {
      ok: true;
      metadataUnavailable: boolean;
    }
  | {
      ok: false;
      reason: SimulationAudioGuardRejectReason;
      metadataUnavailable: boolean;
    };

export function shouldAttemptSimulationTranscription(params: {
  trigger: SimulationTranscriptionTrigger;
  meteringSeen: boolean;
  detectedVoice: boolean;
  heardVoice: boolean;
  turnDurationSeconds: number;
}): boolean {
  if (params.trigger === "submit") {
    return true;
  }

  return (
    params.detectedVoice
    || params.heardVoice
    || (!params.meteringSeen && params.turnDurationSeconds >= 3)
  );
}

export function getSimulationCaptureFailureStatus(
  reason: SimulationCaptureFailureReason,
): string {
  switch (reason) {
    case "missing_file":
    case "too_small":
    case "too_short":
    case "no_usable_transcript":
    case "silent_signal":
      return "We received your response, but didn't hear clear speech. Check your microphone and try again.";
  }
}

export function validateSimulationAudioForUpload(params: {
  audioUri?: string | null;
  fileExists?: boolean | null;
  audioBytes?: number | null;
  durationMs?: number | null;
  voiceEvidence?: boolean;
  signal?: RecordingSignalEvidence;
}): SimulationAudioGuardResult {
  const hasUri = typeof params.audioUri === "string" && params.audioUri.trim().length > 0;
  if (!hasUri || params.fileExists === false) {
    return {
      ok: false,
      reason: "missing_file",
      metadataUnavailable: false,
    };
  }

  const hasSizeMetadata = typeof params.audioBytes === "number" && Number.isFinite(params.audioBytes);
  const hasDurationMetadata = typeof params.durationMs === "number" && Number.isFinite(params.durationMs);
  const metadataUnavailable = !hasSizeMetadata || !hasDurationMetadata;

  if (params.signal && isConfirmedSilentRecording(params.signal, params.durationMs ?? 0)) {
    return { ok: false, reason: "silent_signal", metadataUnavailable };
  }

  if (hasSizeMetadata && Math.max(0, params.audioBytes ?? 0) < SIMULATION_AUDIO_GUARD_MIN_BYTES) {
    return {
      ok: false,
      reason: "too_small",
      metadataUnavailable,
    };
  }

  if (
    hasDurationMetadata &&
    Math.max(0, params.durationMs ?? 0) < SIMULATION_AUDIO_GUARD_MIN_DURATION_MS &&
    !params.voiceEvidence
  ) {
    return {
      ok: false,
      reason: "too_short",
      metadataUnavailable,
    };
  }

  return {
    ok: true,
    metadataUnavailable,
  };
}

/** Aggregate levels only; neither samples nor recordings are retained here. */
export interface RecordingSignalEvidence {
  samples: number;
  minimumDb: number;
  maximumDb: number;
  firstMs: number;
  lastMs: number;
  unavailable: boolean;
}
export function emptyRecordingSignal(): RecordingSignalEvidence {
  return { samples: 0, minimumDb: Infinity, maximumDb: -Infinity, firstMs: 0, lastMs: 0, unavailable: false };
}
export function observeRecordingSignal(signal: RecordingSignalEvidence, db: number | undefined, elapsedMs: number): void {
  // Expo Android maps both zero amplitude AND getMaxAmplitude failures to -160.
  // A gap could contain speech, so any unavailable reading makes this whole
  // turn inconclusive. Only server audio analysis can be authoritative.
  if (typeof db !== "number" || !Number.isFinite(db) || db <= -160 || db > 0
    || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    signal.unavailable = true;
    return;
  }
  if (!signal.samples) signal.firstMs = elapsedMs;
  signal.samples++;
  signal.minimumDb = Math.min(signal.minimumDb, db);
  signal.maximumDb = Math.max(signal.maximumDb, db);
  signal.lastMs = elapsedMs;
}
export function isConfirmedSilentRecording(signal: RecordingSignalEvidence, durationMs: number): boolean {
  // Missing/sparse meters remain inconclusive. Preserve quiet modulated speech:
  // lack of the old voice-threshold hits alone is never a rejection reason.
  return (
    Number.isFinite(durationMs)
    && !signal.unavailable
    && durationMs >= 600
    && signal.samples >= 4
    && signal.lastMs - signal.firstMs >= durationMs * 0.5
    && signal.maximumDb <= -70
    && signal.maximumDb - signal.minimumDb <= 3
  );
}
