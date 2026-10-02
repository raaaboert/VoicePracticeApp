export type TurnFinalizationReason = "user_submit";

export type TurnRecordingStopReason =
  | TurnFinalizationReason
  | "recording_interruption"
  | "app_background"
  | "session_end"
  | "component_cleanup"
  | "audio_error";

export type TurnFinalizeRejectionReason =
  | "no_active_recording"
  | "stale_recording"
  | "non_user_finalization"
  | "duplicate_submission"
  | "turn_processing";

export type TurnFinalizeDecision =
  | { allowed: true }
  | { allowed: false; reason: TurnFinalizeRejectionReason };

export function evaluateTurnFinalizeRequest(params: {
  activeRecordingInstanceId: string | null;
  requestedRecordingInstanceId: string | null;
  finalizationReason: TurnRecordingStopReason;
  explicitUserAction: boolean;
  submissionAlreadyRequested: boolean;
  turnProcessing: boolean;
}): TurnFinalizeDecision {
  if (!params.activeRecordingInstanceId) {
    return { allowed: false, reason: "no_active_recording" };
  }
  if (params.requestedRecordingInstanceId !== params.activeRecordingInstanceId) {
    return { allowed: false, reason: "stale_recording" };
  }
  if (params.finalizationReason !== "user_submit" || !params.explicitUserAction) {
    return { allowed: false, reason: "non_user_finalization" };
  }
  if (params.submissionAlreadyRequested) {
    return { allowed: false, reason: "duplicate_submission" };
  }
  if (params.turnProcessing) {
    return { allowed: false, reason: "turn_processing" };
  }
  return { allowed: true };
}

