import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageSessionRecord } from "@voicepractice/shared";

import { createUsageSessionStore } from "./usageSessionStore.js";

function createSession(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? "sess_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
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

test("file usage session store appends, queries, gets by id, and deletes by user", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-usage-session-store-"));
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

    const appendedA = await store.appendRecord(createSession({ id: "sess_a", billedSecondsAdded: 15 }));
    assert.equal(appendedA.created, true);
    assert.equal(appendedA.record.billedSecondsAdded, 15);

    const duplicateA = await store.appendRecord(
      createSession({
        id: "sess_a",
        rawDurationSeconds: 900,
        billedSecondsAdded: 900
      })
    );
    assert.equal(duplicateA.created, false);
    assert.equal(duplicateA.record.rawDurationSeconds, 305);
    assert.equal(duplicateA.record.billedSecondsAdded, 15);

    await store.appendRecord(
      createSession({
        id: "sess_b",
        userId: "user_2",
        orgId: "org_2",
        divisionId: "division_2",
        segmentId: "segment_2",
        scenarioId: "scenario_2",
        trainingPackId: "pack_2",
        startedAt: "2026-04-01T10:00:00.000Z",
        endedAt: "2026-04-01T10:05:00.000Z",
        createdAt: "2026-04-01T10:05:00.000Z"
      })
    );
    await store.appendRecord(
      createSession({
        id: "sess_c",
        userId: "user_1",
        trainingPackId: "pack_1",
        scenarioId: "scenario_3",
        startedAt: "2026-04-02T10:00:00.000Z",
        endedAt: "2026-04-02T10:05:00.000Z",
        createdAt: "2026-04-02T10:05:00.000Z"
      })
    );

    assert.equal(store.getRecordById("sess_b")?.trainingPackId, "pack_2");
    assert.equal(store.getRecordById("sess_b")?.divisionId, "division_2");
    assert.deepEqual(
      store.listRecords({ userId: "user_1" }).map((record) => record.id),
      ["sess_a", "sess_c"]
    );
    assert.deepEqual(
      store.listRecords({
        orgId: "org_2",
        endedAtFrom: new Date("2026-04-01T00:00:00.000Z"),
        endedAtBefore: new Date("2026-04-02T00:00:00.000Z")
      }).map((record) => record.id),
      ["sess_b"]
    );

    const deletedCount = await store.deleteRecordsForUser("user_1");
    assert.equal(deletedCount, 2);
    assert.deepEqual(store.listRecords().map((record) => record.id), ["sess_b"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file usage session store imports legacy usage sessions with immediate authority handoff semantics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-usage-session-store-"));
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

    await store.appendRecord(
      createSession({
        id: "sess_existing",
        rawDurationSeconds: 120,
        createdAt: "2026-03-31T08:00:00.000Z"
      })
    );

    const migration = await store.importLegacyRecords([
      createSession({
        id: "sess_existing",
        rawDurationSeconds: 300,
        createdAt: "2026-03-31T09:00:00.000Z"
      }),
      createSession({
        id: "sess_new",
        userId: "user_2",
        scenarioId: "scenario_9",
        createdAt: "2026-03-31T11:00:00.000Z"
      })
    ]);

    assert.equal(migration.importedCount, 1);
    assert.equal(store.getRecordById("sess_existing")?.rawDurationSeconds, 300);
    assert.deepEqual(
      store.listRecords().map((record) => record.id),
      ["sess_existing", "sess_new"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("file usage session store refreshSnapshot picks up out-of-band writes and deletes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-usage-session-store-refresh-"));
  try {
    const dbPath = path.join(tempDir, "db.local.json");
    const storeA = createUsageSessionStore({
      provider: "file",
      dbPath,
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    const storeB = createUsageSessionStore({
      provider: "file",
      dbPath,
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });

    await storeA.initialize();
    await storeA.appendRecord(createSession({ id: "sess_a" }));
    await storeB.initialize();

    await storeB.appendRecord(createSession({ id: "sess_b", createdAt: "2026-04-01T10:05:00.000Z" }));

    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["sess_a"]);

    await storeA.refreshSnapshot();
    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["sess_a", "sess_b"]);

    const deletedCount = await storeB.deleteRecordsForUser("user_1");
    assert.equal(deletedCount, 2);
    assert.deepEqual(storeA.listRecords().map((record) => record.id), ["sess_a", "sess_b"]);

    await storeA.refreshSnapshot();
    assert.deepEqual(storeA.listRecords(), []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("file-store recency preserves explicit origins across restart and excludes abandoned/unknown/foreign usage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vp-recency-"));
  const options = { provider: "file" as const, dbPath: path.join(directory, "db.json"), databaseUrl: null,
    pgPoolMax: 1, pgConnectTimeoutMs: 100, pgIdleTimeoutMs: 100 };
  try {
    const store = createUsageSessionStore(options); await store.initialize();
    await store.appendRecord({ ...createSession(), originTopicId: "topic", usageSource: "client_completed" });
    await store.appendRecord({ ...createSession({ id: "abandoned", endedAt: "2099-01-01T00:00:00.000Z" }), originTopicId: "topic", usageSource: "server_abandoned" });
    await store.appendRecord({ ...createSession({ id: "historical", trainingId: "topic", endedAt: "2099-01-01T00:00:00.000Z" }) });
    const restarted = createUsageSessionStore(options); await restarted.initialize();
    await restarted.importLegacyRecords([{ ...createSession(), originTopicId: "forged_replacement" }]);
    assert.equal(restarted.getRecordById("sess_1")!.originTopicId, "topic", "duplicate legacy import never changes validated origin");
    assert.deepEqual(await restarted.latestCompletedTopicPractice("user_1", "org_1", ["topic"]), { topic: "2026-03-31T10:05:00.000Z" });
    assert.deepEqual(await restarted.latestCompletedTopicPractice("other", "org_1", ["topic"]), {});
    assert.deepEqual(await restarted.latestCompletedTopicPractice("user_1", "other", ["topic"]), {});
    assert.deepEqual(await restarted.latestCompletedTopicPractice("user_1", "org_1", []), {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});
