import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageSessionRecord } from "@voicepractice/shared";

import { createUsageSessionAccess } from "./usageSessionAccess.js";
import {
  buildSimulationSessionStartRecord,
  buildUsageSessionIdFromSimulationSessionId,
  completeRecognizedSimulationUsage,
  registerRecognizedSimulationSessionStart,
  SimulationSessionValidationError
} from "./simulationSessionLifecycle.js";
import { createUsageSessionStore } from "../storage/usageSessionStore.js";
import { createSimulationSessionStore } from "../storage/simulationSessionStore.js";

function createBeforeUsage() {
  return {
    rawSecondsToday: 300,
    billedSecondsToday: 300,
    rawSecondsThisMonth: 300,
    billedSecondsThisMonth: 300,
    dayKey: "2026-04-01",
    monthKey: "2026-04",
    timezoneUsed: "UTC",
    dailySecondsRemaining: 600,
    orgBillingPeriodStartAt: null,
    orgBillingPeriodEndAt: null,
    orgUsedSecondsThisPeriod: null,
    orgAllottedSecondsThisPeriod: null,
    orgRemainingSecondsThisPeriod: null,
    orgUsagePercentThisPeriod: null,
    userDailyCapSeconds: null,
    userDailyOverageAllowed: false,
    nextDailyResetLabel: "Tomorrow",
    nextRenewalAt: "2026-05-01T00:00:00.000Z"
  };
}

async function createStores() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "vp-simulation-session-lifecycle-"));
  const usageStore = createUsageSessionStore({
    provider: "file",
    dbPath: path.join(tempDir, "db.local.json"),
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1_000,
    pgIdleTimeoutMs: 1_000
  });
  const simulationSessionStore = createSimulationSessionStore({
    provider: "file",
    dbPath: path.join(tempDir, "db.local.json"),
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1_000,
    pgIdleTimeoutMs: 1_000
  });
  await usageStore.initialize();
  await simulationSessionStore.initialize();
  return { tempDir, usageStore, simulationSessionStore };
}

test("simulation session lifecycle recognizes start, finalizes usage once, and safely replays duplicate completion", async () => {
  const { tempDir, usageStore, simulationSessionStore } = await createStores();
  try {
    const usageSessionAccess = createUsageSessionAccess(usageStore);
    const db = { usageSessions: [] as UsageSessionRecord[] };

    await registerRecognizedSimulationSessionStart(simulationSessionStore, {
      simulationSessionId: "sim_alpha",
      userId: "user_1",
      orgId: "org_1",
      segmentId: "segment_1",
      scenarioId: "scenario_1",
      trainingId: null,
      trainingPackId: "pack_1",
      clientStartedAt: "2026-04-01T10:00:00.000Z",
      now: new Date("2026-04-01T10:00:01.000Z")
    });

    const first = await completeRecognizedSimulationUsage({
      simulationSessionStore,
      usageSessionAccess,
      db,
      simulationSessionId: "sim_alpha",
      userId: "user_1",
      orgId: "org_1",
      segmentId: "segment_1",
      scenarioId: "scenario_1",
      trainingId: null,
      submittedTrainingPackId: "pack_1",
      resolvedTrainingPackId: "pack_1",
      startedAt: "2026-04-01T10:00:30.000Z",
      endedAt: "2026-04-01T10:05:30.000Z",
      rawDurationSeconds: 300,
      beforeUsage: createBeforeUsage(),
      maxSimulationMinutes: 20,
      timeZone: "UTC",
      now: new Date("2026-04-01T10:05:31.000Z")
    });
    assert.equal(first.usageResult.created, true);
    assert.equal(first.usageResult.record.id, buildUsageSessionIdFromSimulationSessionId("sim_alpha"));
    assert.equal(first.simulationSession.status, "usage_recorded");

    const replay = await completeRecognizedSimulationUsage({
      simulationSessionStore,
      usageSessionAccess,
      db,
      simulationSessionId: "sim_alpha",
      userId: "user_1",
      orgId: "org_1",
      segmentId: "segment_1",
      scenarioId: "scenario_1",
      trainingId: null,
      submittedTrainingPackId: "pack_1",
      resolvedTrainingPackId: "pack_1",
      startedAt: "2026-04-01T10:00:30.000Z",
      endedAt: "2026-04-01T10:05:30.000Z",
      rawDurationSeconds: 300,
      beforeUsage: createBeforeUsage(),
      maxSimulationMinutes: 20,
      timeZone: "UTC",
      now: new Date("2026-04-01T10:06:00.000Z")
    });
    assert.equal(replay.usageResult.created, false);
    assert.equal(replay.usageResult.record.id, first.usageResult.record.id);
    assert.equal(usageStore.listRecords().length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("simulation session lifecycle rejects completion without a recognized started session", async () => {
  const { tempDir, usageStore, simulationSessionStore } = await createStores();
  try {
    const usageSessionAccess = createUsageSessionAccess(usageStore);
    const db = { usageSessions: [] as UsageSessionRecord[] };

    await assert.rejects(
      completeRecognizedSimulationUsage({
        simulationSessionStore,
        usageSessionAccess,
        db,
        simulationSessionId: "sim_missing",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        trainingId: null,
        submittedTrainingPackId: null,
        resolvedTrainingPackId: null,
        startedAt: "2026-04-01T10:00:30.000Z",
        endedAt: "2026-04-01T10:05:30.000Z",
        rawDurationSeconds: 300,
        beforeUsage: createBeforeUsage(),
        maxSimulationMinutes: 20,
        timeZone: "UTC",
        now: new Date("2026-04-01T10:05:31.000Z")
      }),
      (error: unknown) => {
        assert.ok(error instanceof SimulationSessionValidationError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "session_not_recognized");
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("simulation session lifecycle preserves local/mock-style completion without AI touches but rejects unreasonable timing drift and mismatched context", async () => {
  const { tempDir, usageStore, simulationSessionStore } = await createStores();
  try {
    const usageSessionAccess = createUsageSessionAccess(usageStore);
    const db = { usageSessions: [] as UsageSessionRecord[] };

    await simulationSessionStore.upsertStartedSession(
      buildSimulationSessionStartRecord({
        simulationSessionId: "sim_local",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        trainingId: null,
        trainingPackId: null,
        clientStartedAt: "2026-04-01T10:00:00.000Z",
        now: new Date("2026-04-01T10:00:00.000Z")
      })
    );

    const localCompletion = await completeRecognizedSimulationUsage({
      simulationSessionStore,
      usageSessionAccess,
      db,
      simulationSessionId: "sim_local",
      userId: "user_1",
      orgId: "org_1",
      segmentId: "segment_1",
      scenarioId: "scenario_1",
      trainingId: null,
      submittedTrainingPackId: null,
      resolvedTrainingPackId: null,
      startedAt: "2026-04-01T10:01:00.000Z",
      endedAt: "2026-04-01T10:06:00.000Z",
      rawDurationSeconds: 300,
      beforeUsage: createBeforeUsage(),
      maxSimulationMinutes: 20,
      timeZone: "UTC",
      now: new Date("2026-04-01T10:06:01.000Z")
    });
    assert.equal(localCompletion.usageResult.created, true);

    await simulationSessionStore.upsertStartedSession(
      buildSimulationSessionStartRecord({
        simulationSessionId: "sim_bad",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        trainingId: null,
        trainingPackId: null,
        clientStartedAt: "2026-04-01T10:10:00.000Z",
        now: new Date("2026-04-01T10:10:00.000Z")
      })
    );

    await assert.rejects(
      completeRecognizedSimulationUsage({
        simulationSessionStore,
        usageSessionAccess,
        db,
        simulationSessionId: "sim_bad",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        scenarioId: "scenario_1",
        trainingId: null,
        submittedTrainingPackId: null,
        resolvedTrainingPackId: null,
        startedAt: "2026-04-01T10:00:00.000Z",
        endedAt: "2026-04-01T10:03:00.000Z",
        rawDurationSeconds: 180,
        beforeUsage: createBeforeUsage(),
        maxSimulationMinutes: 20,
        timeZone: "UTC",
        now: new Date("2026-04-01T10:11:00.000Z")
      }),
      (error: unknown) => {
        assert.ok(error instanceof SimulationSessionValidationError);
        assert.equal(error.code, "session_start_drift");
        return true;
      }
    );

    await assert.rejects(
      completeRecognizedSimulationUsage({
        simulationSessionStore,
        usageSessionAccess,
        db,
        simulationSessionId: "sim_local",
        userId: "user_1",
        orgId: "org_1",
        segmentId: "segment_1",
        scenarioId: "scenario_2",
        trainingId: null,
        submittedTrainingPackId: null,
        resolvedTrainingPackId: null,
        startedAt: "2026-04-01T10:01:00.000Z",
        endedAt: "2026-04-01T10:06:00.000Z",
        rawDurationSeconds: 300,
        beforeUsage: createBeforeUsage(),
        maxSimulationMinutes: 20,
        timeZone: "UTC",
        now: new Date("2026-04-01T10:06:01.000Z")
      }),
      (error: unknown) => {
        assert.ok(error instanceof SimulationSessionValidationError);
        assert.equal(error.code, "session_context_mismatch");
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
