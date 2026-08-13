import assert from "node:assert/strict";
import test from "node:test";
import { UsageSessionRecord } from "@voicepractice/shared";
import {
  calculateFiniteDailyOverageUsage,
  resolveEnterpriseDailyQuota,
  resolveEnterpriseQuotaLockReason,
  resolveStoredDailyOverageMode,
  resolveTemporaryDailyOverageWindow,
} from "./temporaryDailyOverage.js";

function session(id: string, endedAt: string, rawDurationSeconds: number): UsageSessionRecord {
  return {
    id,
    userId: "user_1",
    orgId: "org_1",
    segmentId: "segment",
    scenarioId: "scenario",
    startedAt: endedAt,
    endedAt,
    rawDurationSeconds,
    createdAt: endedAt,
  };
}

test("existing enabled overage records retain unlimited semantics", () => {
  assert.equal(resolveStoredDailyOverageMode({ allowed: true, mode: undefined }), "unlimited");
  assert.equal(resolveStoredDailyOverageMode({ allowed: true, mode: "unlimited" }), "unlimited");
  assert.equal(resolveStoredDailyOverageMode({ allowed: false, mode: "finite" }), null);
});

test("expired and invalid temporary overage windows no longer apply", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");
  assert.deepEqual(resolveTemporaryDailyOverageWindow({
    allowed: true,
    expiresAt: "2026-08-13T11:59:59.999Z",
    now,
  }), { active: false, expiresAt: null });
  assert.deepEqual(resolveTemporaryDailyOverageWindow({ allowed: true, expiresAt: "invalid", now }), {
    active: false,
    expiresAt: null,
  });
  assert.deepEqual(resolveTemporaryDailyOverageWindow({
    allowed: true,
    expiresAt: "2026-08-13T12:00:00.001Z",
    now,
  }), { active: true, expiresAt: "2026-08-13T12:00:00.001Z" });
});

test("normal/default and individual effective daily caps block when exhausted", () => {
  assert.deepEqual(resolveEnterpriseDailyQuota({
    billedSecondsToday: 3_600,
    effectiveDailySecondsCap: 3_600,
    overageMode: null,
    finiteExtraSecondsRemaining: null,
  }), { remainingSeconds: 0, exceeded: true });
  assert.deepEqual(resolveEnterpriseDailyQuota({
    billedSecondsToday: 3_600,
    effectiveDailySecondsCap: 7_200,
    overageMode: null,
    finiteExtraSecondsRemaining: null,
  }), { remainingSeconds: 3_600, exceeded: false });
});

test("unlimited bypasses only the daily decision and finite exhaustion restores daily blocking", () => {
  assert.deepEqual(resolveEnterpriseDailyQuota({
    billedSecondsToday: 99_999,
    effectiveDailySecondsCap: 3_600,
    overageMode: "unlimited",
    finiteExtraSecondsRemaining: null,
  }), { remainingSeconds: null, exceeded: false });
  assert.deepEqual(resolveEnterpriseDailyQuota({
    billedSecondsToday: 3_600,
    effectiveDailySecondsCap: 3_600,
    overageMode: "finite",
    finiteExtraSecondsRemaining: 60,
  }), { remainingSeconds: 60, exceeded: false });
  assert.deepEqual(resolveEnterpriseDailyQuota({
    billedSecondsToday: 3_600,
    effectiveDailySecondsCap: 3_600,
    overageMode: "finite",
    finiteExtraSecondsRemaining: 0,
  }), { remainingSeconds: 0, exceeded: true });
});

test("organization monthly exhaustion wins for normal, unlimited, and finite daily modes", () => {
  for (const dailyQuota of [
    resolveEnterpriseDailyQuota({
      billedSecondsToday: 3_600,
      effectiveDailySecondsCap: 3_600,
      overageMode: null,
      finiteExtraSecondsRemaining: null,
    }),
    resolveEnterpriseDailyQuota({
      billedSecondsToday: 99_999,
      effectiveDailySecondsCap: 3_600,
      overageMode: "unlimited",
      finiteExtraSecondsRemaining: null,
    }),
    resolveEnterpriseDailyQuota({
      billedSecondsToday: 3_600,
      effectiveDailySecondsCap: 3_600,
      overageMode: "finite",
      finiteExtraSecondsRemaining: 7_200,
    }),
  ]) {
    assert.equal(resolveEnterpriseQuotaLockReason({
      dailyCapExceeded: dailyQuota.exceeded,
      orgMonthlySecondsRemaining: 0,
    }), "Organization monthly allotment reached.");
  }
});

test("finite extra pool spans days as one total and consumes only usage above the snapshotted daily cap", () => {
  const result = calculateFiniteDailyOverageUsage({
    sessions: [
      session("day_1_base", "2026-08-13T10:00:00.000Z", 3_600),
      session("day_1_extra", "2026-08-13T12:00:00.000Z", 1_800),
      session("day_2_base_and_extra", "2026-08-14T12:00:00.000Z", 4_500),
      session("other_user", "2026-08-14T13:00:00.000Z", 9_000),
    ].map((entry) => entry.id === "other_user" ? { ...entry, userId: "user_2" } : entry),
    userId: "user_1",
    timeZone: "UTC",
    grantStartedAt: "2026-08-13T11:00:00.000Z",
    effectiveEndAt: "2026-08-15T00:00:00.000Z",
    baseDailySecondsCap: 3_600,
    extraSecondsGranted: 7_200,
  });

  assert.deepEqual(result, {
    extraSecondsGranted: 7_200,
    extraSecondsConsumed: 2_700,
    extraSecondsRemaining: 4_500,
  });
});

test("finite consumption is bounded by the total grant and ignores usage after expiry", () => {
  const result = calculateFiniteDailyOverageUsage({
    sessions: [
      session("within", "2026-08-13T12:00:00.000Z", 10_800),
      session("after", "2026-08-14T12:00:00.000Z", 10_800),
    ],
    userId: "user_1",
    timeZone: "UTC",
    grantStartedAt: "2026-08-13T00:00:00.000Z",
    effectiveEndAt: "2026-08-14T00:00:00.000Z",
    baseDailySecondsCap: 3_600,
    extraSecondsGranted: 7_200,
  });

  assert.equal(result.extraSecondsConsumed, 7_200);
  assert.equal(result.extraSecondsRemaining, 0);
});
