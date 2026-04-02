import {
  ApiDatabase,
  UsageSessionRecord,
  calculateBilledSecondsFromRaw,
  computeMonthlyPeriodBounds,
  getDayKey,
  getMonthKey,
  sumRawSeconds
} from "@voicepractice/shared";

import {
  matchesUsageSessionQuery,
  UsageSessionAppendResult,
  UsageSessionQuery,
  UsageSessionStore
} from "../storage/usageSessionStore.js";

// usageSessions extraction note:
// This access layer is intentionally snapshot-backed so billing, entitlement, and reporting reads
// can preserve current sync semantics while persistence authority moves out of the monolithic
// app-state blob. STORAGE_PROVIDER=file remains a dev/demo/small-scale mode for this domain;
// postgres is the serious hosted path. Without explicit refresh/invalidation, the snapshot model
// is only suitable for a single API process per logical environment.
export type { UsageSessionQuery } from "../storage/usageSessionStore.js";

export interface UserUsageSnapshot {
  rawSecondsToday: number;
  billedSecondsToday: number;
  rawSecondsThisMonth: number;
  billedSecondsThisMonth: number;
  dayKey: string;
  monthKey: string;
}

export interface OrgUsageSnapshot {
  periodStartAt: string;
  periodEndAt: string;
  nextRenewalAt: string;
  usedSeconds: number;
  usedMinutes: number;
  allottedMinutes: number;
  allottedSeconds: number;
  remainingMinutes: number;
  usagePercent: number;
}

export interface UsageSessionActivityReference {
  segmentId: string;
  scenarioId: string;
  endedAt: string;
}

export interface UsageSessionAccess {
  append(db: Pick<ApiDatabase, "usageSessions">, session: UsageSessionRecord): Promise<UsageSessionAppendResult>;
  deleteForUser(db: Pick<ApiDatabase, "usageSessions">, userId: string): Promise<number>;
  getById(db: Pick<ApiDatabase, "usageSessions">, sessionId: string): UsageSessionRecord | null;
  list(db: Pick<ApiDatabase, "usageSessions">, query?: UsageSessionQuery): UsageSessionRecord[];
  listByUserRange(
    db: Pick<ApiDatabase, "usageSessions">,
    params: Omit<UsageSessionQuery, "userId"> & { userId: string }
  ): UsageSessionRecord[];
  listByOrgRange(
    db: Pick<ApiDatabase, "usageSessions">,
    params: Omit<UsageSessionQuery, "orgId"> & { orgId: string }
  ): UsageSessionRecord[];
  computeUserUsageSnapshot(
    db: Pick<ApiDatabase, "usageSessions">,
    params: { userId: string; now: Date; timeZone: string }
  ): UserUsageSnapshot;
  computeOrgBilledToday(
    db: Pick<ApiDatabase, "usageSessions">,
    params: { orgId: string; now: Date; timeZone: string }
  ): number;
  buildOrgUsageSnapshot(
    db: Pick<ApiDatabase, "usageSessions">,
    params: { orgId: string; billingAnchorAt: string; allottedMinutes: number; now: Date }
  ): OrgUsageSnapshot;
  listRecentActivityReferences(
    db: Pick<ApiDatabase, "usageSessions">,
    params: { since: Date }
  ): UsageSessionActivityReference[];
  sumBilledSeconds(sessions: readonly UsageSessionRecord[]): number;
}

interface LegacyUsageSessionContainer {
  usageSessions?: UsageSessionRecord[];
}

function readLegacyUsageSessions(db: LegacyUsageSessionContainer): UsageSessionRecord[] {
  return Array.isArray(db.usageSessions) ? db.usageSessions : [];
}

export function createUsageSessionAccess(store?: UsageSessionStore | null): UsageSessionAccess {
  return {
    async append(db: Pick<ApiDatabase, "usageSessions">, session: UsageSessionRecord): Promise<UsageSessionAppendResult> {
      if (store) {
        return await store.appendRecord(session);
      }

      const legacyDb = db as LegacyUsageSessionContainer;
      if (!Array.isArray(legacyDb.usageSessions)) {
        legacyDb.usageSessions = [];
      }

      const existing = legacyDb.usageSessions.find((entry) => entry.id === session.id);
      if (existing) {
        return {
          created: false,
          record: existing
        };
      }

      legacyDb.usageSessions.push(session);
      return {
        created: true,
        record: session
      };
    },

    async deleteForUser(db: Pick<ApiDatabase, "usageSessions">, userId: string): Promise<number> {
      if (store) {
        return await store.deleteRecordsForUser(userId);
      }

      const legacyDb = db as LegacyUsageSessionContainer;
      const before = readLegacyUsageSessions(legacyDb).length;
      legacyDb.usageSessions = readLegacyUsageSessions(legacyDb).filter((session) => session.userId !== userId);
      return before - readLegacyUsageSessions(legacyDb).length;
    },

    getById(db: Pick<ApiDatabase, "usageSessions">, sessionId: string): UsageSessionRecord | null {
      if (store) {
        return store.getRecordById(sessionId);
      }

      return readLegacyUsageSessions(db as LegacyUsageSessionContainer).find((session) => session.id === sessionId) ?? null;
    },

    list(db: Pick<ApiDatabase, "usageSessions">, query: UsageSessionQuery = {}): UsageSessionRecord[] {
      if (store) {
        return store.listRecords(query);
      }

      return readLegacyUsageSessions(db as LegacyUsageSessionContainer).filter((session) => matchesUsageSessionQuery(session, query));
    },

    listByUserRange(
      db: Pick<ApiDatabase, "usageSessions">,
      params: Omit<UsageSessionQuery, "userId"> & { userId: string }
    ): UsageSessionRecord[] {
      return this.list(db, params);
    },

    listByOrgRange(
      db: Pick<ApiDatabase, "usageSessions">,
      params: Omit<UsageSessionQuery, "orgId"> & { orgId: string }
    ): UsageSessionRecord[] {
      return this.list(db, params);
    },

    computeUserUsageSnapshot(
      db: Pick<ApiDatabase, "usageSessions">,
      params: { userId: string; now: Date; timeZone: string }
    ): UserUsageSnapshot {
      const dayKey = getDayKey(params.now, params.timeZone);
      const monthKey = getMonthKey(params.now, params.timeZone);
      const userSessions = this.list(db, { userId: params.userId });
      const todaySessions = userSessions.filter(
        (session) => getDayKey(new Date(session.endedAt), params.timeZone) === dayKey
      );
      const monthSessions = userSessions.filter(
        (session) => getMonthKey(new Date(session.endedAt), params.timeZone) === monthKey
      );

      const rawSecondsToday = sumRawSeconds(todaySessions);
      const rawSecondsThisMonth = sumRawSeconds(monthSessions);

      return {
        rawSecondsToday,
        billedSecondsToday: calculateBilledSecondsFromRaw(rawSecondsToday),
        rawSecondsThisMonth,
        billedSecondsThisMonth: calculateBilledSecondsFromRaw(rawSecondsThisMonth),
        dayKey,
        monthKey
      };
    },

    computeOrgBilledToday(
      db: Pick<ApiDatabase, "usageSessions">,
      params: { orgId: string; now: Date; timeZone: string }
    ): number {
      const dayKey = getDayKey(params.now, params.timeZone);
      const sessions = this.list(db, { orgId: params.orgId }).filter(
        (session) => getDayKey(new Date(session.endedAt), params.timeZone) === dayKey
      );
      const rawSeconds = sumRawSeconds(sessions);
      return calculateBilledSecondsFromRaw(rawSeconds);
    },

    buildOrgUsageSnapshot(
      db: Pick<ApiDatabase, "usageSessions">,
      params: { orgId: string; billingAnchorAt: string; allottedMinutes: number; now: Date }
    ): OrgUsageSnapshot {
      const period = computeMonthlyPeriodBounds(params.billingAnchorAt, params.now);
      const sessions = this.listByOrgRange(db, {
        orgId: params.orgId,
        startedAtFrom: new Date(period.periodStartAt),
        startedAtBefore: new Date(period.periodEndAt)
      });
      const usedSeconds = this.sumBilledSeconds(sessions);
      const usedMinutes = usedSeconds / 60;
      const allottedMinutes = Math.max(0, Math.floor(params.allottedMinutes));
      const allottedSeconds = allottedMinutes * 60;
      const usagePercent = allottedSeconds > 0 ? (usedSeconds / allottedSeconds) * 100 : 0;
      const remainingMinutes = Math.max(0, allottedMinutes - usedMinutes);

      return {
        periodStartAt: period.periodStartAt,
        periodEndAt: period.periodEndAt,
        nextRenewalAt: period.nextRenewalAt,
        usedSeconds,
        usedMinutes,
        allottedMinutes,
        allottedSeconds,
        remainingMinutes,
        usagePercent
      };
    },

    listRecentActivityReferences(
      db: Pick<ApiDatabase, "usageSessions">,
      params: { since: Date }
    ): UsageSessionActivityReference[] {
      return this.list(db, { endedAtFrom: params.since }).map((session) => ({
        segmentId: session.segmentId,
        scenarioId: session.scenarioId,
        endedAt: session.endedAt
      }));
    },

    sumBilledSeconds(sessions: readonly UsageSessionRecord[]): number {
      return sessions.reduce(
        (total, session) => total + calculateBilledSecondsFromRaw(session.rawDurationSeconds),
        0
      );
    }
  };
}
