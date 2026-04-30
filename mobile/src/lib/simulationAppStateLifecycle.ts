export const ACTIVE_SIMULATION_BACKGROUND_GRACE_MS = 2 * 60 * 1000;

export type SimulationAppStateStatus = "active" | "inactive" | "background";

export type SimulationAppStateTransitionDecision =
  | {
      kind: "ignore";
      previousAppState: SimulationAppStateStatus;
      nextAppState: SimulationAppStateStatus;
      sessionPreserved: boolean;
    }
  | {
      kind: "pause_session";
      previousAppState: SimulationAppStateStatus;
      nextAppState: SimulationAppStateStatus;
      sessionPreserved: true;
    }
  | {
      kind: "resume_session";
      previousAppState: SimulationAppStateStatus;
      nextAppState: SimulationAppStateStatus;
      elapsedMs: number;
      sessionPreserved: true;
    }
  | {
      kind: "expire_session";
      previousAppState: SimulationAppStateStatus;
      nextAppState: SimulationAppStateStatus;
      elapsedMs: number;
      sessionPreserved: false;
    };

export function normalizeSimulationAppStateStatus(value: string | null | undefined): SimulationAppStateStatus {
  if (value === "inactive" || value === "background") {
    return value;
  }

  return "active";
}

export function shouldExpireBackgroundPause(params: {
  pausedAtMs: number;
  resumedAtMs: number;
  graceMs?: number;
}): boolean {
  const graceMs = params.graceMs ?? ACTIVE_SIMULATION_BACKGROUND_GRACE_MS;
  const elapsedMs = Math.max(0, params.resumedAtMs - params.pausedAtMs);
  return elapsedMs > graceMs;
}

export function classifySimulationAppStateTransition(params: {
  previousAppState: string | null | undefined;
  nextAppState: string | null | undefined;
  sessionActive: boolean;
  simulationClosed: boolean;
  backgroundedAtMs: number | null;
  nowMs: number;
  graceMs?: number;
}): SimulationAppStateTransitionDecision {
  const previousAppState = normalizeSimulationAppStateStatus(params.previousAppState);
  const nextAppState = normalizeSimulationAppStateStatus(params.nextAppState);

  if (!params.sessionActive || params.simulationClosed) {
    return {
      kind: "ignore",
      previousAppState,
      nextAppState,
      sessionPreserved: false,
    };
  }

  if (nextAppState !== "active") {
    if (previousAppState === "active" && params.backgroundedAtMs === null) {
      return {
        kind: "pause_session",
        previousAppState,
        nextAppState,
        sessionPreserved: true,
      };
    }

    return {
      kind: "ignore",
      previousAppState,
      nextAppState,
      sessionPreserved: true,
    };
  }

  if (params.backgroundedAtMs === null) {
    return {
      kind: "ignore",
      previousAppState,
      nextAppState,
      sessionPreserved: true,
    };
  }

  const elapsedMs = Math.max(0, params.nowMs - params.backgroundedAtMs);
  if (shouldExpireBackgroundPause({
    pausedAtMs: params.backgroundedAtMs,
    resumedAtMs: params.nowMs,
    graceMs: params.graceMs,
  })) {
    return {
      kind: "expire_session",
      previousAppState,
      nextAppState,
      elapsedMs,
      sessionPreserved: false,
    };
  }

  return {
    kind: "resume_session",
    previousAppState,
    nextAppState,
    elapsedMs,
    sessionPreserved: true,
  };
}
