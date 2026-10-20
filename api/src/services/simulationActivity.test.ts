import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SimulationSessionRecord } from "@voicepractice/shared";
import { applyConfirmedActivity, confirmedExchangeKey, estimatedSessionUsage, activitySettlementDeadline } from "./simulationActivity.js";
import { scheduleAbandonedSimulationSettlement, usageAccessSnapshot } from "./abandonedSimulationUsage.js";
import { settleAbandonedSimulationBatch } from "./abandonedSimulationUsage.js";
import { createSimulationSessionStore } from "../storage/simulationSessionStore.js";
import { createUsageSessionStore } from "../storage/usageSessionStore.js";
import { createUsageSessionAccess } from "./usageSessionAccess.js";

const start = Date.parse("2026-10-20T23:58:00Z");
const session = (): SimulationSessionRecord => ({ simulationSessionId: "activity-test", userId: "learner", orgId: "org",
  scenarioId: "scenario", scenarioVersionId: "v1", segmentId: "segment", trainingId: "topic", status: "started",
  serverStartedAt: new Date(start).toISOString(), lastSeenAt: new Date(start).toISOString() });
const checkpoint = (s: SimulationSessionRecord, seconds: number, key: string, maxMinutes = 20) => applyConfirmedActivity(s, {
  simulationSessionId: s.simulationSessionId, userId: s.userId, orgId: s.orgId,
  confirmedAt: new Date(start + seconds * 1000).toISOString(), exchangeKey: key === "opening" ? key : confirmedExchangeKey("turn", [{ role: "user", content: key }]),
  maxSimulationMinutes: maxMinutes,
});

test("confirmed exchange gaps cap at 60 seconds, with no time before opening or after last success", () => {
  let s = checkpoint(session(), 10, "opening");
  assert.equal(estimatedSessionUsage(s, new Date(start + 100_000))!.rawDurationSeconds, 0);
  s = checkpoint(s, 30, "first");
  assert.equal(s.confirmedActivity!.seconds, 20);
  s = checkpoint(s, 600, "second");
  assert.equal(s.confirmedActivity!.seconds, 80);
  const usage = estimatedSessionUsage(s, new Date(start + 3_600_000))!;
  assert.equal(usage.rawDurationSeconds, 80);
  assert.equal(usage.endedAt, new Date(start + 600_000).toISOString());
  assert.equal(usage.startedAt, s.serverStartedAt);
  assert.equal(usage.scenarioVersionId, "v1");
  assert.equal(usage.usageSource, "server_abandoned");
});

test("semantic retries, late checkpoints, wrong ownership, expiry and finalized state cannot add duplicate time", () => {
  let s = checkpoint(checkpoint(session(), 0, "opening"), 30, "turn");
  assert.equal(checkpoint(s, 50, "turn"), s);
  s = checkpoint(s, 10, "late");
  assert.equal(s.confirmedActivity!.seconds, 30);
  assert.equal(s.confirmedActivity!.lastAt, new Date(start + 30_000).toISOString());
  assert.equal(checkpoint(s, 1200, "expired"), s);
  const p = { simulationSessionId: s.simulationSessionId, userId: "other", orgId: s.orgId,
    exchangeKey: "opening", confirmedAt: new Date(start + 50_000).toISOString(), maxSimulationMinutes: 20 };
  assert.equal(applyConfirmedActivity(s, p), s);
  assert.equal(applyConfirmedActivity(s, { ...p, userId: s.userId, orgId: "foreign" }), s);
  const completed = { ...s, status: "usage_recorded" as const };
  assert.equal(checkpoint(completed, 60, "later"), completed);
  assert.equal(estimatedSessionUsage(completed, new Date()), null);
});

test("session maximum and full completion grace plus two-minute skew margin bound abandonment", () => {
  let s = checkpoint(session(), 0, "opening", 1);
  for (let second = 1; second < 60; second++) s = checkpoint(s, second, String(second), 1);
  assert.equal(s.confirmedActivity!.seconds, 59);
  assert.equal(checkpoint(s, 60, "past", 1), s);
  assert.equal(activitySettlementDeadline(s, 1), start + 23 * 60_000);
  assert.equal(activitySettlementDeadline(s, null), start + (8 * 60 + 2) * 60_000);
});

test("effective end timezone and original start retain daily/monthly attribution and unchanged per-session rounding", () => {
  const a = estimatedSessionUsage(checkpoint(checkpoint(session(), 0, "opening"), 14, "a"), new Date())!;
  const b = { ...a, id: "second", rawDurationSeconds: 14 };
  const usage = usageAccessSnapshot([a, b]);
  const db = { usageSessions: [] };
  const daily = usage.computeUserUsageSnapshot(db, { userId: a.userId, now: new Date(a.endedAt), timeZone: "America/Denver" });
  assert.equal(daily.rawSecondsToday, 28);
  assert.equal(daily.billedSecondsToday, 15);
  assert.equal(usage.buildOrgUsageSnapshot(db, { orgId: "org", now: new Date(a.startedAt),
    billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 1 }).usedSeconds, 0);
  assert.equal(usage.computeUserUsageSnapshot(db, { userId: a.userId,
    now: new Date("2026-10-21T01:00:00Z"), timeZone: "UTC" }).rawSecondsToday, 0);
});

test("scheduled settlement catches up at startup, avoids overlapping sweeps and stops on server close", async () => {
  const server = new EventEmitter();
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stop = scheduleAbandonedSimulationSettlement(async () => { calls++; await gate; }, server, 5);
  assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  server.emit("close"); release();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 1);
  stop();
});

test("file-mode abandonment survives restart, settles once, and preserves usage provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "peritio-abandoned-"));
  try {
    const options = { provider: "file" as const, dbPath: path.join(directory, "db.json"), databaseUrl: null,
      pgPoolMax: 1, pgConnectTimeoutMs: 100, pgIdleTimeoutMs: 100 };
    const store = createSimulationSessionStore(options);
    const usageStore = createUsageSessionStore(options);
    await store.initialize(); await usageStore.initialize();
    await store.upsertStartedSession(session());
    for (const [seconds, key] of [[0, "opening"], [90, "turn"]] as const) await store.recordConfirmedActivity({
      simulationSessionId: "activity-test", userId: "learner", orgId: "org", confirmedAt: new Date(start + seconds * 1000).toISOString(),
      exchangeKey: key === "opening" ? key : confirmedExchangeKey("turn", [{ role: "user", content: key }]), maxSimulationMinutes: 20,
    });
    const restarted = createSimulationSessionStore(options);
    const usage = createUsageSessionAccess(usageStore), db = { usageSessions: [] };
    const settle = () => settleAbandonedSimulationBatch({ store: restarted, usage, db, now: new Date(start + 43 * 60_000),
      maxMinutes: () => 20, timeZone: () => "UTC" });
    assert.equal(await settle(), 1);
    assert.equal(await settle(), 0);
    const finished = (await restarted.getById("activity-test"))!;
    assert.equal(finished.usageSource, "server_abandoned");
    const record = usage.getById(db, finished.usageSessionRecordId!)!;
    assert.equal(record.rawDurationSeconds, 60);
    assert.equal(record.usageSource, "server_abandoned");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
