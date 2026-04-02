import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageSessionRecord } from "@voicepractice/shared";

import { createUsageSessionAccess } from "./usageSessionAccess.js";
import { createUsageSessionStore } from "../storage/usageSessionStore.js";

function createSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "sess_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    startedAt: overrides.startedAt ?? "2026-03-31T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-31T10:05:00.000Z",
    rawDurationSeconds: overrides.rawDurationSeconds ?? 305,
    billedSecondsAdded: overrides.billedSecondsAdded,
    createdAt: overrides.createdAt ?? "2026-03-31T10:05:00.000Z"
  };
}

test("usageSessionAccess lists, appends, deletes, and reports recent activity references", async () => {
  const access = createUsageSessionAccess();
  const db = {
    usageSessions: [
      createSession(),
      createSession({
        id: "sess_2",
        userId: "user_2",
        orgId: "org_2",
        segmentId: "segment_2",
        scenarioId: "scenario_2",
        startedAt: "2026-04-01T11:00:00.000Z",
        endedAt: "2026-04-01T11:05:00.000Z"
      })
    ]
  };

  await access.append(
    db,
    createSession({
      id: "sess_3",
      userId: "user_1",
      startedAt: "2026-04-02T09:00:00.000Z",
      endedAt: "2026-04-02T09:03:00.000Z"
    })
  );

  assert.equal(access.listByUserRange(db, { userId: "user_1" }).length, 2);
  assert.equal(access.listByOrgRange(db, { orgId: "org_2" }).length, 1);
  assert.deepEqual(access.listRecentActivityReferences(db, { since: new Date("2026-04-01T00:00:00.000Z") }), [
    { segmentId: "segment_2", scenarioId: "scenario_2", endedAt: "2026-04-01T11:05:00.000Z" },
    { segmentId: "segment_1", scenarioId: "scenario_1", endedAt: "2026-04-02T09:03:00.000Z" }
  ]);

  assert.equal(await access.deleteForUser(db, "user_1"), 2);
  assert.equal(db.usageSessions.length, 1);
});

test("usageSessionAccess computes user and org usage snapshots with current billing math", () => {
  const access = createUsageSessionAccess();
  const db = {
    usageSessions: [
      createSession({
        id: "today_a",
        rawDurationSeconds: 305,
        startedAt: "2026-03-31T10:00:00.000Z",
        endedAt: "2026-03-31T10:05:00.000Z"
      }),
      createSession({
        id: "today_b",
        rawDurationSeconds: 121,
        startedAt: "2026-03-31T12:00:00.000Z",
        endedAt: "2026-03-31T12:02:01.000Z"
      }),
      createSession({
        id: "month_old",
        rawDurationSeconds: 600,
        startedAt: "2026-03-10T12:00:00.000Z",
        endedAt: "2026-03-10T12:10:00.000Z"
      }),
      createSession({
        id: "prior_month",
        rawDurationSeconds: 600,
        startedAt: "2026-02-28T12:00:00.000Z",
        endedAt: "2026-02-28T12:10:00.000Z"
      }),
      createSession({
        id: "other_org",
        userId: "user_2",
        orgId: "org_2",
        rawDurationSeconds: 600,
        startedAt: "2026-03-31T09:00:00.000Z",
        endedAt: "2026-03-31T09:10:00.000Z"
      })
    ]
  };

  const userUsage = access.computeUserUsageSnapshot(db, {
    userId: "user_1",
    now: new Date("2026-03-31T20:00:00.000Z"),
    timeZone: "UTC"
  });
  assert.equal(userUsage.rawSecondsToday, 426);
  assert.equal(userUsage.billedSecondsToday, 420);
  assert.equal(userUsage.rawSecondsThisMonth, 1026);
  assert.equal(userUsage.billedSecondsThisMonth, 1020);

  const orgToday = access.computeOrgBilledToday(db, {
    orgId: "org_1",
    now: new Date("2026-03-31T20:00:00.000Z"),
    timeZone: "UTC"
  });
  assert.equal(orgToday, 420);

  const orgSnapshot = access.buildOrgUsageSnapshot(db, {
    orgId: "org_1",
    billingAnchorAt: "2026-03-15T00:00:00.000Z",
    allottedMinutes: 100,
    now: new Date("2026-03-31T20:00:00.000Z")
  });
  assert.equal(orgSnapshot.usedSeconds, 420);
  assert.equal(orgSnapshot.allottedSeconds, 6000);
  assert.equal(orgSnapshot.periodStartAt, "2026-03-15T00:00:00.000Z");
  assert.equal(orgSnapshot.periodEndAt, "2026-04-15T00:00:00.000Z");
});

test("usageSessionAccess preserves sync read semantics while using the real store-backed path", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-usage-session-access-"));
  try {
    const store = createUsageSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();
    await store.importLegacyRecords([
      createSession({ id: "sess_a", rawDurationSeconds: 305 }),
      createSession({
        id: "sess_b",
        userId: "user_2",
        orgId: "org_2",
        segmentId: "segment_2",
        scenarioId: "scenario_2",
        startedAt: "2026-04-01T11:00:00.000Z",
        endedAt: "2026-04-01T11:05:00.000Z",
        createdAt: "2026-04-01T11:05:00.000Z"
      })
    ]);

    const access = createUsageSessionAccess(store);
    const db = { usageSessions: [] as UsageSessionRecord[] };

    assert.equal(access.getById(db, "sess_b")?.scenarioId, "scenario_2");
    assert.deepEqual(
      access.listByUserRange(db, { userId: "user_1" }).map((record) => record.id),
      ["sess_a"]
    );

    const duplicate = await access.append(
      db,
      createSession({
        id: "sess_a",
        rawDurationSeconds: 900,
        billedSecondsAdded: 900
      })
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.record.rawDurationSeconds, 305);
    assert.equal(duplicate.record.billedSecondsAdded, undefined);

    const created = await access.append(
      db,
      createSession({
        id: "sess_c",
        userId: "user_1",
        startedAt: "2026-04-02T09:00:00.000Z",
        endedAt: "2026-04-02T09:03:00.000Z",
        createdAt: "2026-04-02T09:03:00.000Z",
        billedSecondsAdded: 15
      })
    );
    assert.equal(created.created, true);
    assert.equal(created.record.billedSecondsAdded, 15);

    assert.deepEqual(
      access.list(db).map((record) => record.id),
      ["sess_a", "sess_b", "sess_c"]
    );

    assert.equal(await access.deleteForUser(db, "user_1"), 2);
    assert.deepEqual(access.list(db).map((record) => record.id), ["sess_b"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
