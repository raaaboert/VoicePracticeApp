import {
  ApiDatabase,
  UsageSessionRecord,
  calculateBilledSecondsFromRaw,
  computeMonthlyPeriodBounds,
  getDayKey,
  getMonthKey,
  sumRawSeconds
} from "@voicepractice/shared";

// Future extraction note:
// usageSessions is still authoritative simulation-usage truth. It is hot append + scan-heavy,
// and any physical move must preserve current billing/entitlement semantics exactly. If this
// domain is extracted later, STORAGE_PROVIDER=file should be treated as a dev/demo/small-scale
// mode; hosted and higher-volume deployments should assume postgres.

export interface UsageSessionQuery {
  userId?: string;
  orgId?: string | null;
  segmentId?: string;
  scenarioId?: string;
  trainingId?: string | null;
  trainingPackId?: string | null;
  startedAtFrom?: Date | null;
  startedAtBefore?: Date | null;
  endedAtFrom?: Date | null;
  endedAtBefore?: Date | null;
}

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
  append(db: Pick<ApiDatabase, "usageSessions">, session: UsageSessionRecord): void;
  deleteForUser(db: Pick<ApiDatabase, "usageSessions">, userId: string): number;
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

function toMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesDateLowerBound(value: string, lowerBound: Date | null | undefined): boolean {
  if (!lowerBound) {
    return true;
  }
  const valueMs = toMillis(value);
  return valueMs !== null && valueMs >= lowerBound.getTime();
}

function matchesDateUpperBound(value: string, upperBound: Date | null | undefined): boolean {
  if (!upperBound) {
    return true;
  }
  const valueMs = toMillis(value);
  return valueMs !== null && valueMs < upperBound.getTime();
}

function matchesUsageSessionQuery(session: UsageSessionRecord, query: UsageSessionQuery): boolean {
  if (query.userId && session.userId !== query.userId) {
    return false;
  }
  if (query.orgId !== undefined && session.orgId !== query.orgId) {
    return false;
  }
  if (query.segmentId && session.segmentId !== query.segmentId) {
    return false;
  }
  if (query.scenarioId && session.scenarioId !== query.scenarioId) {
    return false;
  }
  if (query.trainingId !== undefined && (session.trainingId ?? null) !== query.trainingId) {
    return false;
  }
  if (query.trainingPackId !== undefined && (session.trainingPackId ?? null) !== query.trainingPackId) {
    return false;
  }
  if (!matchesDateLowerBound(session.startedAt, query.startedAtFrom)) {
    return false;
  }
  if (!matchesDateUpperBound(session.startedAt, query.startedAtBefore)) {
    return false;
  }
  if (!matchesDateLowerBound(session.endedAt, query.endedAtFrom)) {
    return false;
  }
  if (!matchesDateUpperBound(session.endedAt, query.endedAtBefore)) {
    return false;
  }
  return true;
}

export function createUsageSessionAccess(): UsageSessionAccess {
  return {
    append(db: Pick<ApiDatabase, "usageSessions">, session: UsageSessionRecord): void {
      db.usageSessions.push(session);
    },

    deleteForUser(db: Pick<ApiDatabase, "usageSessions">, userId: string): number {
      const before = db.usageSessions.length;
      db.usageSessions = db.usageSessions.filter((session) => session.userId !== userId);
      return before - db.usageSessions.length;
    },

    list(db: Pick<ApiDatabase, "usageSessions">, query: UsageSessionQuery = {}): UsageSessionRecord[] {
      return db.usageSessions.filter((session) => matchesUsageSessionQuery(session, query));
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
