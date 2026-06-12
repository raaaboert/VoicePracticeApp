export const SIMULATION_AUDIO_GUARD_MIN_DURATION_MS = 500;
export const SIMULATION_AUDIO_GUARD_MIN_BYTES = 1_500;

export type SimulationAudioGuardRejectReason = "missing_file" | "too_small" | "too_short";

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

export function validateSimulationAudioForUpload(params: {
  audioUri?: string | null;
  fileExists?: boolean | null;
  audioBytes?: number | null;
  durationMs?: number | null;
  voiceEvidence?: boolean;
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
