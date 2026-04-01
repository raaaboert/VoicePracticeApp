import { ApiDatabase, SimulationScoreRecord } from "@voicepractice/shared";

import {
  matchesScoreRecordQuery,
  ScoreRecordQuery,
  ScoreRecordStore
} from "../storage/scoreRecordStore.js";

// Future extraction note:
// scoreRecords is still authoritative scored-attempt/coaching/completion truth. It is append-
// heavy and read repeatedly for summaries, analytics, attempt detail, and training lifecycle
// composition. If this domain is extracted later, STORAGE_PROVIDER=file should be treated as a
// dev/demo/small-scale mode; hosted and higher-volume deployments should assume postgres.
export type { ScoreRecordQuery } from "../storage/scoreRecordStore.js";

export interface ScoreRecordActivityReference {
  segmentId: string;
  scenarioId: string;
  endedAt: string;
}

export interface ScoreSummaryByDayRow {
  dayKey: string;
  sessions: number;
  avgOverallScore: number | null;
}

export interface ScoreSummaryByLabelRow {
  sessions: number;
  avgOverallScore: number | null;
}

export interface UserScoreSummary {
  totals: {
    sessions: number;
    avgOverallScore: number | null;
  };
  byDay: ScoreSummaryByDayRow[];
  bySegment: Array<ScoreSummaryByLabelRow & { segmentId: string; segmentLabel: string }>;
  byIndustry: Array<ScoreSummaryByLabelRow & { industryId: string; industryLabel: string }>;
  recent: Array<{
    id: string;
    endedAt: string;
    segmentId: string;
    scenarioId: string;
    industryId: string | null;
    overallScore: number;
  }>;
}

export interface OrgScoreAnalytics {
  orgAvgOverallScore: number | null;
  topUsers: Array<{
    userId: string;
    email: string;
    sessions: number;
    avgOverallScore: number | null;
  }>;
  bySegment: Array<ScoreSummaryByLabelRow & { segmentId: string; segmentLabel: string }>;
  byIndustry: Array<ScoreSummaryByLabelRow & { industryId: string; industryLabel: string }>;
  trendByDay: ScoreSummaryByDayRow[];
}

interface LegacyScoreRecordContainer {
  scoreRecords?: SimulationScoreRecord[];
}

export interface ScoreRecordAccess {
  append(db: Pick<ApiDatabase, "scoreRecords">, record: SimulationScoreRecord): Promise<void>;
  deleteForUser(db: Pick<ApiDatabase, "scoreRecords">, userId: string): Promise<number>;
  getById(db: Pick<ApiDatabase, "scoreRecords">, scoreId: string): SimulationScoreRecord | null;
  list(db: Pick<ApiDatabase, "scoreRecords">, query?: ScoreRecordQuery): SimulationScoreRecord[];
  listByUserRange(
    db: Pick<ApiDatabase, "scoreRecords">,
    params: Omit<ScoreRecordQuery, "userId"> & { userId: string }
  ): SimulationScoreRecord[];
  listByOrgRange(
    db: Pick<ApiDatabase, "scoreRecords">,
    params: Omit<ScoreRecordQuery, "orgId"> & { orgId: string }
  ): SimulationScoreRecord[];
  listRecentActivityReferences(
    db: Pick<ApiDatabase, "scoreRecords">,
    params: { since: Date }
  ): ScoreRecordActivityReference[];
  computeAverageOverallScore(records: readonly SimulationScoreRecord[]): number | null;
  buildUserScoreSummary(params: {
    db: Pick<ApiDatabase, "scoreRecords">;
    userId: string;
    segmentId?: string | null;
    periodStartAt: Date;
    periodEndAt: Date;
    segmentLabelById: ReadonlyMap<string, string>;
    industryLabelById: ReadonlyMap<string, string>;
  }): UserScoreSummary;
  buildOrgScoreAnalytics(params: {
    db: Pick<ApiDatabase, "scoreRecords">;
    orgId: string;
    periodStartAt: Date;
    periodEndAt: Date;
    segmentLabelById: ReadonlyMap<string, string>;
    industryLabelById: ReadonlyMap<string, string>;
    userEmailById: ReadonlyMap<string, string>;
  }): OrgScoreAnalytics;
}

function toSafeScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toDayKeyUtc(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function pushLabelAggregate(
  target: Map<string, { sessions: number; totalScore: number }>,
  key: string,
  score: number
): void {
  const current = target.get(key) ?? { sessions: 0, totalScore: 0 };
  target.set(key, {
    sessions: current.sessions + 1,
    totalScore: current.totalScore + score
  });
}

function readLegacyScoreRecords(db: LegacyScoreRecordContainer): SimulationScoreRecord[] {
  return Array.isArray(db.scoreRecords) ? db.scoreRecords : [];
}

export function createScoreRecordAccess(store?: ScoreRecordStore | null): ScoreRecordAccess {
  return {
    async append(db: Pick<ApiDatabase, "scoreRecords">, record: SimulationScoreRecord): Promise<void> {
      if (store) {
        await store.appendRecord(record);
        return;
      }

      const legacyDb = db as LegacyScoreRecordContainer;
      if (!Array.isArray(legacyDb.scoreRecords)) {
        legacyDb.scoreRecords = [];
      }
      legacyDb.scoreRecords.push(record);
    },

    async deleteForUser(db: Pick<ApiDatabase, "scoreRecords">, userId: string): Promise<number> {
      if (store) {
        return await store.deleteRecordsForUser(userId);
      }

      const legacyRecords = readLegacyScoreRecords(db as LegacyScoreRecordContainer);
      const before = legacyRecords.length;
      (db as LegacyScoreRecordContainer).scoreRecords = legacyRecords.filter((record) => record.userId !== userId);
      return before - readLegacyScoreRecords(db as LegacyScoreRecordContainer).length;
    },

    getById(db: Pick<ApiDatabase, "scoreRecords">, scoreId: string): SimulationScoreRecord | null {
      if (store) {
        return store.getRecordById(scoreId);
      }

      return readLegacyScoreRecords(db as LegacyScoreRecordContainer).find((record) => record.id === scoreId) ?? null;
    },

    list(db: Pick<ApiDatabase, "scoreRecords">, query: ScoreRecordQuery = {}): SimulationScoreRecord[] {
      if (store) {
        return store.listRecords(query);
      }

      return readLegacyScoreRecords(db as LegacyScoreRecordContainer).filter((record) => matchesScoreRecordQuery(record, query));
    },

    listByUserRange(
      db: Pick<ApiDatabase, "scoreRecords">,
      params: Omit<ScoreRecordQuery, "userId"> & { userId: string }
    ): SimulationScoreRecord[] {
      return this.list(db, params);
    },

    listByOrgRange(
      db: Pick<ApiDatabase, "scoreRecords">,
      params: Omit<ScoreRecordQuery, "orgId"> & { orgId: string }
    ): SimulationScoreRecord[] {
      return this.list(db, params);
    },

    listRecentActivityReferences(
      db: Pick<ApiDatabase, "scoreRecords">,
      params: { since: Date }
    ): ScoreRecordActivityReference[] {
      return this.list(db, { endedAtFrom: params.since }).map((record) => ({
        segmentId: record.segmentId,
        scenarioId: record.scenarioId,
        endedAt: record.endedAt
      }));
    },

    computeAverageOverallScore(records: readonly SimulationScoreRecord[]): number | null {
      if (records.length === 0) {
        return null;
      }

      return records.reduce((total, record) => total + toSafeScore(record.overallScore), 0) / records.length;
    },

    buildUserScoreSummary(params: {
      db: Pick<ApiDatabase, "scoreRecords">;
      userId: string;
      segmentId?: string | null;
      periodStartAt: Date;
      periodEndAt: Date;
      segmentLabelById: ReadonlyMap<string, string>;
      industryLabelById: ReadonlyMap<string, string>;
    }): UserScoreSummary {
      const records = this.listByUserRange(params.db, {
        userId: params.userId,
        segmentId: params.segmentId ?? undefined,
        endedAtFrom: params.periodStartAt,
        endedAtBefore: params.periodEndAt
      });

      const byDay = new Map<string, { sessions: number; totalScore: number }>();
      const bySegment = new Map<string, { sessions: number; totalScore: number }>();
      const byIndustry = new Map<string, { sessions: number; totalScore: number }>();

      for (const record of records) {
        const score = toSafeScore(record.overallScore);
        const dayKey = toDayKeyUtc(record.endedAt);
        if (dayKey) {
          pushLabelAggregate(byDay, dayKey, score);
        }
        pushLabelAggregate(bySegment, record.segmentId, score);
        const industryId = typeof record.industryId === "string" ? record.industryId.trim() : "";
        if (industryId) {
          pushLabelAggregate(byIndustry, industryId, score);
        }
      }

      return {
        totals: {
          sessions: records.length,
          avgOverallScore: this.computeAverageOverallScore(records)
        },
        byDay: Array.from(byDay.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dayKey, row]) => ({
            dayKey,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          })),
        bySegment: Array.from(bySegment.entries())
          .map(([segmentId, row]) => ({
            segmentId,
            segmentLabel: params.segmentLabelById.get(segmentId) ?? segmentId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
          .sort((a, b) => b.sessions - a.sessions),
        byIndustry: Array.from(byIndustry.entries())
          .map(([industryId, row]) => ({
            industryId,
            industryLabel: params.industryLabelById.get(industryId) ?? industryId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
          .sort((a, b) => b.sessions - a.sessions),
        recent: records
          .slice()
          .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
          .slice(0, 25)
          .map((record) => ({
            id: record.id,
            endedAt: record.endedAt,
            segmentId: record.segmentId,
            scenarioId: record.scenarioId,
            industryId: typeof record.industryId === "string" ? record.industryId : null,
            overallScore: record.overallScore
          }))
      };
    },

    buildOrgScoreAnalytics(params: {
      db: Pick<ApiDatabase, "scoreRecords">;
      orgId: string;
      periodStartAt: Date;
      periodEndAt: Date;
      segmentLabelById: ReadonlyMap<string, string>;
      industryLabelById: ReadonlyMap<string, string>;
      userEmailById: ReadonlyMap<string, string>;
    }): OrgScoreAnalytics {
      const records = this.listByOrgRange(params.db, {
        orgId: params.orgId,
        endedAtFrom: params.periodStartAt,
        endedAtBefore: params.periodEndAt
      });

      const bySegment = new Map<string, { sessions: number; totalScore: number }>();
      const byIndustry = new Map<string, { sessions: number; totalScore: number }>();
      const byUser = new Map<string, { sessions: number; totalScore: number }>();
      const byDay = new Map<string, { sessions: number; totalScore: number }>();

      for (const record of records) {
        const score = toSafeScore(record.overallScore);
        pushLabelAggregate(bySegment, record.segmentId, score);
        pushLabelAggregate(byUser, record.userId, score);
        const dayKey = toDayKeyUtc(record.endedAt);
        if (dayKey) {
          pushLabelAggregate(byDay, dayKey, score);
        }
        const industryId = typeof record.industryId === "string" ? record.industryId.trim() : "";
        if (industryId) {
          pushLabelAggregate(byIndustry, industryId, score);
        }
      }

      return {
        orgAvgOverallScore: this.computeAverageOverallScore(records),
        topUsers: Array.from(byUser.entries())
          .map(([userId, row]) => ({
            userId,
            email: params.userEmailById.get(userId) ?? userId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
          .sort((a, b) => (b.avgOverallScore ?? 0) - (a.avgOverallScore ?? 0))
          .slice(0, 5),
        bySegment: Array.from(bySegment.entries())
          .map(([segmentId, row]) => ({
            segmentId,
            segmentLabel: params.segmentLabelById.get(segmentId) ?? segmentId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
          .sort((a, b) => b.sessions - a.sessions),
        byIndustry: Array.from(byIndustry.entries())
          .map(([industryId, row]) => ({
            industryId,
            industryLabel: params.industryLabelById.get(industryId) ?? industryId,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
          .sort((a, b) => b.sessions - a.sessions),
        trendByDay: Array.from(byDay.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dayKey, row]) => ({
            dayKey,
            sessions: row.sessions,
            avgOverallScore: row.sessions > 0 ? row.totalScore / row.sessions : null
          }))
      };
    }
  };
}
