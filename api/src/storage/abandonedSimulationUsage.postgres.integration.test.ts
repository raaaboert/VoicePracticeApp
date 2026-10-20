import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthDatabase } from "./authVerificationTestDatabase.js";
import { createSimulationSessionStore } from "./simulationSessionStore.js";
import { createUsageSessionStore } from "./usageSessionStore.js";
import { createUsageSessionAccess } from "../services/usageSessionAccess.js";
import { buildSimulationSessionStartRecord, completeRecognizedSimulationUsage } from "../services/simulationSessionLifecycle.js";
import { confirmedExchangeKey, estimatedSessionUsage } from "../services/simulationActivity.js";
import { newSessionUsageAccess, settleAbandonedSimulationBatch } from "../services/abandonedSimulationUsage.js";

const url = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
test("local PostgreSQL abandoned-session checkpoints, settlement, admission and restart integrity", { skip: !url }, async t => {
  const database = await createLocalAuthDatabase(url!);
  const options = { provider: "postgres" as const, databaseUrl: database.url, dbPath: "unused",
    pgPoolMax: 3, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 50 };
  const store = createSimulationSessionStore(options), other = createSimulationSessionStore(options);
  const usageStore = createUsageSessionStore(options), usage = createUsageSessionAccess(usageStore);
  const db = { usageSessions: [] };
  const start = new Date("2026-10-20T23:58:00.000Z");
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
  const register = async (id: string, userId = "learner", orgId = "org") => {
    await store.upsertStartedSession(buildSimulationSessionStartRecord({ simulationSessionId: id, userId, orgId,
      scenarioId: "scenario", scenarioVersionId: "published-v1", segmentId: "segment", trainingId: "topic",
      trainingPackId: null, clientStartedAt: start.toISOString(), now: start }));
  };
  const confirm = async (id: string, seconds: number, key: string, actor = "learner", actorOrg = "org") => store.recordConfirmedActivity({
    simulationSessionId: id, userId: actor, orgId: actorOrg, confirmedAt: at(seconds).toISOString(),
    exchangeKey: key === "opening" ? key : confirmedExchangeKey("turn", [{ role: "user", content: key }]), maxSimulationMinutes: 20,
  });
  const sweep = (now = at(43 * 60), limit = 50) => settleAbandonedSimulationBatch({ store, usage, db, now, limit,
    maxMinutes: () => 20, timeZone: () => "America/Denver" });
  const complete = (id: string, seconds = 200, sessionStore = store) => completeRecognizedSimulationUsage({
    simulationSessionStore: sessionStore, usageSessionAccess: usage, db, simulationSessionId: id, userId: "learner", orgId: "org",
    scenarioId: "scenario", segmentId: "segment", trainingId: "topic", submittedTrainingPackId: null, resolvedTrainingPackId: null,
    startedAt: start.toISOString(), endedAt: at(seconds).toISOString(), rawDurationSeconds: seconds,
    maxSimulationMinutes: 20, beforeUsage: usage.computeUserUsageSnapshot(db, { userId: "learner", now: at(seconds), timeZone: "America/Denver" }),
    timeZone: "America/Denver", now: at(39 * 60),
  });
  try {
    await store.initialize(); await other.initialize(); await usageStore.initialize();
    await t.test("additive schema initializes repeatedly without rewriting historical sessions", async () => {
      await register("legacy");
      await createSimulationSessionStore(options).initialize();
      assert.equal((await store.getById("legacy"))!.confirmedActivity, null);
      assert.equal(await sweep(), 0);
      assert.equal((await store.getById("legacy"))!.status, "started");
    });
    await t.test("opening/turn gaps, retries, out-of-order concurrent updates and ownership are durable across instances", async () => {
      await register("activity"); await confirm("activity", 5, "opening");
      assert.equal((await store.getById("activity"))!.confirmedActivity!.seconds, 0);
      await confirm("activity", 25, "first"); await confirm("activity", 625, "second");
      await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? other : store).recordConfirmedActivity({
        simulationSessionId: "activity", userId: "learner", orgId: "org", confirmedAt: at(650).toISOString(),
        exchangeKey: confirmedExchangeKey("turn", [{ role: "user", content: `concurrent-${i % 3}` }]), maxSimulationMinutes: 20,
      })));
      await confirm("activity", 700, "second"); // semantic retry, not a new exchange
      await confirm("activity", 630, "late");
      await confirm("activity", 710, "other-user", "other");
      await confirm("activity", 710, "other-org", "learner", "foreign");
      const activity = (await other.getById("activity"))!.confirmedActivity!;
      assert.equal(activity.seconds, 105);
      assert.equal(activity.exchangeKeys.length, 7);
      assert.equal(activity.lastAt, at(650).toISOString());
      assert.equal(JSON.stringify(activity).includes("concurrent-"), false);
    });
    await t.test("no settlement before full expiry, completion grace and clock-skew margin", async () => {
      assert.equal(await sweep(at(42 * 60 - 1)), 0);
      assert.equal((await store.getById("activity"))!.status, "started");
    });
    await t.test("unsettled usage affects user/day and org/month admission with existing rounding and no double counting", async () => {
      await register("teammate", "teammate"); await confirm("teammate", 0, "opening", "teammate");
      await confirm("teammate", 30, "team-turn", "teammate");
      await register("foreign", "foreign", "foreign-org");
      await confirm("foreign", 0, "opening", "foreign", "foreign-org");
      await confirm("foreign", 60, "foreign-turn", "foreign", "foreign-org");
      const projection = await newSessionUsageAccess({ store, usage, db, userId: "learner", orgId: "org", now: at(700) });
      assert.equal(projection.computeUserUsageSnapshot(db, { userId: "learner", now: at(700), timeZone: "America/Denver" }).billedSecondsToday, 105);
      assert.equal(projection.buildOrgUsageSnapshot(db, { orgId: "org", now: start, billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 2 }).usedSeconds, 135);
      assert.equal(projection.list(db).some(r => r.userId === "foreign"), false);
      await sweep();
      const after = await newSessionUsageAccess({ store: other, usage, db, userId: "learner", orgId: "org", now: at(700) });
      assert.equal(after.computeUserUsageSnapshot(db, { userId: "learner", now: at(700), timeZone: "America/Denver" }).billedSecondsToday, 105);
    });
    await t.test("concurrent settlement across independent stores inserts one record with pinned attribution and provenance", async () => {
      await register("race"); await confirm("race", 0, "opening"); await confirm("race", 30, "turn");
      const results = await Promise.all([sweep(), settleAbandonedSimulationBatch({ store: other, usage, db, now: at(43 * 60),
        maxMinutes: () => 20, timeZone: () => "America/Denver" })]);
      assert.equal(results.reduce((sum, n) => sum + n, 0), 1);
      const s = (await store.getById("race"))!;
      assert.equal(s.usageSource, "server_abandoned");
      const record = usage.getById(db, s.usageSessionRecordId!)!;
      assert.equal(record.rawDurationSeconds, 30);
      assert.equal(record.scenarioVersionId, "published-v1");
      assert.equal(record.trainingId, "topic");
      assert.equal(record.usageSource, "server_abandoned");
      assert.equal(await sweep(), 0);
      await confirm("race", 40, "after-finalization");
      assert.equal((await store.getById("race"))!.confirmedActivity!.seconds, 30);
    });
    await t.test("opening-only zero activity creates no billable minutes and does not invent a score", async () => {
      await register("opening-only"); await confirm("opening-only", 5, "opening"); await sweep();
      const s = (await store.getById("opening-only"))!;
      assert.equal(usage.getById(db, s.usageSessionRecordId!)!.rawDurationSeconds, 0);
    });
    await t.test("client completion keeps its duration instead of the estimate; retry and restart preserve the winner", async () => {
      await register("normal"); await confirm("normal", 0, "opening"); await confirm("normal", 60, "turn");
      const result = await complete("normal", 10);
      assert.equal(result.usageResult.record.rawDurationSeconds, 10); // Underreporting correction explicitly out of scope.
      assert.equal(result.usageResult.record.usageSource, "client_completed");
      const replay = await complete("normal", 400, createSimulationSessionStore(options));
      assert.equal(replay.usageResult.created, false);
      assert.equal(replay.usageResult.record.rawDurationSeconds, 10);
      assert.equal((await store.getById("normal"))!.usageSource, "client_completed");
    });
    await t.test("client completion racing abandonment never inserts two usage records", async () => {
      await register("client-race"); await confirm("client-race", 0, "opening"); await confirm("client-race", 60, "turn");
      await Promise.all([complete("client-race"), sweep()]);
      const s = (await store.getById("client-race"))!;
      const row = await database.pool.query("SELECT * FROM usage_sessions WHERE id=$1", [s.usageSessionRecordId]);
      assert.equal(row.rows.length, 1);
      assert.ok([60, 200].includes(row.rows[0].raw_duration_seconds));
      assert.equal(await sweep(), 0);
    });
    await t.test("failure between usage INSERT and session UPDATE rolls back; restarted settlement heals without duplication", async () => {
      await register("crash"); await confirm("crash", 0, "opening"); await confirm("crash", 30, "turn");
      await database.pool.query(`CREATE FUNCTION fail_settle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.simulation_session_id='crash' AND NEW.status='usage_recorded' THEN RAISE EXCEPTION 'simulated local crash'; END IF;
        RETURN NEW; END $$; CREATE TRIGGER fail_settle BEFORE UPDATE ON simulation_sessions FOR EACH ROW EXECUTE FUNCTION fail_settle()`);
      await assert.rejects(sweep());
      assert.equal((await store.getById("crash"))!.status, "started");
      const attempted = estimatedSessionUsage((await store.getById("crash"))!, at(43 * 60))!;
      assert.equal((await database.pool.query("SELECT id FROM usage_sessions WHERE id=$1", [attempted.id])).rows.length, 0);
      await database.pool.query("DROP TRIGGER fail_settle ON simulation_sessions; DROP FUNCTION fail_settle()");
      assert.equal(await settleAbandonedSimulationBatch({ store: createSimulationSessionStore(options), usage, db, now: at(43 * 60),
        maxMinutes: () => 20, timeZone: () => "America/Denver" }), 1);
    });
    await t.test("delayed reconciliation retains activity end day, original start month and effective timezone", async () => {
      await register("boundary"); await confirm("boundary", 0, "opening"); await confirm("boundary", 180, "midnight");
      await sweep(new Date("2026-11-03T00:00:00Z"));
      const s = (await store.getById("boundary"))!;
      const record = usage.getById(db, s.usageSessionRecordId!)!;
      assert.equal(record.startedAt, start.toISOString());
      assert.equal(record.endedAt, at(180).toISOString());
      const month = usage.buildOrgUsageSnapshot(db, { orgId: "org", now: new Date("2026-11-03T00:00:00Z"),
        billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 100 });
      assert.equal(month.usedSeconds, 0);
      assert.ok(usage.computeUserUsageSnapshot(db, { userId: "learner", now: start, timeZone: "America/Denver" }).rawSecondsToday >= 60);
      assert.equal(usage.computeUserUsageSnapshot(db, { userId: "learner", now: new Date("2026-11-03T00:00:00Z"), timeZone: "America/Denver" }).rawSecondsToday, 0);
    });
    await t.test("increased session maximum defers settlement safely without starving the due batch", async () => {
      await register("extended"); await confirm("extended", 0, "opening"); await confirm("extended", 30, "turn");
      assert.equal(await settleAbandonedSimulationBatch({ store, usage, db, now: at(43 * 60), maxMinutes: () => 60,
        timeZone: () => "UTC" }), 0);
      assert.equal((await store.getById("extended"))!.status, "started");
      assert.equal((await store.listAccountableSessions({ expiredBefore: at(43 * 60) })).length, 0);
      assert.equal(await settleAbandonedSimulationBatch({ store: other, usage, db, now: at(83 * 60), maxMinutes: () => 60,
        timeZone: () => "UTC" }), 1);
    });
    await t.test("a session crossing the monthly boundary stays in its start period and its actual end day", async () => {
      const first = new Date("2026-10-31T23:59:00Z"), last = new Date("2026-11-01T00:01:00Z");
      await store.upsertStartedSession(buildSimulationSessionStartRecord({ simulationSessionId: "month-crossing", userId: "boundary-user", orgId: "boundary-org",
        scenarioId: "scenario", scenarioVersionId: "v1", segmentId: "segment", trainingId: "topic", trainingPackId: null,
        clientStartedAt: first.toISOString(), now: first }));
      for (const [time, key] of [[first, "opening"], [last, confirmedExchangeKey("turn", [{ role: "user", content: "boundary" }])]] as const) {
        await store.recordConfirmedActivity({ simulationSessionId: "month-crossing", userId: "boundary-user", orgId: "boundary-org",
          exchangeKey: key, confirmedAt: time.toISOString(), maxSimulationMinutes: 20 });
      }
      await sweep(new Date("2026-11-03T00:00:00Z"));
      assert.equal(usage.buildOrgUsageSnapshot(db, { orgId: "boundary-org", now: first,
        billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 100 }).usedSeconds, 60);
      assert.equal(usage.buildOrgUsageSnapshot(db, { orgId: "boundary-org", now: last,
        billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 100 }).usedSeconds, 0);
      assert.equal(usage.computeUserUsageSnapshot(db, { userId: "boundary-user", now: last, timeZone: "UTC" }).rawSecondsToday, 60);
      assert.equal(usage.computeUserUsageSnapshot(db, { userId: "boundary-user", now: first, timeZone: "UTC" }).rawSecondsToday, 0);
      assert.equal(usage.computeUserUsageSnapshot(db, { userId: "boundary-user", now: first, timeZone: "America/Denver" }).rawSecondsToday, 60);
    });
    await t.test("pre-existing append-first client usage is healed rather than overwritten or relabeled abandoned", async () => {
      await register("old-split-write"); await confirm("old-split-write", 0, "opening"); await confirm("old-split-write", 60, "turn");
      const r = estimatedSessionUsage((await store.getById("old-split-write"))!, at(100))!;
      await usage.append(db, { ...r, rawDurationSeconds: 7, usageSource: "client_completed" });
      await sweep();
      const s = (await store.getById("old-split-write"))!;
      assert.equal(s.usageSource, "client_completed");
      assert.equal(usage.getById(db, s.usageSessionRecordId!)!.rawDurationSeconds, 7);
    });
    await t.test("settlement between admission reads cannot omit both finalized and unsettled usage", async () => {
      await register("admission-read-race", "race-user", "race-org");
      await confirm("admission-read-race", 0, "opening", "race-user", "race-org");
      await confirm("admission-read-race", 60, "turn", "race-user", "race-org");
      const projection = await newSessionUsageAccess({ usage, db, userId: "race-user", orgId: "race-org", now: at(43 * 60),
        store: { listAccountableSessions: async query => { await sweep(); return store.listAccountableSessions(query); } },
      });
      assert.equal(projection.computeUserUsageSnapshot(db, { userId: "race-user", now: start, timeZone: "UTC" }).rawSecondsToday, 60);
      assert.equal(projection.buildOrgUsageSnapshot(db, { orgId: "race-org", now: start,
        billingAnchorAt: "2026-10-01T00:00:00Z", allottedMinutes: 100 }).usedSeconds, 60);
    });
  } finally { await database.close(); }
});
