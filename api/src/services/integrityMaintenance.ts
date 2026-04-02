import type { ApiDatabase } from "@voicepractice/shared";

import type { AiUsageEventAccess } from "./aiUsageEvents.js";
import type { ScoreRecordAccess } from "./scoreRecordAccess.js";
import type { UsageSessionAccess } from "./usageSessionAccess.js";
import type { SimulationSessionStore } from "../storage/simulationSessionStore.js";
import type { SupportCaseStore } from "../storage/supportCaseStore.js";

export const RECOGNIZED_SIMULATION_SESSION_STALE_RETENTION_MS = 48 * 60 * 60 * 1000;

export interface UserScopedHistoryRepairSummary {
  orphanedUsageSessionsDeleted: number;
  orphanedSimulationSessionsDeleted: number;
  orphanedScoreRecordsDeleted: number;
  orphanedAiUsageEventsDeleted: number;
  orphanedSupportCasesDeleted: number;
}

export interface RecognizedSimulationSessionPruneSummary {
  prunedStartedSessions: number;
  cutoffAt: string;
}

export interface PreTesterResetSummary {
  cleared: {
    usageSessions: number;
    recognizedSimulationSessions: number;
    scoreRecords: number;
    aiUsageEvents: number;
    supportCases: number;
  };
  resetAssignmentProgressCount: number;
  preservedUsers: Array<{ id: string; email: string }>;
  preservedOrgCount: number;
}

interface IntegrityMaintenanceContext {
  db: ApiDatabase;
  usageSessionAccess: UsageSessionAccess;
  simulationSessionStore: Pick<SimulationSessionStore, "listSessions" | "deleteSessionsForUser" | "pruneStartedSessionsLastSeenBefore">;
  scoreRecordAccess: ScoreRecordAccess;
  aiUsageEventAccess: Pick<AiUsageEventAccess, "list" | "deleteForUser">;
  supportCaseStore: Pick<SupportCaseStore, "listCases" | "deleteCasesForUser">;
}

function toUniqueUserIds(values: Iterable<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique.values()).sort((left, right) => left.localeCompare(right));
}

function resetTrainingAssignmentProgress(db: ApiDatabase, nowIso: string): number {
  const assignments = Array.isArray(db.trainingPackAssignments) ? db.trainingPackAssignments : [];
  let changedCount = 0;
  for (const assignment of assignments) {
    if (assignment.startedAt !== null || assignment.completedAt !== null) {
      assignment.startedAt = null;
      assignment.completedAt = null;
      assignment.updatedAt = nowIso;
      changedCount += 1;
    }
  }
  return changedCount;
}

export async function repairOrphanedUserScopedHistory(
  params: IntegrityMaintenanceContext
): Promise<UserScopedHistoryRepairSummary> {
  const knownUserIds = new Set(
    (Array.isArray(params.db.users) ? params.db.users : [])
      .map((user) => user.id.trim())
      .filter(Boolean)
  );

  const usageUserIds = toUniqueUserIds(
    params.usageSessionAccess.list(params.db).map((record) => (knownUserIds.has(record.userId) ? null : record.userId))
  );
  const simulationUserIds = toUniqueUserIds(
    (await params.simulationSessionStore.listSessions()).map((record) => (knownUserIds.has(record.userId) ? null : record.userId))
  );
  const scoreUserIds = toUniqueUserIds(
    params.scoreRecordAccess.list(params.db).map((record) => (knownUserIds.has(record.userId) ? null : record.userId))
  );
  const aiUserIds = toUniqueUserIds(
    (await params.aiUsageEventAccess.list()).map((event) => (knownUserIds.has(event.userId) ? null : event.userId))
  );
  const supportUserIds = toUniqueUserIds(
    (await params.supportCaseStore.listCases({ now: new Date() }))
      .map((record) => (knownUserIds.has(record.userId) ? null : record.userId))
  );

  let orphanedUsageSessionsDeleted = 0;
  for (const userId of usageUserIds) {
    orphanedUsageSessionsDeleted += await params.usageSessionAccess.deleteForUser(params.db, userId);
  }

  let orphanedSimulationSessionsDeleted = 0;
  for (const userId of simulationUserIds) {
    orphanedSimulationSessionsDeleted += await params.simulationSessionStore.deleteSessionsForUser(userId);
  }

  let orphanedScoreRecordsDeleted = 0;
  for (const userId of scoreUserIds) {
    orphanedScoreRecordsDeleted += await params.scoreRecordAccess.deleteForUser(params.db, userId);
  }

  let orphanedAiUsageEventsDeleted = 0;
  for (const userId of aiUserIds) {
    orphanedAiUsageEventsDeleted += await params.aiUsageEventAccess.deleteForUser(userId);
  }

  let orphanedSupportCasesDeleted = 0;
  for (const userId of supportUserIds) {
    orphanedSupportCasesDeleted += await params.supportCaseStore.deleteCasesForUser(userId);
  }

  return {
    orphanedUsageSessionsDeleted,
    orphanedSimulationSessionsDeleted,
    orphanedScoreRecordsDeleted,
    orphanedAiUsageEventsDeleted,
    orphanedSupportCasesDeleted
  };
}

export async function pruneStaleRecognizedSimulationSessions(
  params: Pick<IntegrityMaintenanceContext, "simulationSessionStore"> & {
    now: Date;
    retentionMs?: number;
  }
): Promise<RecognizedSimulationSessionPruneSummary> {
  const retentionMs = params.retentionMs ?? RECOGNIZED_SIMULATION_SESSION_STALE_RETENTION_MS;
  const cutoff = new Date(params.now.getTime() - retentionMs);
  return {
    prunedStartedSessions: await params.simulationSessionStore.pruneStartedSessionsLastSeenBefore(cutoff),
    cutoffAt: cutoff.toISOString()
  };
}

export async function resetDisposablePreTesterHistory(
  params: IntegrityMaintenanceContext & { now: Date }
): Promise<PreTesterResetSummary> {
  const nowIso = params.now.toISOString();
  const usageUserIds = toUniqueUserIds(params.usageSessionAccess.list(params.db).map((record) => record.userId));
  const simulationUserIds = toUniqueUserIds((await params.simulationSessionStore.listSessions()).map((record) => record.userId));
  const scoreUserIds = toUniqueUserIds(params.scoreRecordAccess.list(params.db).map((record) => record.userId));
  const aiUserIds = toUniqueUserIds((await params.aiUsageEventAccess.list()).map((event) => event.userId));
  const supportUserIds = toUniqueUserIds((await params.supportCaseStore.listCases({ now: params.now })).map((record) => record.userId));

  let clearedUsageSessions = 0;
  for (const userId of usageUserIds) {
    clearedUsageSessions += await params.usageSessionAccess.deleteForUser(params.db, userId);
  }

  let clearedRecognizedSimulationSessions = 0;
  for (const userId of simulationUserIds) {
    clearedRecognizedSimulationSessions += await params.simulationSessionStore.deleteSessionsForUser(userId);
  }

  let clearedScoreRecords = 0;
  for (const userId of scoreUserIds) {
    clearedScoreRecords += await params.scoreRecordAccess.deleteForUser(params.db, userId);
  }

  let clearedAiUsageEvents = 0;
  for (const userId of aiUserIds) {
    clearedAiUsageEvents += await params.aiUsageEventAccess.deleteForUser(userId);
  }

  let clearedSupportCases = 0;
  for (const userId of supportUserIds) {
    clearedSupportCases += await params.supportCaseStore.deleteCasesForUser(userId);
  }

  const resetAssignmentProgressCount = resetTrainingAssignmentProgress(params.db, nowIso);
  delete (params.db as Partial<ApiDatabase>).usageSessions;
  delete (params.db as Partial<ApiDatabase>).scoreRecords;
  delete (params.db as Partial<ApiDatabase>).aiUsageEvents;
  delete (params.db as Partial<ApiDatabase>).supportCases;

  return {
    cleared: {
      usageSessions: clearedUsageSessions,
      recognizedSimulationSessions: clearedRecognizedSimulationSessions,
      scoreRecords: clearedScoreRecords,
      aiUsageEvents: clearedAiUsageEvents,
      supportCases: clearedSupportCases
    },
    resetAssignmentProgressCount,
    preservedUsers: (Array.isArray(params.db.users) ? params.db.users : [])
      .map((user) => ({ id: user.id, email: user.email }))
      .sort((left, right) => left.email.localeCompare(right.email)),
    preservedOrgCount: Array.isArray(params.db.orgs) ? params.db.orgs.length : 0
  };
}
