export type SimulationTurnMode = "idle" | "thinking" | "speaking" | "recording";

export interface SimulationStartProgress {
  openingDelivered: boolean;
  recognizedStartRegistered: boolean;
}

export type TurnFinalizeTrigger = "submit" | "backup-silence" | "soft-limit" | "absolute-limit";

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
}): PrimarySimulationAction {
  if (!params.sessionActive) {
    return {
      kind: "start",
      label: "Start Simulation",
      disabled: params.isInitializing || params.mode === "thinking" || params.mode === "speaking",
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

export function getTurnFinalizeFallbackReason(params: {
  elapsedMs: number;
  silenceMs: number | null;
  heardVoice: boolean;
  meteringSeen: boolean;
  minTurnDurationMs: number;
  backupSilenceCutoffMs: number;
  softMaxTurnDurationMs: number;
  absoluteMaxTurnDurationMs: number;
}): Exclude<TurnFinalizeTrigger, "submit"> | null {
  if (params.elapsedMs >= params.absoluteMaxTurnDurationMs) {
    return "absolute-limit";
  }

  if (params.elapsedMs >= params.softMaxTurnDurationMs) {
    return "soft-limit";
  }

  if (
    params.meteringSeen &&
    params.heardVoice &&
    params.elapsedMs >= params.minTurnDurationMs &&
    typeof params.silenceMs === "number" &&
    params.silenceMs >= params.backupSilenceCutoffMs
  ) {
    return "backup-silence";
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
