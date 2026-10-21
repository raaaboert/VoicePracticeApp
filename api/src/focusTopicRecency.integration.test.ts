import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createDatabaseStorage } from "./storage.js";
import { createFocusTopicAuthorityStore } from "./storage/focusTopicAuthorityStore.js";
import { createSimulationSessionStore } from "./storage/simulationSessionStore.js";
import { createUsageSessionStore } from "./storage/usageSessionStore.js";
import { createOrgModuleEntitlementStore } from "./storage/orgModuleEntitlementStore.js";
import { createScoreRecordStore } from "./storage/scoreRecordStore.js";
import { createUserNotificationStore } from "./storage/userNotificationStore.js";
import { createPerformancePlanStore } from "./storage/performancePlanStore.js";
import { createAuditEventStore } from "./storage/auditEventStore.js";

const url = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
test("local PostgreSQL HTTP Topic origin, completed-practice recency, isolation and restart compatibility", { skip: !url }, async t => {
  const local = await createLocalAuthDatabase(url!);
  const options = { provider: "postgres" as const, databaseUrl: local.url, dbPath: "unused",
    pgPoolMax: 2, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 100 };
  let server: Server | undefined;
  try {
    await local.migrate();
    await createOrgModuleEntitlementStore({ ...options, queryPool: local.pool }).initialize();
    Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres",
      DATABASE_URL: local.url, PG_IDLE_TIMEOUT_MS: "100", FOCUS_TOPIC_AUTHORITY: "assignments",
      ADMIN_TOKEN_SECRET: "recency_local_admin_secret_2026", ADMIN_BOOTSTRAP_PASSWORD: "local_test_password",
      WEB_AUTH_TOKEN_SECRET: "recency_local_web_token_secret_2026", WEB_AUTH_CODE_SECRET: "recency_local_web_code_secret_2026",
      MOBILE_TOKEN_SECRET: "recency_local_mobile_token_secret_2026", SUPPORT_TRANSCRIPT_SECRET: "recency_local_support_secret_2026",
      AUTH_CODE_DELIVERY_PROVIDER: "log_only", OPENAI_API_KEY: "local-test-key", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false" });
    const api = await import("./index.js");
    const now = new Date().toISOString();
    const old = "2020-01-01T00:00:00.000Z";
    const db = api.createDefaultDatabase();
    api.ensureDemoEnterpriseData(db, now);
    const sourceOrg = db.orgs.find(row => row.status === "active" && row.activeIndustries.includes("people_management"))!;
    const org = { ...sourceOrg, id: "recency_org", name: "Recency organization", joinCode: "RECENCY-LOCAL" };
    const user = { ...db.users.find(row => row.orgId === sourceOrg.id && !row.isSuperUser)!,
      id: "recency_user", orgId: org.id, email: "learner@recency.test" };
    assert.ok(org && user);
    Object.assign(user, { firstName: "Local", lastName: "Learner", orgRole: "user", status: "active", emailVerifiedAt: now, mobileProfileReonboardingRequired: false });
    org.divisionsEnabled = false;
    const otherOrg = { ...org, id: "recency_foreign", name: "Foreign", joinCode: "RECENCY-FOREIGN" };
    const other = { ...user, id: "recency_other", email: "other@recency.test" };
    const foreign = { ...other, id: "recency_foreign_user", orgId: otherOrg.id, email: "foreign@recency.test" };
    db.orgs = [org, otherOrg]; db.users = [user, other, foreign];
    const segment = db.config.segments.find(row => row.id === "solution_manager")!;
    const standard = segment.scenarios.find(row => row.enabled !== false)!;
    const unattached = segment.scenarios.find(row => row.enabled !== false && row.id !== standard.id)!;
    const customId = "recency_custom";
    org.customScenarios = [{ id: customId, orgId: org.id, segmentId: segment.id, title: "Recency custom",
      description: "Practice a discussion", aiRole: "A colleague", scoringGuidance: "",
      applicableIndustryIds: [...org.activeIndustries], enabled: true,
      provenance: { sourceMode: "scratch", creationMethod: "manual" }, createdBy: "platform_admin", createdAt: old, updatedAt: old }];
    const topic = (id: string) => ({ id, orgId: org.id, name: id, description: "", status: "active" as const, createdAt: old, updatedAt: old });
    const a = topic("recency_A"), b = topic("recency_B"), unassigned = topic("recency_unassigned");
    db.orgTrainings = [a, b, unassigned]; db.orgTrainingPackAttachments = []; db.orgTrainingScenarioAttachments = [];
    const tokens = new Map([[user.id, randomUUID()], [other.id, randomUUID()], [foreign.id, randomUUID()]]);
    db.mobileAuthTokens = [...tokens].map(([userId, token]) => ({ userId,
      tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update(token).digest("hex"), createdAt: now, updatedAt: now }));
    const storage = createDatabaseStorage({ ...options, queryPool: local.pool,
      ensureDatabaseShape: api.ensureDatabaseShape, createDefaultDatabase: api.createDefaultDatabase });
    await storage.save(db);
    const authority = createFocusTopicAuthorityStore({ ...options, queryPool: local.pool });
    await authority.initialize();
    const assignments = [a, b].map(row => ({ id: `assignment_${row.id}`, orgId: org.id, topicId: row.id,
      audience: "individual" as const, subjectUserId: user.id, grantsManagement: false, createdBy: "platform_admin",
      createdAt: old, revokedAt: null, revokedBy: null }));
    const client = await local.pool.connect();
    try {
      for (const assignment of assignments) {
        await authority.createAssignment(assignment, client);
        for (const [scenarioId, scenarioKind] of [[standard.id, "standard"], [customId, "org"]] as const) {
          await authority.attachScenario({ id: randomUUID(), orgId: org.id, topicId: assignment.topicId,
            scenarioId, scenarioKind, attachedBy: "platform_admin", attachedAt: old, detachedBy: null, detachedAt: null }, client);
        }
      }
    } finally { client.release(); }
    const sessions = createSimulationSessionStore(options), usage = createUsageSessionStore(options);
    await sessions.initialize(); await usage.initialize();
    await createScoreRecordStore(options).initialize();
    await createUserNotificationStore({ ...options, queryPool: local.pool }).initialize();
    await createPerformancePlanStore({ ...options, queryPool: local.pool }).initialize();
    await createAuditEventStore(options).initialize();
    server = await new Promise<Server>(resolve => { const started = api.app.listen(0, () => resolve(started)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (path: string, body?: object, actor = user.id) => {
      const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: {
        Authorization: `Bearer ${tokens.get(actor)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as any };
    };
    const catalog = () => request(`/mobile/users/${user.id}/focus-topics`);
    const start = (originTopicId?: string, scenarioId = standard.id, trainingId: string | null = null, id = randomUUID()) =>
      request(`/mobile/users/${user.id}/simulation-sessions/start`, { simulationSessionId: id,
        segmentId: segment.id, scenarioId, trainingId, ...(originTopicId ? { originTopicId } : {}) });
    const complete = (started: Awaited<ReturnType<typeof start>>, scenarioId = standard.id, trainingId: string | null = null) => {
      const endedAt = new Date().toISOString();
      return request("/usage/sessions", { simulationSessionId: started.body.simulationSessionId, userId: user.id,
        segmentId: segment.id, scenarioId, trainingId, startedAt: started.body.serverStartedAt, endedAt,
        rawDurationSeconds: Math.floor((Date.parse(endedAt) - Date.parse(started.body.serverStartedAt)) / 1000) });
    };
    await t.test("standard origin survives registration/restart and duplicate completion without changing trainingId or billed minutes", async () => {
      const started = await start(a.id);
      assert.equal(started.status, 201, JSON.stringify(started.body));
      const persisted = await createSimulationSessionStore(options).getById(started.body.simulationSessionId);
      assert.equal(persisted!.originTopicId, a.id); assert.equal(persisted!.trainingId ?? null, null);
      assert.equal((await start(a.id, standard.id, null, started.body.simulationSessionId)).status, 201);
      assert.equal((await start(b.id, standard.id, null, started.body.simulationSessionId)).status, 409);
      const first = await complete(started);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const repeated = await complete(started);
      assert.equal(repeated.status, 201);
      assert.equal(repeated.body.billedSecondsAdded, 0);
      const rows = await local.pool.query("SELECT origin_topic_id,training_id,raw_duration_seconds,started_at,ended_at,usage_source FROM usage_sessions WHERE user_id=$1", [user.id]);
      assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].origin_topic_id, a.id);
      assert.equal(rows.rows[0].training_id, null);
      // Completion submits actual elapsed seconds; full-suite scheduling may take
      // longer than one second. Verify exact persisted duration, not assumed speed.
      assert.equal(rows.rows[0].raw_duration_seconds, Math.floor(
        (new Date(rows.rows[0].ended_at).getTime() - new Date(rows.rows[0].started_at).getTime()) / 1000));
      assert.equal(rows.rows[0].usage_source, "client_completed");
      assert.equal(repeated.body.entitlements.usage.rawSecondsToday, first.body.entitlements.usage.rawSecondsToday);
      const raceId = randomUUID();
      const simultaneous = await Promise.allSettled([a.id, b.id].map(originTopicId =>
        createSimulationSessionStore(options).upsertStartedSession({ ...persisted!, simulationSessionId: raceId, originTopicId })));
      assert.equal(simultaneous.filter(row => row.status === "fulfilled").length, 1);
      assert.equal(simultaneous.filter(row => row.status === "rejected").length, 1, "concurrent registrations cannot change the winning origin");
      const result = await catalog(); assert.equal(result.status, 200);
      assert.ok(result.body.topics.find((row: any) => row.id === a.id).lastCompletedPracticeAt);
      assert.equal(result.body.topics.find((row: any) => row.id === b.id).lastCompletedPracticeAt, null);
    });
    await t.test("custom origin is explicit; Browse/older clients, historical usage, unfinished and abandoned sessions stay unattributed", async () => {
      const custom = await start(b.id, customId, b.id); assert.equal(custom.status, 201, JSON.stringify(custom.body));
      assert.equal((await complete(custom, customId, b.id)).status, 201);
      const customRecord = await sessions.getById(custom.body.simulationSessionId);
      assert.equal(customRecord!.originTopicId, b.id); assert.equal(customRecord!.trainingId, b.id);
      const browse = await start(); assert.equal(browse.status, 201);
      assert.equal((await start(a.id, standard.id, null, browse.body.simulationSessionId)).status, 409, "an unattributed session cannot acquire origin on retry");
      assert.equal((await complete(browse)).status, 201);
      assert.equal((await sessions.getById(browse.body.simulationSessionId))!.originTopicId, undefined);
      const unfinished = await start(a.id); assert.equal(unfinished.status, 201);
      const before = await usage.latestCompletedTopicPractice(user.id, org.id, [a.id, b.id]);
      for (const [id, usageSource, originTopicId] of [["abandoned", "server_abandoned", a.id], ["historical", null, null]] as const) {
        await usage.appendRecord({ id, userId: user.id, orgId: org.id, segmentId: segment.id, scenarioId: standard.id,
          originTopicId, usageSource, startedAt: now, endedAt: "2099-01-01T00:00:00.000Z", rawDurationSeconds: 60, createdAt: now });
      }
      assert.deepEqual(await usage.latestCompletedTopicPractice(user.id, org.id, [a.id, b.id]), before);
      assert.deepEqual(await usage.latestCompletedTopicPractice(other.id, org.id, [a.id, b.id]), {});
      assert.deepEqual(await usage.latestCompletedTopicPractice(user.id, otherOrg.id, [a.id, b.id]), {});
      const restarted = createUsageSessionStore(options); await restarted.initialize();
      assert.deepEqual(await restarted.latestCompletedTopicPractice(user.id, org.id, [a.id, b.id]), before);
    });
    await t.test("invalid, revoked, foreign and unattached origins fail closed; recency stays scoped and catalog company order is unchanged", async () => {
      assert.equal((await start(unassigned.id)).status, 403);
      assert.equal((await start("unknown")).status, 403);
      assert.notEqual((await start(a.id, unattached.id)).status, 201);
      const unauthorized = await request(`/mobile/users/${other.id}/simulation-sessions/start`, {
        simulationSessionId: randomUUID(), segmentId: segment.id, scenarioId: standard.id, originTopicId: a.id }, other.id);
      assert.equal(unauthorized.status, 403);
      const foreignAttempt = await request(`/mobile/users/${foreign.id}/simulation-sessions/start`, {
        simulationSessionId: randomUUID(), segmentId: segment.id, scenarioId: standard.id, originTopicId: a.id }, foreign.id);
      assert.equal(foreignAttempt.status, 403, JSON.stringify(foreignAttempt.body));
      assert.equal(foreignAttempt.body.code, "invalid_topic_origin");
      await local.pool.query("UPDATE focus_topic_assignments SET created_at=$1 WHERE id=$2", [now, assignments[1]!.id]);
      const result = await catalog();
      assert.deepEqual(result.body.topics.map((row: any) => row.id), [a.id, b.id]);
      assert.equal(result.body.topics[1].latestAssignmentAt, now);
      assert.deepEqual((await request(`/mobile/users/${other.id}/focus-topics`, undefined, other.id)).body.topics, []);
      await local.pool.query("UPDATE focus_topic_assignments SET revoked_at=NOW(),revoked_by='platform_admin' WHERE id=$1", [assignments[0]!.id]);
      assert.equal((await start(a.id)).status, 403);
      assert.deepEqual((await catalog()).body.topics.map((row: any) => row.id), [b.id]);
      const current = await storage.load();
      const savedIndustries = [...current.orgs.find(row => row.id === org.id)!.activeIndustries];
      current.orgs.find(row => row.id === org.id)!.activeIndustries = [];
      await storage.save(current);
      // Fixture writes bypass the API's serialized mutation path: refresh its
      // app-state view before a registration, which normally uses that cache.
      assert.equal((await request(`/mobile/users/${user.id}/config`)).status, 200);
      assert.notEqual((await start(b.id)).status, 201, "zero effective industries cannot claim a Topic launch");
      current.orgs.find(row => row.id === org.id)!.activeIndustries = savedIndustries;
      current.config.roleIndustries = current.config.roleIndustries.map(row => row.roleId === segment.id ? { ...row, active: false } : row);
      await storage.save(current);
      assert.equal((await request(`/mobile/users/${user.id}/config`)).status, 200);
      assert.notEqual((await start(b.id)).status, 201, "Role eligibility cannot be bypassed by origin");
      await createSimulationSessionStore(options).initialize(); await createUsageSessionStore(options).initialize();
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await local.close();
  }
});
