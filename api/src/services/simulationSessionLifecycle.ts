import crypto from "node:crypto";

import { SimulationSessionRecord, UsageSessionRecord } from "@voicepractice/shared";

import type { UserUsageSnapshot, UsageSessionAccess } from "./usageSessionAccess.js";
import { computeUsageSessionBilledSecondsAdded } from "./usageSessionWriteModel.js";
import type {
  SimulationSessionFinalizeParams,
  SimulationSessionStore,
  SimulationSessionTouchParams
} from "../storage/simulationSessionStore.js";

export const SIMULATION_SESSION_ID_MAX_LENGTH = 120;
export const SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS = 2 * 60 * 1000;
export const SIMULATION_SESSION_START_DRIFT_TOLERANCE_MS = 2 * 60 * 1000;
export const SIMULATION_SESSION_DURATION_TOLERANCE_SECONDS = 30;
export const SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES = 20;
export const SIMULATION_SESSION_FALLBACK_COMPLETION_WINDOW_MS = 8 * 60 * 60 * 1000;

export class SimulationSessionValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "SimulationSessionValidationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface BuildSimulationSessionStartRecordParams {
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId: string | null;
  trainingPackId: string | null;
  clientStartedAt: string | null;
  now: Date;
}

export interface CompleteRecognizedSimulationUsageParams<Db extends object> {
  simulationSessionStore: SimulationSessionStore;
  usageSessionAccess: UsageSessionAccess;
  db: Db;
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId: string | null;
  submittedTrainingPackId: string | null;
  resolvedTrainingPackId: string | null;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
  beforeUsage: UserUsageSnapshot;
  maxSimulationMinutes: number | null;
  timeZone: string;
  now: Date;
}

export interface CompleteRecognizedSimulationUsageResult {
  usageResult: { created: boolean; record: UsageSessionRecord };
  simulationSession: SimulationSessionRecord;
}

export function normalizeSimulationSessionId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, SIMULATION_SESSION_ID_MAX_LENGTH);
  if (!trimmed || trimmed === "unknown") {
    return null;
  }

  return trimmed;
}

export function buildUsageSessionIdFromSimulationSessionId(simulationSessionId: string): string {
  const digest = crypto.createHash("sha256").update(simulationSessionId.trim()).digest("hex").slice(0, 24);
  return `usagesim_${digest}`;
}

export function buildSimulationSessionStartRecord(
  params: BuildSimulationSessionStartRecordParams
): SimulationSessionRecord {
  const nowIso = params.now.toISOString();
  return {
    simulationSessionId: params.simulationSessionId,
    userId: params.userId,
    orgId: params.orgId,
    segmentId: params.segmentId,
    scenarioId: params.scenarioId,
    trainingId: params.trainingId ?? undefined,
    trainingPackId: params.trainingPackId ?? undefined,
    clientStartedAt: params.clientStartedAt ?? undefined,
    serverStartedAt: nowIso,
    lastSeenAt: nowIso,
    status: "started"
  };
}

export async function registerRecognizedSimulationSessionStart(
  store: SimulationSessionStore,
  params: BuildSimulationSessionStartRecordParams
): Promise<SimulationSessionRecord> {
  return await store.upsertStartedSession(buildSimulationSessionStartRecord(params));
}

export async function touchRecognizedSimulationSession(
  store: SimulationSessionStore,
  params: SimulationSessionTouchParams
): Promise<SimulationSessionRecord | null> {
  const simulationSessionId = normalizeSimulationSessionId(params.simulationSessionId);
  if (!simulationSessionId) {
    return null;
  }

  return await store.touchSession({
    simulationSessionId,
    lastSeenAt: params.lastSeenAt,
    trainingPackId: params.trainingPackId ?? null
  });
}

function resolveCompletionWindowMs(maxSimulationMinutes: number | null): number {
  if (typeof maxSimulationMinutes === "number" && Number.isFinite(maxSimulationMinutes) && maxSimulationMinutes > 0) {
    return (Math.floor(maxSimulationMinutes) + SIMULATION_SESSION_COMPLETION_WINDOW_GRACE_MINUTES) * 60 * 1000;
  }

  return SIMULATION_SESSION_FALLBACK_COMPLETION_WINDOW_MS;
}

function assertRecognizedSimulationSessionContext(
  session: SimulationSessionRecord,
  params: {
    userId: string;
    orgId: string | null;
    segmentId: string;
    scenarioId: string;
    trainingId: string | null;
    submittedTrainingPackId: string | null;
  }
): void {
  if (
    session.userId !== params.userId ||
    session.orgId !== params.orgId ||
    session.segmentId !== params.segmentId ||
    session.scenarioId !== params.scenarioId ||
    (session.trainingId ?? null) !== params.trainingId
  ) {
    throw new SimulationSessionValidationError(
      409,
      "session_context_mismatch",
      "Simulation session does not match the submitted scenario context."
    );
  }

  if (
    session.trainingPackId &&
    params.submittedTrainingPackId &&
    session.trainingPackId !== params.submittedTrainingPackId
  ) {
    throw new SimulationSessionValidationError(
      409,
      "session_training_pack_mismatch",
      "Simulation session does not match the submitted training-pack context."
    );
  }
}

function assertRecognizedSimulationSessionTiming(
  session: SimulationSessionRecord,
  params: {
    startedAt: Date;
    endedAt: Date;
    rawDurationSeconds: number;
    maxSimulationMinutes: number | null;
    now: Date;
  }
): void {
  if (params.endedAt.getTime() > params.now.getTime() + SIMULATION_SESSION_COMPLETION_FUTURE_TOLERANCE_MS) {
    throw new SimulationSessionValidationError(
      400,
      "session_completion_future_timestamp",
      "Simulation completion timestamp is too far in the future."
    );
  }

  const clientStartedAt = session.clientStartedAt ? new Date(session.clientStartedAt) : null;
  if (
    clientStartedAt &&
    Number.isFinite(clientStartedAt.getTime()) &&
    params.startedAt.getTime() < clientStartedAt.getTime() - SIMULATION_SESSION_START_DRIFT_TOLERANCE_MS
  ) {
    throw new SimulationSessionValidationError(
      409,
      "session_start_drift",
      "Simulation completion start time does not plausibly match the recognized session."
    );
  }

  const durationFromTimestampsSeconds = Math.max(
    0,
    Math.floor((params.endedAt.getTime() - params.startedAt.getTime()) / 1000)
  );
  if (Math.abs(durationFromTimestampsSeconds - params.rawDurationSeconds) > SIMULATION_SESSION_DURATION_TOLERANCE_SECONDS) {
    throw new SimulationSessionValidationError(
      400,
      "session_duration_mismatch",
      "Simulation completion duration does not plausibly match the submitted timestamps."
    );
  }

  const completionWindowMs = resolveCompletionWindowMs(params.maxSimulationMinutes);
  const lastSeenAtMs = new Date(session.lastSeenAt).getTime();
  if (Number.isFinite(lastSeenAtMs) && params.endedAt.getTime() > lastSeenAtMs + completionWindowMs) {
    throw new SimulationSessionValidationError(
      409,
      "session_completion_window_expired",
      "Simulation session expired before completion could be recorded."
    );
  }
}

function buildUsageSessionRecord(params: {
  simulationSessionId: string;
  userId: string;
  orgId: string | null;
  segmentId: string;
  scenarioId: string;
  trainingId: string | null;
  resolvedTrainingPackId: string | null;
  startedAt: string;
  endedAt: string;
  rawDurationSeconds: number;
  beforeUsage: UserUsageSnapshot;
  timeZone: string;
  now: Date;
}): UsageSessionRecord {
  return {
    id: buildUsageSessionIdFromSimulationSessionId(params.simulationSessionId),
    userId: params.userId,
    orgId: params.orgId,
    segmentId: params.segmentId,
    scenarioId: params.scenarioId,
    trainingId: params.trainingId ?? undefined,
    trainingPackId: params.resolvedTrainingPackId ?? undefined,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    rawDurationSeconds: params.rawDurationSeconds,
    billedSecondsAdded: computeUsageSessionBilledSecondsAdded({
      beforeUsage: params.beforeUsage,
      sessionEndedAt: params.endedAt,
      sessionRawDurationSeconds: params.rawDurationSeconds,
      timeZone: params.timeZone
    }),
    createdAt: params.now.toISOString()
  };
}

export async function completeRecognizedSimulationUsage<Db extends { usageSessions: UsageSessionRecord[] }>(
  params: CompleteRecognizedSimulationUsageParams<Db>
): Promise<CompleteRecognizedSimulationUsageResult> {
  const simulationSession = await params.simulationSessionStore.getById(params.simulationSessionId);
  if (!simulationSession) {
    throw new SimulationSessionValidationError(
      409,
      "session_not_recognized",
      "Simulation session was not recognized. Restart the simulation and try again."
    );
  }

  assertRecognizedSimulationSessionContext(simulationSession, {
    userId: params.userId,
    orgId: params.orgId,
    segmentId: params.segmentId,
    scenarioId: params.scenarioId,
    trainingId: params.trainingId,
    submittedTrainingPackId: params.submittedTrainingPackId
  });

  const startedAt = new Date(params.startedAt);
  const endedAt = new Date(params.endedAt);
  assertRecognizedSimulationSessionTiming(simulationSession, {
    startedAt,
    endedAt,
    rawDurationSeconds: params.rawDurationSeconds,
    maxSimulationMinutes: params.maxSimulationMinutes,
    now: params.now
  });

  if (simulationSession.status === "usage_recorded") {
    if (!simulationSession.usageSessionRecordId) {
      throw new SimulationSessionValidationError(
        503,
        "session_finalization_inconsistent",
        "Simulation session was already finalized but the usage record link is missing."
      );
    }

    const existingUsageRecord = params.usageSessionAccess.getById(params.db, simulationSession.usageSessionRecordId);
    if (!existingUsageRecord) {
      throw new SimulationSessionValidationError(
        503,
        "session_finalization_missing_usage",
        "Simulation session was already finalized but the usage record could not be loaded."
      );
    }

    return {
      usageResult: {
        created: false,
        record: existingUsageRecord
      },
      simulationSession
    };
  }

  const usageRecord = buildUsageSessionRecord({
    simulationSessionId: params.simulationSessionId,
    userId: params.userId,
    orgId: params.orgId,
    segmentId: params.segmentId,
    scenarioId: params.scenarioId,
    trainingId: params.trainingId,
    resolvedTrainingPackId: params.resolvedTrainingPackId,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    rawDurationSeconds: params.rawDurationSeconds,
    beforeUsage: params.beforeUsage,
    timeZone: params.timeZone,
    now: params.now
  });
  const usageResult = await params.usageSessionAccess.append(params.db, usageRecord);
  const finalizedSession = await params.simulationSessionStore.markUsageRecorded({
    simulationSessionId: params.simulationSessionId,
    usageRecordedAt: params.now.toISOString(),
    usageSessionRecordId: usageResult.record.id,
    lastSeenAt: params.now.toISOString()
  } satisfies SimulationSessionFinalizeParams);

  if (!finalizedSession) {
    throw new SimulationSessionValidationError(
      503,
      "session_finalization_failed",
      "Simulation session usage was stored but the session ledger could not be finalized."
    );
  }

  return {
    usageResult,
    simulationSession: finalizedSession
  };
}
