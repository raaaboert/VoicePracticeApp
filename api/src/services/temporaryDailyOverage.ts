import {
  UsageSessionRecord,
  calculateBilledSecondsFromRaw,
  getDayKey,
} from "@voicepractice/shared";

export type TemporaryDailyOverageMode = "unlimited" | "finite";

export interface FiniteDailyOverageUsage {
  extraSecondsGranted: number;
  extraSecondsConsumed: number;
  extraSecondsRemaining: number;
}

export function resolveTemporaryDailyOverageWindow(params: {
  allowed: boolean;
  expiresAt: unknown;
  now: Date;
}): { active: boolean; expiresAt: string | null } {
  if (!params.allowed || typeof params.expiresAt !== "string") {
    return { active: false, expiresAt: null };
  }
  const expiresAt = new Date(params.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= params.now.getTime()) {
    return { active: false, expiresAt: null };
  }
  return { active: true, expiresAt: expiresAt.toISOString() };
}

export function resolveEnterpriseQuotaLockReason(params: {
  dailyCapExceeded: boolean;
  orgMonthlySecondsRemaining: number;
}): "User daily time allotment reached." | "Organization monthly allotment reached." | null {
  if (params.orgMonthlySecondsRemaining <= 0) {
    return "Organization monthly allotment reached.";
  }
  return params.dailyCapExceeded ? "User daily time allotment reached." : null;
}

export function resolveEnterpriseDailyQuota(params: {
  billedSecondsToday: number;
  effectiveDailySecondsCap: number;
  overageMode: TemporaryDailyOverageMode | null;
  finiteExtraSecondsRemaining: number | null;
}): { remainingSeconds: number | null; exceeded: boolean } {
  if (params.overageMode === "unlimited") {
    return { remainingSeconds: null, exceeded: false };
  }
  const normalRemaining = Math.max(
    0,
    Math.floor(params.effectiveDailySecondsCap) - Math.floor(params.billedSecondsToday),
  );
  const finiteRemaining = params.overageMode === "finite"
    ? Math.max(0, Math.floor(params.finiteExtraSecondsRemaining ?? 0))
    : 0;
  const remainingSeconds = normalRemaining + finiteRemaining;
  return { remainingSeconds, exceeded: remainingSeconds <= 0 };
}

export function resolveStoredDailyOverageMode(params: {
  allowed: boolean;
  mode: unknown;
}): TemporaryDailyOverageMode | null {
  if (!params.allowed) {
    return null;
  }
  return params.mode === "finite" ? "finite" : "unlimited";
}

export function calculateFiniteDailyOverageUsage(params: {
  sessions: readonly UsageSessionRecord[];
  userId: string;
  timeZone: string;
  grantStartedAt: string;
  effectiveEndAt: string;
  baseDailySecondsCap: number;
  extraSecondsGranted: number;
}): FiniteDailyOverageUsage {
  const grantStartedAtMs = new Date(params.grantStartedAt).getTime();
  const effectiveEndAtMs = new Date(params.effectiveEndAt).getTime();
  const baseDailySecondsCap = Math.max(0, Math.floor(params.baseDailySecondsCap));
  const extraSecondsGranted = Math.max(0, Math.floor(params.extraSecondsGranted));
  if (!Number.isFinite(grantStartedAtMs) || !Number.isFinite(effectiveEndAtMs) || effectiveEndAtMs <= grantStartedAtMs) {
    return { extraSecondsGranted, extraSecondsConsumed: 0, extraSecondsRemaining: extraSecondsGranted };
  }

  const grantStartDayKey = getDayKey(new Date(grantStartedAtMs), params.timeZone);
  const rawSecondsByDay = new Map<string, { beforeGrant: number; duringGrant: number }>();
  for (const session of params.sessions) {
    if (session.userId !== params.userId) {
      continue;
    }
    const endedAtMs = new Date(session.endedAt).getTime();
    if (!Number.isFinite(endedAtMs) || endedAtMs >= effectiveEndAtMs) {
      continue;
    }
    const dayKey = getDayKey(new Date(endedAtMs), params.timeZone);
    if (dayKey < grantStartDayKey) {
      continue;
    }
    const current = rawSecondsByDay.get(dayKey) ?? { beforeGrant: 0, duringGrant: 0 };
    if (endedAtMs < grantStartedAtMs) {
      current.beforeGrant += Math.max(0, Math.floor(session.rawDurationSeconds));
    } else {
      current.duringGrant += Math.max(0, Math.floor(session.rawDurationSeconds));
    }
    rawSecondsByDay.set(dayKey, current);
  }

  let derivedExtraSeconds = 0;
  for (const { beforeGrant, duringGrant } of rawSecondsByDay.values()) {
    const billedBeforeGrant = calculateBilledSecondsFromRaw(beforeGrant);
    const billedThroughGrant = calculateBilledSecondsFromRaw(beforeGrant + duringGrant);
    const billedDuringGrant = Math.max(0, billedThroughGrant - billedBeforeGrant);
    const normalAllowanceRemaining = Math.max(0, baseDailySecondsCap - billedBeforeGrant);
    derivedExtraSeconds += Math.max(0, billedDuringGrant - normalAllowanceRemaining);
  }

  const extraSecondsConsumed = Math.min(extraSecondsGranted, derivedExtraSeconds);
  return {
    extraSecondsGranted,
    extraSecondsConsumed,
    extraSecondsRemaining: Math.max(0, extraSecondsGranted - extraSecondsConsumed),
  };
}
