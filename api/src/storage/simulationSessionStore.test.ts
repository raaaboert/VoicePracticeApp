import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SimulationSessionRecord } from "@voicepractice/shared";

import { createSimulationSessionStore } from "./simulationSessionStore.js";

function createSession(overrides: Partial<SimulationSessionRecord> = {}): SimulationSessionRecord {
  return {
    simulationSessionId: overrides.simulationSessionId ?? "sim_1",
    userId: overrides.userId ?? "user_1",
    orgId: overrides.orgId ?? "org_1",
    divisionId: overrides.divisionId ?? null,
    segmentId: overrides.segmentId ?? "segment_1",
    scenarioId: overrides.scenarioId ?? "scenario_1",
    trainingId: overrides.trainingId ?? null,
    trainingPackId: overrides.trainingPackId ?? null,
    clientStartedAt: overrides.clientStartedAt ?? "2026-04-01T10:00:00.000Z",
    serverStartedAt: overrides.serverStartedAt ?? "2026-04-01T10:00:02.000Z",
    lastSeenAt: overrides.lastSeenAt ?? "2026-04-01T10:00:02.000Z",
    status: overrides.status ?? "started",
    usageRecordedAt: overrides.usageRecordedAt ?? null,
    usageSessionRecordId: overrides.usageSessionRecordId ?? null
  };
}

test("file simulation session store upserts, touches, finalizes, and deletes by user", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-simulation-session-store-"));
  try {
    const store = createSimulationSessionStore({
      provider: "file",
      dbPath: path.join(tempDir, "db.local.json"),
      databaseUrl: null,
      pgPoolMax: 1,
      pgConnectTimeoutMs: 1_000,
      pgIdleTimeoutMs: 1_000
    });
    await store.initialize();

    const created = await store.upsertStartedSession(createSession({ divisionId: "division_1" }));
    assert.equal(created.status, "started");
    assert.equal(created.divisionId, "division_1");

    const merged = await store.upsertStartedSession(
      createSession({
        simulationSessionId: "sim_1",
        trainingPackId: "pack_1",
        lastSeenAt: "2026-04-01T10:03:00.000Z"
      })
    );
    assert.equal(merged.trainingPackId, "pack_1");
    assert.equal(merged.lastSeenAt, "2026-04-01T10:03:00.000Z");

    const touched = await store.touchSession({
      simulationSessionId: "sim_1",
      lastSeenAt: "2026-04-01T10:04:00.000Z",
      trainingPackId: null
    });
    assert.equal(touched?.lastSeenAt, "2026-04-01T10:04:00.000Z");

    const finalized = await store.markUsageRecorded({
      simulationSessionId: "sim_1",
      usageRecordedAt: "2026-04-01T10:05:00.000Z",
      usageSessionRecordId: "usagesim_1",
      lastSeenAt: "2026-04-01T10:05:00.000Z"
    });
    assert.equal(finalized?.status, "usage_recorded");
    assert.equal(finalized?.usageSessionRecordId, "usagesim_1");

    const replayed = await store.markUsageRecorded({
      simulationSessionId: "sim_1",
      usageRecordedAt: "2026-04-01T10:06:00.000Z",
      usageSessionRecordId: "usagesim_1",
      lastSeenAt: "2026-04-01T10:06:00.000Z"
    });
    assert.equal(replayed?.status, "usage_recorded");
    assert.equal(replayed?.usageRecordedAt, "2026-04-01T10:05:00.000Z");

    await store.upsertStartedSession(
      createSession({
        simulationSessionId: "sim_2",
        userId: "user_2"
      })
    );
    await store.upsertStartedSession(
      createSession({
        simulationSessionId: "sim_stale",
        userId: "user_2",
        lastSeenAt: "2026-03-28T10:00:00.000Z"
      })
    );

    assert.equal((await store.getById("sim_1"))?.usageSessionRecordId, "usagesim_1");
    assert.deepEqual(
      (await store.listSessions()).map((entry) => entry.simulationSessionId).sort(),
      ["sim_1", "sim_2", "sim_stale"]
    );
    assert.equal(await store.pruneStartedSessionsLastSeenBefore(new Date("2026-03-30T00:00:00.000Z")), 1);
    assert.equal(await store.getById("sim_stale"), null);
    assert.equal(await store.deleteSessionsForUser("user_1"), 1);
    assert.equal(await store.getById("sim_1"), null);
    assert.equal((await store.getById("sim_2"))?.userId, "user_2");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
