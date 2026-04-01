import {
  ApiDatabase,
  DashboardTrainingAttributionSummary,
  DashboardTrainingPackAssignmentProgressRow,
  SimulationScoreRecord,
  TrainingPackAssignmentProgressStatus,
  TrainingPackAssignmentRecord,
  UsageSessionRecord,
  UserStatus
} from "@voicepractice/shared";

import type { ScoreRecordAccess, ScoreRecordQuery } from "./scoreRecordAccess.js";
import type { UsageSessionAccess, UsageSessionQuery } from "./usageSessionAccess.js";

// Future extraction note:
// attempt reconstruction still relies on fuzzy session<->score correlation. Until a persisted
// linkage exists, future storage moves must preserve the exact current matching semantics:
// exact timestamp match first, then nearest matching session within the existing 10-minute window.

export interface SimulationHistoryWindowQuery {
  userId?: string;
  orgId?: string | null;
  segmentId?: string;
  scenarioId?: string;
  trainingPackId?: string | null;
  periodStartAt: Date;
  periodEndAt: Date;
}

export interface TrainingAssignmentUserSummary {
  email: string;
  status: UserStatus;
}

export interface SimulationHistoryAccess {
  listActivityWindow(
    db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
    query: SimulationHistoryWindowQuery
  ): { usageSessions: UsageSessionRecord[]; scoreRecords: SimulationScoreRecord[] };
  buildTrainingPackAttributionSummary(params: {
    usageSessions: UsageSessionRecord[];
    scoreRecords: SimulationScoreRecord[];
  }): DashboardTrainingAttributionSummary;
  findRelatedUsageSessionForScore(
    sessions: readonly UsageSessionRecord[],
    score: SimulationScoreRecord
  ): UsageSessionRecord | null;
  resolveTrainingPackAssignmentCompletionAt(
    assignment: TrainingPackAssignmentRecord,
    scoreRecords: readonly SimulationScoreRecord[]
  ): string | null;
  computeTrainingPackAssignmentProgress(params: {
    assignment: TrainingPackAssignmentRecord;
    user: TrainingAssignmentUserSummary | null;
    scenarioCatalog: ReadonlyMap<string, { title: string }>;
    allSessions: UsageSessionRecord[];
    allScores: SimulationScoreRecord[];
    recentSessions: UsageSessionRecord[];
    recentScores: SimulationScoreRecord[];
  }): DashboardTrainingPackAssignmentProgressRow;
  syncTrainingPackAssignmentLifecycle(
    db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
    assignment: TrainingPackAssignmentRecord
  ): TrainingPackAssignmentRecord;
  projectTrainingPackAssignmentLifecycle(
    db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
    assignment: TrainingPackAssignmentRecord
  ): TrainingPackAssignmentRecord;
}

function averageScore(records: ReadonlyArray<{ overallScore: number }>): number | null {
  if (records.length === 0) {
    return null;
  }

  return Math.round(records.reduce((total, record) => total + record.overallScore, 0) / records.length);
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsedMs = new Date(value).getTime();
    if (!Number.isFinite(parsedMs) || parsedMs <= bestMs) {
      continue;
    }

    bestMs = parsedMs;
    bestValue = value;
  }

  return bestValue;
}

function minIsoDate(values: Array<string | null | undefined>): string | null {
  let bestValue: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsedMs = new Date(value).getTime();
    if (!Number.isFinite(parsedMs) || parsedMs >= bestMs) {
      continue;
    }

    bestMs = parsedMs;
    bestValue = value;
  }

  return bestValue;
}

function buildUsageSessionQuery(query: SimulationHistoryWindowQuery): UsageSessionQuery {
  return {
    userId: query.userId,
    orgId: query.orgId,
    segmentId: query.segmentId,
    scenarioId: query.scenarioId,
    trainingPackId: query.trainingPackId,
    startedAtFrom: query.periodStartAt,
    startedAtBefore: query.periodEndAt
  };
}

function buildScoreRecordQuery(query: SimulationHistoryWindowQuery): ScoreRecordQuery {
  return {
    userId: query.userId,
    orgId: query.orgId,
    segmentId: query.segmentId,
    scenarioId: query.scenarioId,
    trainingPackId: query.trainingPackId,
    endedAtFrom: query.periodStartAt,
    endedAtBefore: query.periodEndAt
  };
}

export function createSimulationHistoryAccess(params: {
  usageSessionAccess: UsageSessionAccess;
  scoreRecordAccess: ScoreRecordAccess;
}): SimulationHistoryAccess {
  return {
    listActivityWindow(
      db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
      query: SimulationHistoryWindowQuery
    ): { usageSessions: UsageSessionRecord[]; scoreRecords: SimulationScoreRecord[] } {
      return {
        usageSessions: params.usageSessionAccess.list(db, buildUsageSessionQuery(query)),
        scoreRecords: params.scoreRecordAccess.list(db, buildScoreRecordQuery(query))
      };
    },

    buildTrainingPackAttributionSummary(paramsValue: {
      usageSessions: UsageSessionRecord[];
      scoreRecords: SimulationScoreRecord[];
    }): DashboardTrainingAttributionSummary {
      return {
        mode: "forward_only",
        attributedUsageSessionsLast30Days: paramsValue.usageSessions.filter((session) => Boolean(session.trainingPackId)).length,
        unattributedUsageSessionsLast30Days: paramsValue.usageSessions.filter((session) => !session.trainingPackId).length,
        attributedScoresLast30Days: paramsValue.scoreRecords.filter((record) => Boolean(record.trainingPackId)).length,
        unattributedScoresLast30Days: paramsValue.scoreRecords.filter((record) => !record.trainingPackId).length
      };
    },

    findRelatedUsageSessionForScore(
      sessions: readonly UsageSessionRecord[],
      score: SimulationScoreRecord
    ): UsageSessionRecord | null {
      const exact = sessions.find(
        (session) =>
          session.userId === score.userId &&
          session.scenarioId === score.scenarioId &&
          (session.trainingPackId ?? null) === (score.trainingPackId ?? null) &&
          session.startedAt === score.startedAt &&
          session.endedAt === score.endedAt
      );
      if (exact) {
        return exact;
      }

      const scoreStartedMs = new Date(score.startedAt).getTime();
      const scoreEndedMs = new Date(score.endedAt).getTime();
      let best: { session: UsageSessionRecord; delta: number } | null = null;

      for (const session of sessions) {
        if (
          session.userId !== score.userId ||
          session.scenarioId !== score.scenarioId ||
          (session.trainingPackId ?? null) !== (score.trainingPackId ?? null)
        ) {
          continue;
        }

        const startedDelta = Math.abs(new Date(session.startedAt).getTime() - scoreStartedMs);
        const endedDelta = Math.abs(new Date(session.endedAt).getTime() - scoreEndedMs);
        const delta = startedDelta + endedDelta;
        if (!Number.isFinite(delta) || delta > 10 * 60 * 1000) {
          continue;
        }
        if (!best || delta < best.delta) {
          best = { session, delta };
        }
      }

      return best?.session ?? null;
    },

    resolveTrainingPackAssignmentCompletionAt(
      assignment: TrainingPackAssignmentRecord,
      scoreRecords: readonly SimulationScoreRecord[]
    ): string | null {
      const requiredScenarioIds = new Set(assignment.requiredScenarioIds);
      if (requiredScenarioIds.size === 0) {
        return null;
      }

      const seenScenarioIds = new Set<string>();
      const sortedScores = scoreRecords
        .slice()
        .sort((left, right) => new Date(left.endedAt).getTime() - new Date(right.endedAt).getTime());

      for (const record of sortedScores) {
        if (!requiredScenarioIds.has(record.scenarioId)) {
          continue;
        }
        seenScenarioIds.add(record.scenarioId);
        if (seenScenarioIds.size >= requiredScenarioIds.size) {
          return record.endedAt;
        }
      }

      return null;
    },

    computeTrainingPackAssignmentProgress(paramsValue: {
      assignment: TrainingPackAssignmentRecord;
      user: TrainingAssignmentUserSummary | null;
      scenarioCatalog: ReadonlyMap<string, { title: string }>;
      allSessions: UsageSessionRecord[];
      allScores: SimulationScoreRecord[];
      recentSessions: UsageSessionRecord[];
      recentScores: SimulationScoreRecord[];
    }): DashboardTrainingPackAssignmentProgressRow {
      const { assignment, scenarioCatalog, user } = paramsValue;
      const assignedAtMs = new Date(assignment.assignedAt).getTime();
      const filterAfterAssignment = <
        T extends { userId: string; trainingPackId?: string | null; startedAt?: string; endedAt: string }
      >(
        entries: T[],
        resolveActivityAt: (entry: T) => string
      ): T[] =>
        entries.filter((entry) => {
          if (entry.userId !== assignment.userId || entry.trainingPackId !== assignment.trainingPackId) {
            return false;
          }
          const activityAtMs = new Date(resolveActivityAt(entry)).getTime();
          return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
        });

      const relevantAllSessions = filterAfterAssignment(paramsValue.allSessions, (entry) => entry.startedAt ?? entry.endedAt);
      const relevantAllScores = filterAfterAssignment(paramsValue.allScores, (entry) => entry.endedAt);
      const relevantRecentSessions = filterAfterAssignment(
        paramsValue.recentSessions,
        (entry) => entry.startedAt ?? entry.endedAt
      );
      const relevantRecentScores = filterAfterAssignment(paramsValue.recentScores, (entry) => entry.endedAt);
      const earliestActivityAt = minIsoDate([
        ...relevantAllSessions.map((session) => session.startedAt),
        ...relevantAllScores.map((record) => record.endedAt)
      ]);
      const completionAt =
        assignment.completedAt ?? this.resolveTrainingPackAssignmentCompletionAt(assignment, relevantAllScores);
      const startedAt = assignment.startedAt ?? earliestActivityAt;
      const completedScenarioIds = new Set<string>(
        relevantAllScores
          .filter((record) => assignment.requiredScenarioIds.includes(record.scenarioId))
          .map((record) => record.scenarioId)
      );
      const requiredScenarioCount = assignment.requiredScenarioIds.length;
      const completionSupported = requiredScenarioCount > 0;
      const status: TrainingPackAssignmentProgressStatus = completionAt
        ? "completed"
        : startedAt
          ? "in_progress"
          : "not_started";
      const normalizedStatus: TrainingPackAssignmentProgressStatus = completionSupported
        ? status
        : startedAt
          ? "in_progress"
          : "not_started";
      const latestSession = relevantRecentSessions
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];
      const latestScore = relevantRecentScores
        .slice()
        .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime())[0];
      const latestActivityAt = maxIsoDate([latestSession?.endedAt ?? null, latestScore?.endedAt ?? null]);
      const latestScenarioId = latestScore?.scenarioId ?? latestSession?.scenarioId ?? null;

      return {
        assignmentId: assignment.id,
        userId: assignment.userId,
        email: user?.email ?? assignment.userId,
        userStatus: user?.status ?? "disabled",
        status: normalizedStatus,
        assignedAt: assignment.assignedAt,
        startedAt,
        completedAt: completionSupported ? completionAt : null,
        requiredScenarioCount,
        completedScenarioCount: completedScenarioIds.size,
        attemptsLast30Days: relevantRecentSessions.length,
        scoredAttemptsLast30Days: relevantRecentScores.length,
        averageScoreLast30Days: averageScore(relevantRecentScores),
        latestActivityAt,
        latestScenarioTitle: latestScenarioId ? scenarioCatalog.get(latestScenarioId)?.title ?? latestScenarioId : null
      };
    },

    syncTrainingPackAssignmentLifecycle(
      db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
      assignment: TrainingPackAssignmentRecord
    ): TrainingPackAssignmentRecord {
      const assignedAtMs = new Date(assignment.assignedAt).getTime();
      const sessions = params.usageSessionAccess.list(db, {
        userId: assignment.userId,
        trainingPackId: assignment.trainingPackId
      }).filter((session) => {
        const activityAtMs = new Date(session.startedAt).getTime();
        return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
      });
      const scores = params.scoreRecordAccess.list(db, {
        userId: assignment.userId,
        trainingPackId: assignment.trainingPackId
      }).filter((record) => {
        const activityAtMs = new Date(record.endedAt).getTime();
        return Number.isFinite(activityAtMs) && activityAtMs >= assignedAtMs;
      });

      const earliestActivityAt = minIsoDate([
        ...sessions.map((session) => session.startedAt),
        ...scores.map((record) => record.endedAt)
      ]);
      const computedCompletedAt = this.resolveTrainingPackAssignmentCompletionAt(assignment, scores);
      const nextStartedAt = minIsoDate([assignment.startedAt, earliestActivityAt]);
      const nextCompletedAt = minIsoDate([assignment.completedAt, computedCompletedAt]);

      if (nextStartedAt !== assignment.startedAt) {
        assignment.startedAt = nextStartedAt;
      }
      if (assignment.requiredScenarioIds.length > 0) {
        if (nextCompletedAt !== assignment.completedAt) {
          assignment.completedAt = nextCompletedAt;
        }
      } else if (assignment.completedAt !== null) {
        assignment.completedAt = null;
      }

      return assignment;
    },

    projectTrainingPackAssignmentLifecycle(
      db: Pick<ApiDatabase, "usageSessions" | "scoreRecords">,
      assignment: TrainingPackAssignmentRecord
    ): TrainingPackAssignmentRecord {
      return this.syncTrainingPackAssignmentLifecycle(db, {
        ...assignment,
        requiredScenarioIds: assignment.requiredScenarioIds.slice()
      });
    }
  };
}
