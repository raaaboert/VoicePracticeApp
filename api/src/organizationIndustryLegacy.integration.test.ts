import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import { createDatabaseStorage } from "./storage.js";
import { createOrgModuleEntitlementStore } from "./storage/orgModuleEntitlementStore.js";
import { assertIndustryCacheParity } from "./industryRuntimeCache.testSupport.js";
import { applyAuthenticationTestSchema } from "./storage/postgresTestSchema.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim() ?? "";

test("real PostgreSQL global catalog safety and legacy organization industry compatibility", { skip: !databaseUrl }, async (t) => {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /test|integration|throwaway/);
  const setup = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `industry_legacy_${randomBytes(8).toString("hex")}`;
  let pool: Pool | undefined;
  let server: Server | undefined;
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    scoped.searchParams.set("application_name", schema);
    const url = scoped.toString();
    pool = new Pool({ connectionString: url, max: 3 });
    await applyAuthenticationTestSchema(pool);
    const entitlements = createOrgModuleEntitlementStore({ provider: "postgres", databaseUrl: url,
      pgPoolMax: 3, pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 1000, queryPool: pool });
    await entitlements.initialize();
    Object.assign(process.env, {
      NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: url,
      PG_IDLE_TIMEOUT_MS: "1000", FOCUS_TOPIC_AUTHORITY: "legacy", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false",
      ADMIN_TOKEN_SECRET: "industry_legacy_admin_secret", ADMIN_BOOTSTRAP_PASSWORD: "industry_legacy_admin_password",
      MOBILE_TOKEN_SECRET: "industry_legacy_mobile_secret_2026_local", WEB_AUTH_TOKEN_SECRET: "industry_legacy_web_secret_2026_local",
      WEB_AUTH_CODE_SECRET: "industry_legacy_code_secret_2026_local", SUPPORT_TRANSCRIPT_SECRET: "industry_legacy_support_secret_2026_local",
      AUTH_CODE_DELIVERY_PROVIDER: "log_only", OPENAI_API_KEY: "local-mocked-provider",
    });
    const imported = await import("./index.js");
    const db = imported.createDefaultDatabase();
    const now = new Date().toISOString();
    imported.ensureDemoEnterpriseData(db, now);
    const sourceOrg = db.orgs.find((org) => org.activeIndustries.includes("people_management"))!;
    const sourceUser = db.users.find((user) => user.orgId === sourceOrg.id && !user.isSuperUser)!;
    assert.ok(sourceOrg && sourceUser);
    const org = { ...sourceOrg, id: "org_industry_legacy", activeIndustries: ["people_management"], divisionsEnabled: false };
    const user = { ...sourceUser, id: "user_industry_legacy", orgId: org.id, orgRole: "user" as const,
      firstName: "Legacy", lastName: "Learner",
      status: "active" as const, emailVerifiedAt: now, mobileProfileReonboardingRequired: false };
    const otherUser = { ...user, id: "user_industry_other", email: "other@industry.integration.test" };
    db.orgs = [org]; db.users = [user, otherUser]; db.orgTrainings = [];
    const segment = db.config.segments.find((role) => role.id === "solution_manager")!;
    const scenario = segment.scenarios.find((row) => row.enabled)!;
    const original = db.config.industries.find((row) => row.id === "people_management")!;
    const alternate = db.config.industries.find((row) => row.id === "sales")!;
    assert.ok(segment && scenario && original && alternate);
    db.config.industries = [original, alternate];
    db.config.roleIndustries = [{ roleId: segment.id, industryId: original.id, active: true }];
    const token = `legacy_${randomUUID()}`;
    db.mobileAuthTokens = [{ userId: user.id,
      tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update(token).digest("hex"), createdAt: now, updatedAt: now }];
    const storage = createDatabaseStorage({ provider: "postgres", databaseUrl: url, dbPath: "unused", pgPoolMax: 3,
      pgConnectTimeoutMs: 2000, pgIdleTimeoutMs: 1000, queryPool: pool,
      ensureDatabaseShape: imported.ensureDatabaseShape, createDefaultDatabase: imported.createDefaultDatabase });
    await storage.save(db);
    server = await new Promise<Server>((resolve) => { const started = imported.app.listen(0, () => resolve(started)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
    assert.equal(login.status, 200);
    const master = (await login.json() as { token: string }).token;
    const call = async (path: string, body?: Record<string, unknown>, admin = false, method = body ? "POST" : "GET") => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${admin ? master : token}`,
        "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const persisted = async () => (await pool!.query("SELECT state_json FROM app_state WHERE id='primary'")).rows[0].state_json;
    await t.test("legacy config and updates remain identical through industry changes without assignment grants", async () => {
      const before = structuredClone(await storage.load());
      const seeded = structuredClone(before);
      const topicId = "legacy_config_topic";
      const customId = "legacy_config_scenario";
      const legacyOrg = seeded.orgs.find((row) => row.id === org.id)!;
      legacyOrg.customScenarios = [...(legacyOrg.customScenarios ?? []), {
        id: customId, orgId: org.id, segmentId: segment.id, title: "Legacy practice",
        description: "Legacy learner content", desiredOutcome: "Agree a plan", aiRole: "Counterpart",
        scoringGuidance: "Observe clarity", applicableIndustryIds: [original.id], enabled: true,
        provenance: { sourceMode: "scratch", creationMethod: "manual" }, createdBy: "platform_admin",
        createdAt: now, updatedAt: now,
      }];
      seeded.orgTrainings.push({ id: topicId, orgId: org.id, name: "Legacy Topic", description: "",
        status: "active", createdAt: now, updatedAt: now });
      seeded.orgTrainingScenarioAttachments.push({ id: "legacy_config_attachment", orgId: org.id,
        trainingId: topicId, scenarioId: customId, createdAt: now, updatedAt: now });
      const parity = async () => {
        const config = await call(`/mobile/users/${user.id}/config`);
        const update = await call(`/mobile/users/${user.id}/updates?cursor=999999&timeoutMs=1000`);
        assert.equal(config.status, 200);
        assert.equal(update.status, 200);
        assert.equal(update.body.changed, true);
        assert.deepEqual(update.body.config, config.body);
        return config.body;
      };
      try {
        await storage.save(seeded);
        const visible = await parity();
        assert.ok((visible.orgTrainings as Array<{ id: string }>).some((row) => row.id === topicId));
        assert.ok((visible.orgCustomScenarios as Array<{ id: string }>).some((row) => row.id === customId));
        const inactive = structuredClone(seeded);
        inactive.config.industries.forEach((row) => { row.enabled = false; });
        await storage.save(inactive);
        assert.deepEqual((await parity()).industries, []);
        const empty = structuredClone(seeded);
        empty.orgs.find((row) => row.id === org.id)!.activeIndustries = [];
        await storage.save(empty);
        assert.deepEqual((await parity()).orgCustomScenarios, []);
      } finally {
        await storage.save(before);
        // Fixture writes bypass the API; refresh its app-state view before the
        // next legacy mutation, which intentionally uses the existing cache.
        assert.equal((await call(`/mobile/users/${user.id}/config`)).status, 200);
      }
      assert.equal(process.env.FOCUS_TOPIC_AUTHORITY, "legacy");
    });
    // Complete lazy session-store initialization before unregistered provider
    // requests can schedule best-effort session touches in the background.
    assert.equal((await call(`/mobile/users/${user.id}/simulation-sessions/start`, {
      simulationSessionId: `separate_registered_session_${randomUUID()}`,
      segmentId: segment.id, scenarioId: scenario.id,
    })).status, 201);

    await t.test("empty global save and final-industry deletion reject before any definitions, mappings or selections change", async () => {
      const before = await persisted();
      const empty = await call("/config", { industries: [], roleIndustries: [] }, true, "PATCH");
      assert.equal(empty.status, 400);
      assert.deepEqual(await persisted(), before);
      // The Content tab deletes an industry by saving the filtered whole list.
      assert.equal((await call("/config", { industries: [original] }, true, "PATCH")).status, 200);
      const one = await persisted();
      assert.equal((await call("/config", { industries: one.config.industries.filter((row: { id: string }) => row.id !== original.id) }, true, "PATCH")).status, 400);
      assert.deepEqual(await persisted(), one);
      assert.equal((await call("/config", { industries: [{ ...original, enabled: false }] }, true, "PATCH")).status, 200);
      const disabled = await persisted();
      assert.equal(disabled.config.industries[0].enabled, false);
      assert.deepEqual(disabled.config.roleIndustries, one.config.roleIndustries);
      assert.deepEqual(disabled.orgs.map((row: typeof org) => row.activeIndustries), one.orgs.map((row: typeof org) => row.activeIndustries));
      assert.equal((await call("/config", { industries: [] }, true, "PATCH")).status, 400);
      assert.deepEqual(await persisted(), disabled);
      // A subsequent save/reload must retain those relationships, not reconstruct them.
      assert.equal((await call("/config", { industries: [original, alternate] }, true, "PATCH")).status, 200);
      const restored = await persisted();
      assert.deepEqual(restored.config.roleIndustries, one.config.roleIndustries);
      assert.deepEqual(restored.orgs.map((row: typeof org) => row.activeIndustries), one.orgs.map((row: typeof org) => row.activeIndustries));
    });

    await t.test("referenced active and inactive organization industries cannot be deleted; unreferenced deletion and enable toggles preserve relationships", async () => {
      const inactive = await call("/orgs", { name: "Inactive industry reference", activeIndustries: [alternate.id] }, true);
      assert.equal(inactive.status, 201, JSON.stringify(inactive.body));
      assert.equal((await call(`/orgs/${inactive.body.id}`, { status: "disabled" }, true, "PATCH")).status, 200);
      for (const industryId of [original.id, alternate.id]) {
        const before = await persisted();
        const rejected = await call("/config", {
          industries: before.config.industries.filter((row: { id: string }) => row.id !== industryId),
        }, true, "PATCH");
        assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
        assert.deepEqual(await persisted(), before, "rejected deletion leaves definitions, role mappings and org selections unchanged");
      }
      const selected = await persisted();
      assert.equal(selected.orgs.find((row: { id: string }) => row.id === org.id).status, "active");
      assert.equal(selected.orgs.find((row: { id: string }) => row.id === inactive.body.id).status, "disabled");
      assert.deepEqual(selected.orgs.filter((row: { activeIndustries: string[] }) => row.activeIndustries.includes(alternate.id))
        .map((row: { id: string }) => row.id), [inactive.body.id]);
      for (const enabled of [false, true]) {
        assert.equal((await call("/config", { industries: [
          { ...original, enabled }, alternate,
        ] }, true, "PATCH")).status, 200);
        const state = await persisted();
        assert.equal(state.config.industries.find((row: { id: string }) => row.id === original.id).enabled, enabled);
        assert.deepEqual(state.config.roleIndustries, selected.config.roleIndustries);
        assert.deepEqual(state.orgs, selected.orgs);
      }
      const unused = { ...alternate, id: "unreferenced_industry", label: "Unreferenced industry" };
      assert.equal((await call("/config", { industries: [original, alternate, unused] }, true, "PATCH")).status, 200);
      const beforeDelete = await persisted();
      assert.equal((await call("/config", { industries: [original, alternate] }, true, "PATCH")).status, 200);
      const afterDelete = await persisted();
      assert.equal(afterDelete.config.industries.some((row: { id: string }) => row.id === unused.id), false);
      assert.deepEqual(afterDelete.orgs, beforeDelete.orgs);
      assert.deepEqual(afterDelete.config.roleIndustries, beforeDelete.config.roleIndustries);
    });

    await t.test("legacy cache hits and misses have identical live industry context after deactivation, reactivation and scenario revocation", async () => {
      await assertIndustryCacheParity({ mode: "legacy", storage,
        patch: (path, body) => call(path, body, true, "PATCH"),
        pool: pool!, call, userId: user.id, otherUserId: otherUser.id, orgId: org.id, segmentId: segment.id, scenarioId: scenario.id,
        industryId: original.id, alternateIndustryId: alternate.id });
    });

    await t.test("legacy active configuration works and deactivation rejects unregistered stale turn and score without provider calls", async () => {
      const config = await call(`/mobile/users/${user.id}/config`);
      assert.equal(config.status, 200);
      assert.equal(((config.body.config ?? config.body) as { industries: Array<{ id: string }> }).industries.some((row) => row.id === original.id), true);
      let providerCalls = 0;
      const savedFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (target.startsWith("https://api.openai.com/")) {
          providerCalls += 1;
          const evaluation = String(init?.body).includes("expert communication coach");
          const output = evaluation ? JSON.stringify({ communicationScore: 80, outcomeScore: 75, overallScore: 78,
            completionLevel: "complete", objectiveAchieved: true, persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8,
            strengths: ["Clear framing"], improvements: ["Tighter close"], summary: "Handled the conversation well." })
            : "Let us discuss the account.";
          return Promise.resolve(new Response(JSON.stringify({ output_text: output, model: "local-test-model",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return savedFetch(input, init);
      }) as typeof fetch;
      try {
        const stale = { scenarioId: scenario.id, industryId: original.id, difficulty: "medium", personaStyle: "skeptical",
          simulationSessionId: `unregistered_${randomUUID()}`, history: [{ role: "user", content: "Please discuss the account." }] };
        const scoreInput = { ...stale, startedAt: now, endedAt: new Date(Date.now() + 2000).toISOString(), history: [
          { role: "assistant", content: "What concerns you?" }, { role: "user", content: "I want to understand the concern." },
          { role: "assistant", content: "We need a plan." }, { role: "user", content: "Let us set owners and a review date." },
          { role: "assistant", content: "What next?" }, { role: "user", content: "We will follow up tomorrow." },
        ] };
        const activeTurn = await call(`/mobile/users/${user.id}/ai/turn`, stale);
        assert.equal(activeTurn.status, 200, JSON.stringify(activeTurn.body));
        const ownedSessionId = `owned_${randomUUID()}`;
        const registered = await call(`/mobile/users/${user.id}/simulation-sessions/start`, {
          simulationSessionId: ownedSessionId, segmentId: segment.id, scenarioId: scenario.id,
        });
        assert.equal(registered.status, 201, JSON.stringify(registered.body));
        const activeScore = await call(`/mobile/users/${user.id}/ai/score`, { ...scoreInput, simulationSessionId: ownedSessionId });
        assert.equal(activeScore.status, 201, JSON.stringify(activeScore.body));
        assert.equal((await pool!.query("SELECT 1 FROM simulation_sessions WHERE simulation_session_id=$1",
          [stale.simulationSessionId])).rowCount, 0);
        assert.equal(providerCalls, 2);
        assert.equal((await call(`/orgs/${org.id}`, { activeIndustries: [alternate.id] }, true, "PATCH")).status, 200);
        const turn = await call(`/mobile/users/${user.id}/ai/turn`, stale);
        assert.equal(turn.status, 400, JSON.stringify(turn.body));
        const score = await call(`/mobile/users/${user.id}/ai/score`, { ...scoreInput, simulationSessionId: stale.simulationSessionId });
        assert.equal(score.status, 404, JSON.stringify(score.body));
        assert.equal(providerCalls, 2);
      } finally { globalThis.fetch = savedFetch; }
      assert.equal(process.env.FOCUS_TOPIC_AUTHORITY, "legacy");
    });
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool?.end();
    try {
      // Provider routes persist usage after sending the response. Wait for this
      // harness's tagged connections to become idle before destructive teardown;
      // otherwise DROP can deadlock with employee-claim/app-state writes.
      const deadline = Date.now() + 10_000;
      let idleSamples = 0;
      while (idleSamples < 3) {
        const active = await setup.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state <> 'idle'", [schema]);
        idleSamples = active.rowCount === 0 ? idleSamples + 1 : 0;
        assert.ok(Date.now() < deadline, "local integration database writes did not settle before teardown");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await setup.end(); }
  }
});
