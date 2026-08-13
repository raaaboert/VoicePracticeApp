import assert from "node:assert/strict";
import test from "node:test";
import { UsageSessionRecord } from "@voicepractice/shared";
import {
  calculateFiniteDailyOverageUsage,
  resolveEnterpriseDailyQuota,
  resolveEnterpriseQuotaLockReason,
  resolveFiniteDailyOverageGrantSnapshot,
  resolveFiniteDailyOverageGrantSnapshotForEdit,
  resolveStoredDailyOverageMode,
  resolveTemporaryDailyOverageExpiration,
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

const activeFiniteGrant = {
  allowed: true,
  mode: "finite",
  expiresAt: "2026-08-17T12:00:00.000Z",
  startedAt: "2026-08-13T12:00:00.000Z",
  baseDailySecondsCap: 3_600,
  extraSecondsGranted: 7_200,
  now: new Date("2026-08-14T12:00:00.000Z"),
};

test("active finite edits preserve the original start and base-cap snapshot", () => {
  assert.deepEqual(resolveFiniteDailyOverageGrantSnapshotForEdit(activeFiniteGrant), {
    startedAt: "2026-08-13T12:00:00.000Z",
    baseDailySecondsCap: 3_600,
  });
});

test("finite edit totals retain previously consumed usage", () => {
  const snapshot = resolveFiniteDailyOverageGrantSnapshotForEdit(activeFiniteGrant);
  assert.ok(snapshot);
  const usageSessions = [
    session("normal", "2026-08-13T13:00:00.000Z", 3_600),
    session("extra", "2026-08-13T14:10:00.000Z", 4_200),
  ];
  const calculateRemaining = (extraSecondsGranted: number) => calculateFiniteDailyOverageUsage({
    sessions: usageSessions,
    userId: "user_1",
    timeZone: "UTC",
    grantStartedAt: snapshot.startedAt,
    effectiveEndAt: "2026-08-14T12:00:00.000Z",
    baseDailySecondsCap: snapshot.baseDailySecondsCap,
    extraSecondsGranted,
  }).extraSecondsRemaining;

  assert.equal(calculateRemaining(180 * 60), 110 * 60);
  assert.equal(calculateRemaining(60 * 60), 0);
});

test("non-finite, disabled, expired, and invalid grants require a fresh finite snapshot", () => {
  assert.equal(resolveFiniteDailyOverageGrantSnapshotForEdit({ ...activeFiniteGrant, mode: "unlimited" }), null);
  assert.equal(resolveFiniteDailyOverageGrantSnapshotForEdit({ ...activeFiniteGrant, allowed: false }), null);
  assert.equal(resolveFiniteDailyOverageGrantSnapshotForEdit({
    ...activeFiniteGrant,
    expiresAt: "2026-08-14T12:00:00.000Z",
  }), null);
  assert.equal(resolveFiniteDailyOverageGrantSnapshotForEdit({
    ...activeFiniteGrant,
    startedAt: null,
  }), null);
});

test("unlimited, disabled, and expired grants create a fresh finite start and baseline", () => {
  const expected = {
    startedAt: activeFiniteGrant.now.toISOString(),
    baseDailySecondsCap: 5_400,
  };
  for (const storedGrant of [
    { ...activeFiniteGrant, mode: "unlimited" },
    { ...activeFiniteGrant, allowed: false },
    { ...activeFiniteGrant, expiresAt: activeFiniteGrant.now.toISOString() },
  ]) {
    assert.deepEqual(resolveFiniteDailyOverageGrantSnapshot({
      ...storedGrant,
      currentEffectiveDailySecondsCap: 5_400,
    }), expected);
  }
});

test("temporary overage expiration clamps a 10-day request to a renewal three days away", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const nextRenewalAt = "2026-08-16T12:00:00.000Z";
  assert.equal(resolveTemporaryDailyOverageExpiration({
    now,
    durationDays: 10,
    nextRenewalAt,
  }), nextRenewalAt);
});

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
