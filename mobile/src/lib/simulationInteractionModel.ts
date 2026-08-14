export type SimulationTurnMode = "idle" | "thinking" | "speaking" | "recording";

export interface SimulationStartProgress {
  openingDelivered: boolean;
  recognizedStartRegistered: boolean;
}

export type TurnFinalizeTrigger = "submit";
export type TurnRecordingSafetySignal = "long-pause" | "soft-limit" | "absolute-limit";
export const SIMULATION_FINALIZE_RETRY_STATUS = "We couldn't process that response. Please try again.";
export type SimulationLifecycleResumeIntent =
  | {
      kind: "replay_assistant";
      assistantMessageId: string;
      assistantText: string;
      assistantMessageCommitted: boolean;
    }
  | {
      kind: "restart_recording";
    };
export type SimulationPrimaryButtonRoute =
  | "ignore"
  | "submit_response"
  | "resume_lifecycle"
  | "restart_recording"
  | "start_session";

export interface PrimarySimulationAction {
  kind: "start" | "submit" | "busy";
  label: string;
  disabled: boolean;
}

export function getSimulationStartPlan(progress: SimulationStartProgress): {
  shouldDeliverOpening: boolean;
  shouldRegisterRecognizedStart: boolean;
} {
  return {
    shouldDeliverOpening: !progress.openingDelivered,
    shouldRegisterRecognizedStart: !progress.recognizedStartRegistered,
  };
}

export function getPrimarySimulationAction(params: {
  sessionActive: boolean;
  isInitializing: boolean;
  mode: SimulationTurnMode;
  isStartingSession?: boolean;
  isStartingTurn?: boolean;
}): PrimarySimulationAction {
  if (!params.sessionActive) {
    if (params.isStartingSession) {
      return {
        kind: "busy",
        label: "Starting...",
        disabled: true,
      };
    }

    return {
      kind: "start",
      label: "Start Simulation",
      disabled: params.isInitializing || params.mode === "thinking" || params.mode === "speaking",
    };
  }

  if (params.mode === "idle") {
    if (params.isStartingTurn) {
      return {
        kind: "busy",
        label: "Reconnecting...",
        disabled: true,
      };
    }
    return {
      kind: "start",
      label: "Resume Turn",
      disabled: params.isInitializing,
    };
  }

  if (params.mode === "recording") {
    return {
      kind: "submit",
      label: "Submit Response",
      disabled: false,
    };
  }

  return {
    kind: "busy",
    label: params.mode === "speaking" ? "AI Responding..." : "Processing...",
    disabled: true,
  };
}

export function getSimulationLifecycleResumeIntent(params: {
  activeAssistantSpeech: {
    messageId: string;
    text: string;
    committed: boolean;
  } | null;
}): SimulationLifecycleResumeIntent {
  const activeAssistantText = params.activeAssistantSpeech?.text.trim() ?? "";
  const assistantMessageId = params.activeAssistantSpeech?.messageId.trim() ?? "";
  if (activeAssistantText && assistantMessageId) {
    return {
      kind: "replay_assistant",
      assistantMessageId,
      assistantText: activeAssistantText,
      assistantMessageCommitted: Boolean(params.activeAssistantSpeech?.committed),
    };
  }

  return {
    kind: "restart_recording",
  };
}

export function shouldCommitResumedAssistantResponse(params: {
  intent: SimulationLifecycleResumeIntent;
  committedMessageIds: readonly string[];
}): boolean {
  return (
    params.intent.kind === "replay_assistant"
    && !params.intent.assistantMessageCommitted
    && !params.committedMessageIds.includes(params.intent.assistantMessageId)
  );
}

export function getSimulationPrimaryButtonRoute(params: {
  lifecycleResumeInProgress: boolean;
  sessionActive: boolean;
  mode: SimulationTurnMode;
  lifecyclePauseActive: boolean;
}): SimulationPrimaryButtonRoute {
  if (params.lifecycleResumeInProgress) {
    return "ignore";
  }
  if (!params.sessionActive) {
    return "start_session";
  }
  if (params.mode === "recording") {
    return "submit_response";
  }
  if (params.mode !== "idle") {
    return "ignore";
  }
  return params.lifecyclePauseActive ? "resume_lifecycle" : "restart_recording";
}

export function shouldShowUserTurnInstruction(params: {
  sessionActive: boolean;
  mode: SimulationTurnMode;
  lifecyclePauseActive: boolean;
  isStartingTurn: boolean;
}): boolean {
  return (
    params.sessionActive
    && params.mode === "recording"
    && !params.lifecyclePauseActive
    && !params.isStartingTurn
  );
}

export function getSimulationActionDockFeedback(params: {
  sessionActive: boolean;
  mode: SimulationTurnMode;
  lifecyclePauseActive: boolean;
  retryFeedback: string | null;
}): string | null {
  if (
    !params.sessionActive
    || params.lifecyclePauseActive
    || (params.mode !== "thinking" && params.mode !== "recording")
  ) {
    return null;
  }

  const feedback = params.retryFeedback?.trim() ?? "";
  return feedback || null;
}

export function getTurnRecordingSafetySignal(params: {
  elapsedMs: number;
  silenceMs: number | null;
  heardVoice: boolean;
  meteringSeen: boolean;
  minTurnDurationMs: number;
  longPauseNoticeMs: number;
  softTurnNoticeMs: number;
  absoluteTurnNoticeMs: number;
}): TurnRecordingSafetySignal | null {
  if (params.elapsedMs >= params.absoluteTurnNoticeMs) {
    return "absolute-limit";
  }

  if (params.elapsedMs >= params.softTurnNoticeMs) {
    return "soft-limit";
  }

  if (
    params.meteringSeen &&
    params.heardVoice &&
    params.elapsedMs >= params.minTurnDurationMs &&
    typeof params.silenceMs === "number" &&
    params.silenceMs >= params.longPauseNoticeMs
  ) {
    return "long-pause";
  }

  return null;
}

export function createSimulationCorrelationId(simulationSessionId: string, phase: string): string {
  const normalizedSession = simulationSessionId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(-24);
  const normalizedPhase = phase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return `sim-${normalizedSession || "session"}-${normalizedPhase || "trace"}`.slice(0, 80);
}

export function createSimulationCorrelationNonce(): string {
  const randomPart = Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, "0");
  const timePart = Date.now().toString(36).slice(-4);
  return `${randomPart}${timePart}`.replace(/[^a-z0-9]/g, "").slice(0, 12) || "nonce";
}

export function createSimulationTurnCorrelationId(
  simulationSessionId: string,
  turnNumber: number,
  nonce = createSimulationCorrelationNonce(),
): string {
  const safeTurnNumber = Number.isFinite(turnNumber) ? Math.max(1, Math.floor(turnNumber)) : 1;
  const safeNonce = nonce
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return createSimulationCorrelationId(
    simulationSessionId,
    `turn-${safeTurnNumber}-${safeNonce || createSimulationCorrelationNonce()}`,
  );
}
