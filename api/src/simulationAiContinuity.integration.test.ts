import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { splitTextForRemoteTtsFastStart } from "@voicepractice/shared";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createDatabaseStorage } from "./storage.js";
import { createFocusTopicAuthorityStore } from "./storage/focusTopicAuthorityStore.js";
import { createAiUsageEventStore } from "./storage/aiUsageEventStore.js";
import { createTrainingContentStore } from "./storage/trainingContentStore.js";
import { SimulationScoringCoordinator } from "./services/simulationScoringCoordinator.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
test("PostgreSQL HTTP authorized simulation continuity preserves speech, scoring and accounting beyond technical thresholds", { skip: !databaseUrl }, async (t) => {
  const db = await createLocalAuthDatabase(databaseUrl!);
  const originalFetch = globalThis.fetch;
  let server: Server | undefined;
  try {
    Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: db.url,
      PG_IDLE_TIMEOUT_MS: "100", PG_POOL_MAX: "5", FOCUS_TOPIC_AUTHORITY: "assignments", AI_SPEND_LEDGER_MODE: "off",
      MOBILE_TOKEN_SECRET: "continuity_local_mobile_secret_32_characters", WEB_AUTH_TOKEN_SECRET: "continuity_local_web_secret_32_characters",
      ADMIN_TOKEN_SECRET: "continuity_local_admin_secret_32_characters", ADMIN_BOOTSTRAP_PASSWORD: "continuity_local_password",
      SUPPORT_TRANSCRIPT_SECRET: "continuity_local_support_secret_32_characters", AUTH_CODE_DELIVERY_PROVIDER: "log_only",
      TRAINING_CONTENT_STORAGE_PROVIDER: "disabled", ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", ENABLE_REMOTE_TTS: "true",
      OPENAI_API_KEY: "local-only-mocked-key", OPENAI_MAX_DAILY_CALLS_GLOBAL: "3", OPENAI_MAX_DAILY_TOKENS_GLOBAL: "2000",
      OPENAI_MAX_DAILY_CALLS_PER_USER: "2", OPENAI_MAX_DAILY_TOKENS_PER_USER: "2000" });
    await db.migrate();
    const api = await import("./index.js");
    const state = api.createDefaultDatabase(), now = new Date().toISOString(); api.ensureDemoEnterpriseData(state, now);
    const sourceOrg = state.orgs.find((o) => o.status === "active" && o.activeIndustries.includes("people_management"))!;
    assert.ok(sourceOrg);
    const sourceUser = state.users.find((u) => u.orgId === sourceOrg.id && !u.isSuperUser)!; assert.ok(sourceUser);
    const orgs = ["a", "b"].map((suffix) => ({ ...sourceOrg, id: `continuity_org_${suffix}`, joinCode: `CONTINUITY${suffix.toUpperCase()}`,
      status: "active" as const, perUserDailySecondsCap: 3600, monthlyMinutesAllotted: 10000 }));
    const users = orgs.map((org, i) => ({ ...sourceUser, id: `continuity_learner_${i}`, orgId: org.id, orgRole: "user" as const,
      status: "active" as const, emailVerifiedAt: now, email: `continuity-${i}@example.test`, firstName: "Local", lastName: "Learner",
      mobileProfileReonboardingRequired: false, manualBonusSeconds: 0 }));
    const tokens = ["continuity-local-a", "continuity-local-b"];
    for (let i = 2; i < 9; i++) {
      users.push({ ...users[0]!, id: `continuity_learner_${i}`, email: `continuity-${i}@example.test`, employeeId: `CONTINUITY-${i}` });
      tokens.push(`continuity-local-${i}`);
    }
    state.orgs = orgs; state.users = users;
    state.mobileAuthTokens = users.map((u, i) => ({ userId: u.id, tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update(tokens[i]!).digest("hex"), createdAt: now, updatedAt: now }));
    const segment = state.config.segments.find((s) => s.id === "solution_manager")!;
    const scenario = segment.scenarios.find((s) => s.enabled !== false)!;
    state.orgTrainings = orgs.map((org, i) => ({ id: `continuity_topic_${i}`, orgId: org.id, name: "Continuity Topic", status: "active", description: "", createdAt: now, updatedAt: now }));
    const storage = createDatabaseStorage({ provider: "postgres", databaseUrl: db.url, dbPath: "unused", pgPoolMax: 1,
      pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, queryPool: db.pool, ensureDatabaseShape: api.ensureDatabaseShape, createDefaultDatabase: api.createDefaultDatabase });
    await storage.save(state);
    await createTrainingContentStore({ provider: "postgres", databaseUrl: db.url, pgPoolMax: 1,
      pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, queryPool: db.pool }).initialize();
    const authority = createFocusTopicAuthorityStore({ provider: "postgres", databaseUrl: db.url, pgPoolMax: 1,
      pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, queryPool: db.pool }); await authority.initialize();
    for (const [i, org] of orgs.entries()) {
      await authority.createAssignment({ id: `continuity_assignment_${i}`, orgId: org.id, topicId: state.orgTrainings[i]!.id,
        audience: "individual", subjectUserId: users[i]!.id, grantsManagement: false, createdBy: "platform_admin", createdAt: now, revokedAt: null, revokedBy: null }, db.pool);
      await authority.attachScenario({ id: `continuity_attachment_${i}`, orgId: org.id, topicId: state.orgTrainings[i]!.id,
        scenarioKind: "standard", scenarioId: scenario.id, attachedBy: "platform_admin", attachedAt: now, detachedAt: null, detachedBy: null }, db.pool);
    }
    for (let i = 2; i < users.length; i++) await authority.createAssignment({ id: `continuity_assignment_${i}`, orgId: orgs[0]!.id,
      topicId: state.orgTrainings[0]!.id, audience: "individual", subjectUserId: users[i]!.id, grantsManagement: false,
      createdBy: "platform_admin", createdAt: now, revokedAt: null, revokedBy: null }, db.pool);
    const usage = createAiUsageEventStore({ provider: "postgres", databaseUrl: db.url, dbPath: "unused", pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100 }); await usage.initialize();
    server = await new Promise<Server>((resolve) => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const text = "Let us clarify the concern and agree the next step. ".repeat(14).trim();
    const score = { communicationScore: 80, outcomeScore: 75, overallScore: 78, completionLevel: "complete", objectiveAchieved: true,
      persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8, strengths: ["Clear"], improvements: ["Close"], summary: "Agreed a plan." };
    let providerCalls = 0, scoring = false, failProvider = false;
    let speechCalls = 0, speechGate: Promise<void> | null = null, speechEntered = () => {}, failSpeech = false;
    let scoreGate: Promise<void> | null = null, scoreEntered = () => {};
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.openai.com/")) return originalFetch(input, init);
      providerCalls++;
      if (failProvider) return new Response(JSON.stringify({ error: { message: "private-provider-error" } }), { status: 500 });
      if (url.endsWith("/audio/speech")) {
        speechCalls++; speechEntered(); await speechGate;
        return failSpeech ? Response.json({ error: { message: "mock speech failed" } }, { status: 500 })
          : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
      }
      if (url.endsWith("/audio/transcriptions")) return Response.json({ text: "I will identify the concern and agree a clear next step." });
      if (scoring) { scoreEntered(); await scoreGate; }
      const content = scoring ? JSON.stringify(score) : text;
      if (url.endsWith("/responses")) return Response.json({ output_text: content, model: "mocked-local", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
      if (url.endsWith("/chat/completions")) return Response.json({ choices: [{ message: { content } }], model: "mocked-local", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      throw new Error("Unexpected mocked provider route");
    };
    const headers = (actor = 0) => ({ Authorization: `Bearer ${tokens[actor]}`, "Content-Type": "application/json" });
    const call = (path: string, body?: unknown, actor = 0) => originalFetch(`${base}/mobile/users/${users[actor]!.id}/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: headers(actor), body: body === undefined ? undefined : JSON.stringify(body) });
    const requestContext = (id: string, actor = 0) => ({ simulationSessionId: id, scenarioId: scenario.id, segmentId: segment.id,
      trainingId: state.orgTrainings[actor === 1 ? 1 : 0]!.id, industryId: orgs[actor === 1 ? 1 : 0]!.activeIndustries[0] });
    const start = async (id: string, actor = 0) => {
      const result = await call("simulation-sessions/start", requestContext(id, actor), actor); assert.equal(result.status, 201, await result.clone().text());
      return await result.json() as { serverStartedAt: string };
    };
    const exhaust = async (kind: "calls" | "tokens") => {
      await db.pool.query("DELETE FROM ai_usage_events");
      for (let i = 0; i < (kind === "calls" ? 3 : 1); i++) await usage.appendEvent({ id: `threshold_${kind}_${i}`, userId: users[0]!.id,
        orgId: orgs[0]!.id, divisionId: null, segmentId: null, scenarioId: null, kind: "turn", model: "mocked-local", promptVersion: "test",
        rubricVersion: null, inputTokens: 0, outputTokens: 0, totalTokens: kind === "tokens" ? 2000 : 0, createdAt: new Date().toISOString() });
    };
    const speech = (id: string, authorization: unknown, speechText = text, actor = 0) => call("ai/tts", { simulationSessionId: id, speechAuthorization: authorization, text: speechText, preset: "female-balanced" }, actor);
    const history = [{ role: "user", content: "Identify the concern." }, { role: "assistant", content: "What next?" },
      { role: "user", content: "Agree an owner." }, { role: "assistant", content: "And then?" }, { role: "user", content: "Review progress tomorrow." }];
    let latestAuthorization: string, latestId: string;
    for (const threshold of ["calls", "tokens"] as const) await t.test(`${threshold} threshold: opening, transcription, turn, prefetch, speech chunks/retry and first score continue with measured usage`, async () => {
      api.clearRateLimitsForTest(); const id = `continuity_${threshold}`; const started = await start(id); await exhaust(threshold);
      const before = providerCalls;
      const opening = await call("ai/opening", { ...requestContext(id), speechPrefetch: { preset: "female-balanced" } });
      assert.equal(opening.status, 200, await opening.clone().text()); const opened = await opening.json() as any;
      assert.equal(typeof opened.speechAuthorization, "string");
      const form = new FormData(); form.append("simulationSessionId", id); form.append("file", new Blob([new Uint8Array(8192)], { type: "audio/m4a" }), "voice.m4a");
      const transcription = await originalFetch(`${base}/mobile/users/${users[0]!.id}/ai/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${tokens[0]}` }, body: form });
      assert.equal(transcription.status, 200, await transcription.clone().text());
      const turn = await call("ai/turn", { ...requestContext(id), history }); assert.equal(turn.status, 200, await turn.clone().text());
      const reply = await turn.json() as any;
      for (const chunk of [...splitTextForRemoteTtsFastStart(text), text]) assert.equal((await speech(id, reply.speechAuthorization, chunk)).status, 200);
      assert.equal((await speech(id, reply.speechAuthorization)).status, 200, "legitimate voice retry");
      const blockedAt = providerCalls;
      assert.equal((await call("ai/tts", { text, preset: "female-balanced" })).status, 429, "legacy unbound speech stays restricted");
      assert.equal((await call("ai/opening", { scenarioId: scenario.id })).status, 429, "unregistered opening gets no exemption");
      assert.equal(providerCalls, blockedAt);
      const endedAt = new Date().toISOString();
      const completed = await originalFetch(`${base}/usage/sessions`, { method: "POST", headers: headers(), body: JSON.stringify({
        ...requestContext(id), userId: users[0]!.id, startedAt: started.serverStartedAt, endedAt,
        rawDurationSeconds: Math.floor((Date.parse(endedAt) - Date.parse(started.serverStartedAt)) / 1000),
      }) });
      assert.equal(completed.status, 201, await completed.clone().text());
      scoring = true;
      const scoreBody = { ...requestContext(id), history, startedAt: started.serverStartedAt, endedAt: new Date().toISOString() };
      const scored = await call("ai/score", scoreBody); assert.equal(scored.status, 201, await scored.clone().text());
      const afterScore = providerCalls; const repeated = await call("ai/score", scoreBody); assert.equal(repeated.status, 200);
      const recovered = await call(`ai/score?simulationSessionId=${id}`); assert.equal(recovered.status, 200); assert.equal(providerCalls, afterScore);
      assert.deepEqual(await repeated.json(), await recovered.json()); scoring = false;
      assert.equal((await speech(id, reply.speechAuthorization)).status, 409, "scored session cannot restart speech");
      const measured = await db.pool.query("SELECT count(*)::int AS count FROM ai_usage_events WHERE id NOT LIKE 'threshold_%'");
      assert.equal(measured.rows[0].count, afterScore - before, "one measured event per successful provider operation");
      assert.equal((await db.pool.query("SELECT to_regclass('ai_provider_attempts') AS name")).rows[0].name, null, "OFF requires no migration 025");
      latestAuthorization = opened.speechAuthorization; latestId = id;
    });
    await t.test("org A's exhausted threshold cannot interrupt org B; forged/cross-session speech and cross-user replay fail before provider work", async () => {
      await exhaust("calls"); const id = "continuity_other_org"; await start(id, 1);
      const opened = await call("ai/opening", requestContext(id, 1), 1); assert.equal(opened.status, 200, await opened.clone().text()); const payload = await opened.json() as any;
      assert.equal((await speech(id, payload.speechAuthorization, text, 1)).status, 200);
      const before = providerCalls;
      for (const [token, speechText] of [[payload.speechAuthorization + "forged", text], [payload.speechAuthorization, "Unrelated arbitrary text"], [latestAuthorization!, text], [undefined, text]]) {
        assert.equal((await speech(id, token, speechText, 1)).status, 403);
      }
      assert.equal((await speech(id, payload.speechAuthorization, text, 0)).status, 404);
      const anonymous = await originalFetch(`${base}/mobile/users/${users[1]!.id}/ai/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, preset: "female-balanced", simulationSessionId: id, speechAuthorization: payload.speechAuthorization }) });
      assert.equal(anonymous.status, 401);
      assert.equal((await call("ai/turn", { ...requestContext(latestId!, 0), history }, 1)).status, 404);
      assert.equal(providerCalls, before);
      assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM ai_usage_events WHERE org_id=$1", [orgs[1]!.id])).rows[0].n, 2);
      failProvider = true;
      const failed = await call("ai/turn", { ...requestContext(id, 1), history }, 1); assert.equal(failed.status, 503);
      assert.equal((await failed.json() as any).code, "ai_unavailable"); failProvider = false;
    });
    await t.test("concurrent authorized operations account once each; expired and completed sessions cannot reuse speech authorization", async () => {
      await exhaust("tokens"); const id = "continuity_concurrent"; await start(id);
      const results = await Promise.all(Array.from({ length: 4 }, () => call("ai/turn", { ...requestContext(id), history })));
      for (const result of results) assert.equal(result.status, 200, await result.clone().text());
      const authorization = (await results[0]!.json() as any).speechAuthorization;
      assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM ai_usage_events WHERE id NOT LIKE 'threshold_%'")).rows[0].n, 4);
      await db.pool.query("UPDATE simulation_sessions SET server_started_at=now()-interval '2 days' WHERE simulation_session_id=$1", [id]);
      const before = providerCalls;
      for (const route of ["ai/opening", "ai/turn", "ai/score"]) {
        const expired = await call(route, { ...requestContext(id), history, startedAt: now, endedAt: now }); assert.equal(expired.status, 409);
      }
      assert.equal((await speech(id, authorization)).status, 409); assert.equal(providerCalls, before);
    });
    await t.test("nine authorized learners score concurrently with PG_POOL_MAX=5 even beyond technical thresholds", { timeout: 25000 }, async () => {
      api.clearRateLimitsForTest();
      const sessions: Array<{ id: string; actor: number; started: { serverStartedAt: string } }> = [];
      for (let actor = 0; actor < 9; actor++) {
        const id = `capacity_learner_${actor}`;
        sessions.push({ id, actor, started: await start(id, actor) });
      }
      await exhaust("calls");
      let release = () => {}, entered = 0, failed = 0;
      scoreGate = new Promise<void>((resolve) => { release = resolve; });
      scoreEntered = () => { if (++entered === 9) release(); };
      scoring = true;
      const before = providerCalls, startedAt = Date.now();
      try {
        const results = await Promise.all(sessions.map(async ({ id, actor, started }) => {
          const result = await call("ai/score", { ...requestContext(id, actor), history,
            startedAt: started.serverStartedAt, endedAt: new Date().toISOString() }, actor);
          // Allow the old five-slot implementation to finish and report its
          // actual failure, without a fragile ten-second provider sleep.
          if (result.status !== 201 && ++failed === 4) release();
          return result;
        }));
        const passed = results.filter((result) => result.status === 201).length;
        t.diagnostic(`Nine-learner capacity: ${passed}/9 scored, provider dispatches=${providerCalls - before}, elapsed=${Date.now() - startedAt} ms`);
        assert.equal(passed, 9, JSON.stringify(await Promise.all(results.map(async (result) => [result.status, await result.clone().text()]))));
        assert.equal(providerCalls - before, 9);
        const persisted = await db.pool.query("SELECT simulation_session_id,user_id FROM score_records WHERE simulation_session_id=ANY($1::text[])", [sessions.map((session) => session.id)]);
        assert.equal(persisted.rowCount, 9); assert.equal(new Set(persisted.rows.map((row) => row.user_id)).size, 9);
        for (const { id, actor, started } of sessions) assert.equal((await call("ai/score", {
          ...requestContext(id, actor), history, startedAt: started.serverStartedAt, endedAt: new Date().toISOString(),
        }, actor)).status, 200);
        assert.equal(providerCalls - before, 9, "recovery never dispatches another evaluation");
      } finally { release(); scoring = false; scoreGate = null; scoreEntered = () => {}; }
    });
    await t.test("optional coordinator distinguishes genuine busy ownership from quickly exhausted capacity and recovers", async () => {
      const options = { databaseUrl: db.url, pgPoolMax: 1, pgConnectTimeoutMs: 8000, pgIdleTimeoutMs: 100 };
      const a = new SimulationScoringCoordinator(options), b = new SimulationScoringCoordinator(options);
      const identity = { userId: users[0]!.id, orgId: orgs[0]!.id, sessionId: "pool-saturation-a" };
      const other = { ...identity, sessionId: "pool-saturation-b" };
      const held = await a.acquire(identity); assert.equal(held.status, "acquired");
      if (held.status !== "acquired") throw Error("Expected acquired lease");
      try {
        assert.equal((await a.acquire(identity)).status, "busy", "known local owner does not queue for a connection");
        assert.equal((await b.acquire(identity)).status, "busy", "PostgreSQL lock collision is not capacity exhaustion");
        const started = Date.now();
        const saturated = await a.acquire(other);
        t.diagnostic(`Optional coordinator saturation fallback: ${Date.now() - started} ms`);
        assert.equal(saturated.status, "unavailable");
        assert.ok(Date.now() - started < 2000, "optional capacity wait must not use the eight-second ordinary database timeout");
        const independent = await b.acquire(other); assert.equal(independent.status, "acquired", "different sessions have distinct lock identities");
        if (independent.status === "acquired") await independent.release();
        await held.release();
        const recovered = await a.acquire(other); assert.equal(recovered.status, "acquired");
        if (recovered.status === "acquired") await recovered.release();
      } finally { await held.release(); await a.close(); await b.close(); }
      assert.equal((await a.acquire(other)).status, "unavailable", "a failed optional resource does not throw or pretend another owner exists");
    });
    await t.test("essential database failure during optional scoring fallback dispatches no provider work", async () => {
      const id = "essential_database_failure"; const started = await start(id);
      const acquire = SimulationScoringCoordinator.prototype.acquire;
      let injected = false;
      SimulationScoringCoordinator.prototype.acquire = async () => {
        await db.pool.query("ALTER TABLE simulation_sessions RENAME TO temporarily_unavailable_sessions");
        injected = true;
        return { status: "unavailable" };
      };
      const body = { ...requestContext(id), history, startedAt: started.serverStartedAt, endedAt: new Date().toISOString() };
      const before = providerCalls;
      try {
        const failed = await call("ai/score", body);
        assert.equal(injected, true);
        assert.equal(failed.status, 503); assert.equal((await failed.json() as any).code, "ai_unavailable");
        assert.equal(providerCalls, before, "essential session authorization must remain available before provider dispatch");
        assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM score_records WHERE simulation_session_id=$1", [id])).rows[0].n, 0);
      } finally {
        if (injected) await db.pool.query("ALTER TABLE temporarily_unavailable_sessions RENAME TO simulation_sessions");
        SimulationScoringCoordinator.prototype.acquire = acquire;
      }
      scoring = true;
      try {
        assert.equal((await call("ai/score", body)).status, 201, "ordinary scoring recovers once essential persistence is available");
        assert.equal((await call("ai/score", body)).status, 200);
        assert.equal(providerCalls - before, 1);
      } finally { scoring = false; }
    });
    await t.test("optional ownership loss cannot discard a legitimate generated score when essential persistence remains available", async () => {
      const id = "optional_ownership_loss"; const started = await start(id);
      const acquire = SimulationScoringCoordinator.prototype.acquire;
      SimulationScoringCoordinator.prototype.acquire = async function(identity) {
        const result = await acquire.call(this, identity);
        if (result.status === "acquired") await result.release();
        return result;
      };
      const before = providerCalls; scoring = true;
      try {
        const body = { ...requestContext(id), history, startedAt: started.serverStartedAt, endedAt: new Date().toISOString() };
        assert.equal((await call("ai/score", body)).status, 201);
        assert.equal((await call("ai/score", body)).status, 200);
        assert.equal(providerCalls - before, 1);
      } finally { scoring = false; SimulationScoringCoordinator.prototype.acquire = acquire; }
    });
    await t.test("legacy unbound speech reuses a session-bound pending prefetch without gaining technical-budget exemption", { timeout: 15000 }, async () => {
      api.clearRateLimitsForTest(); await db.pool.query("DELETE FROM ai_usage_events");
      const id = "legacy_bound_prefetch"; await start(id);
      const before = speechCalls;
      let release = () => {}, entered = () => {};
      speechGate = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { speechEntered = resolve; });
      const consumed = new Promise<void>((resolve) => { entered = resolve; });
      const registry = api.simulationSpeechPrefetchRegistry, consume = registry.consume.bind(registry);
      const chunk = splitTextForRemoteTtsFastStart(text)[0]!;
      const legacy = (actor = 0) => originalFetch(`${base}/mobile/users/${users[actor]!.id}/ai/tts`, { method: "POST",
        headers: { ...headers(actor), "X-Correlation-Id": "legacy-bound-response" }, body: JSON.stringify({ text: chunk, preset: "female-balanced" }) });
      try {
        const opening = originalFetch(`${base}/mobile/users/${users[0]!.id}/ai/opening`, { method: "POST",
          headers: { ...headers(), "X-Correlation-Id": "legacy-bound-response" }, body: JSON.stringify({ ...requestContext(id), speechPrefetch: { preset: "female-balanced" } }) });
        await started;
        registry.consume = (params) => { const pending = consume(params); entered(); return pending; };
        const foreground = legacy(); await consumed; release();
        const result = await foreground; assert.equal(result.status, 200, await result.clone().text());
        assert.equal((await opening).status, 200);
        t.diagnostic(`Legacy TTS provider dispatches=${speechCalls - before}`);
        assert.equal(result.headers.get("X-TTS-Audio-Source"), "in_flight_prefetch");
        assert.equal(speechCalls - before, 1);
        await exhaust("calls");
        const capped = await legacy(); assert.equal(capped.status, 429, "cached legacy audio does not bypass budget policy");
        assert.equal(speechCalls - before, 1);
        await db.pool.query("DELETE FROM ai_usage_events");
        for (const actor of [1, 2]) {
          const unrelated = await legacy(actor); assert.equal(unrelated.status, 200);
          assert.equal(unrelated.headers.get("X-TTS-Audio-Source"), "foreground_generation", "another tenant or same-org account never reuses the audio");
        }
        assert.equal(speechCalls - before, 3);
        assert.equal((await legacy()).headers.get("X-TTS-Audio-Source"), "in_flight_prefetch");
        assert.equal(speechCalls - before, 3);
      } finally { release(); speechGate = null; speechEntered = () => {}; registry.consume = consume; }
    });
    await t.test("HTTP speech joins prefetch and overlapping foreground work; timeout, cancellation and retry never fork pending synthesis", { timeout: 15000 }, async () => {
      api.clearRateLimitsForTest();
      const id = "speech_overlap"; await start(id);
      const opening = await call("ai/opening", requestContext(id)); assert.equal(opening.status, 200);
      const grant = (await opening.json() as any).speechAuthorization;
      const chunk = splitTextForRemoteTtsFastStart(text)[0]!;
      const registry = api.simulationSpeechPrefetchRegistry;
      const consume = registry.consume.bind(registry);
      let release = () => {};
      const block = () => {
        speechGate = new Promise<void>((resolve) => { release = resolve; });
        return new Promise<void>((resolve) => { speechEntered = resolve; });
      };
      const fetchSpeech = (correlation: string, signal?: AbortSignal) => originalFetch(`${base}/mobile/users/${users[0]!.id}/ai/tts`, {
        method: "POST", signal, headers: { ...headers(), "X-Correlation-Id": correlation },
        body: JSON.stringify({ simulationSessionId: id, speechAuthorization: grant, text: chunk, preset: "female-balanced" }),
      });
      const before = speechCalls;
      const measuredBefore = Number((await db.pool.query("SELECT count(*) AS n FROM ai_usage_events WHERE kind='tts'")).rows[0].n);
      try {
        const prefetchStarted = block();
        const prefetched = originalFetch(`${base}/mobile/users/${users[0]!.id}/ai/opening`, { method: "POST",
          headers: { ...headers(), "X-Correlation-Id": "overlap-prefetch" }, body: JSON.stringify({ ...requestContext(id), speechPrefetch: { preset: "female-balanced" } }) });
        await prefetchStarted;
        let consumed = 0, joined!: () => void;
        const bothJoined = new Promise<void>((resolve) => { joined = resolve; });
        registry.consume = (params) => { const pending = consume(params); if (++consumed === 2) joined(); return pending; };
        const joinedAt = Date.now();
        const a = fetchSpeech("overlap-prefetch"), b = fetchSpeech("overlap-prefetch");
        await bothJoined; assert.equal(speechCalls - before, 1); release();
        assert.equal((await a).status, 200); assert.equal((await b).status, 200); assert.equal((await prefetched).status, 200);
        assert.equal((await fetchSpeech("overlap-prefetch")).status, 200); assert.equal(speechCalls - before, 1);
        t.diagnostic(`TTS: two overlapping HTTP waiters plus replay, one synthesis, ${Date.now() - joinedAt} ms local completion after releasing mocked provider`);

        const coldStarted = block(); consumed = 0;
        const coldJoined = new Promise<void>((resolve) => { joined = resolve; });
        const abort = new AbortController();
        const abandoned = fetchSpeech("cold-response", abort.signal).catch(() => null);
        await coldStarted;
        const survivor = fetchSpeech("cold-response");
        // Both HTTP waiters have entered registry reuse before cancellation.
        await coldJoined;
        abort.abort(); release(); await abandoned;
        assert.equal((await survivor).status, 200); assert.equal(speechCalls - before, 2);

        const slowStarted = block();
        const slowPrefetch = originalFetch(`${base}/mobile/users/${users[0]!.id}/ai/opening`, { method: "POST",
          headers: { ...headers(), "X-Correlation-Id": "slow-prefetch" }, body: JSON.stringify({ ...requestContext(id), speechPrefetch: { preset: "female-balanced" } }) });
        await slowStarted;
        registry.consume = (params) => consume({ ...params, waitMs: 1 });
        const timed = await fetchSpeech("slow-prefetch"); assert.equal(timed.status, 504);
        assert.equal((await timed.json() as any).code, "ai_timeout"); assert.equal(speechCalls - before, 3);
        release(); await slowPrefetch; registry.consume = consume;
        assert.equal((await fetchSpeech("slow-prefetch")).status, 200); assert.equal(speechCalls - before, 3);

        speechGate = null; failSpeech = true;
        assert.equal((await fetchSpeech("failed-response")).status, 503); assert.equal(speechCalls - before, 4);
        failSpeech = false;
        assert.equal((await fetchSpeech("failed-response")).status, 200); assert.equal(speechCalls - before, 5);
        assert.equal(Number((await db.pool.query("SELECT count(*) AS n FROM ai_usage_events WHERE kind='tts'")).rows[0].n) - measuredBefore, 4,
          "four successful syntheses are measured once each; the failed reservation retains existing OFF-mode behavior");
        assert.equal((await fetchSpeech("failed-response")).status, 200); assert.equal(speechCalls - before, 5);
      } finally { release(); speechGate = null; failSpeech = false; registry.consume = consume; }
    });
    await t.test("independent API processes dispatch one concurrent first score, recover failures and release ownership on process exit", { timeout: 30000 }, async () => {
      let calls = 0, fail = false, timeout = false;
      let release = () => {}, entered = () => {};
      let gate: Promise<void> = Promise.resolve();
      const blockProvider = () => {
        gate = new Promise<void>((resolve) => { release = resolve; });
        return new Promise<void>((resolve) => { entered = resolve; });
      };
      const provider = createServer(async (request, response) => {
        for await (const _ of request) { /* consume mocked request without logging text */ }
        calls++; entered(); await gate;
        response.writeHead(fail ? 500 : 200, { "Content-Type": "application/json", "X-Local-Test-Timeout": timeout ? "1" : "0" });
        response.end(JSON.stringify(fail ? { error: { message: "mock failure" } } : {
          output_text: JSON.stringify(score), model: "mocked-local", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }));
      });
      await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
      const children: ChildProcess[] = [];
      const launch = () => new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./simulationScoringProcess.testSupport.ts", import.meta.url))], {
          env: { ...process.env, LOCAL_SCORING_PROVIDER_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/provider` },
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        children.push(child);
        let diagnostics = ""; child.stderr?.on("data", (chunk) => { diagnostics += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => { if (code) reject(Error(`Local API test process exited: ${diagnostics}`)); });
        child.once("message", (message: any) => resolve(`http://127.0.0.1:${message.port}`));
      });
      try {
        const [a, b] = await Promise.all([launch(), launch()]);
        const evaluate = (host: string, id: string) => originalFetch(`${host}/mobile/users/${users[0]!.id}/ai/score`, {
          method: "POST", headers: headers(), body: JSON.stringify({ ...requestContext(id), history, startedAt: now, endedAt: new Date().toISOString() }),
        });
        await start("scoring_process_race");
        const pendingProvider = blockProvider();
        const first = evaluate(a!, "scoring_process_race"); await pendingProvider;
        const busyStartedAt = Date.now();
        const busy = await evaluate(b!, "scoring_process_race"); assert.equal(busy.status, 503);
        t.diagnostic(`Scoring: cross-process duplicate rejected in ${Date.now() - busyStartedAt} ms, provider dispatches=${calls}`);
        assert.equal((await busy.json() as any).code, "ai_unavailable"); assert.equal(calls, 1);
        const connections = await db.pool.query("SELECT state,xact_start FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%pg_try_advisory_lock%peritio-score-v1%'");
        assert.ok(connections.rows.some((row) => row.state === "idle" && row.xact_start === null), "no transaction is held over the provider call");
        release(); assert.equal((await first).status, 201);
        assert.equal((await evaluate(b!, "scoring_process_race")).status, 200); assert.equal(calls, 1);
        assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM score_records WHERE simulation_session_id='scoring_process_race'")).rows[0].n, 1);
        await start("scoring_process_failure"); fail = true;
        assert.equal((await evaluate(a!, "scoring_process_failure")).status, 503);
        fail = false; assert.equal((await evaluate(b!, "scoring_process_failure")).status, 201); assert.equal(calls, 3);
        await start("scoring_process_timeout"); timeout = true;
        const timed = await evaluate(a!, "scoring_process_timeout"); assert.equal(timed.status, 504);
        assert.equal((await timed.json() as any).code, "ai_timeout");
        timeout = false; assert.equal((await evaluate(b!, "scoring_process_timeout")).status, 201); assert.equal(calls, 5);
        await start("scoring_process_crash");
        const crashedProvider = blockProvider();
        const lost = evaluate(a!, "scoring_process_crash").catch(() => null); await crashedProvider;
        const exited = new Promise<void>((resolve) => children[0]!.once("exit", () => resolve()));
        children[0]!.kill(); await exited; release(); await lost;
        assert.equal((await evaluate(b!, "scoring_process_crash")).status, 201);
        assert.equal(calls, 7, "an uncertain provider result after process death may require another call");
        assert.equal((await evaluate(b!, "scoring_process_crash")).status, 200); assert.equal(calls, 7);
      } finally {
        release();
        await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve) => {
          child.once("exit", () => resolve()); child.kill();
        })));
        await new Promise<void>((resolve) => provider.close(() => resolve()));
      }
    });
    await t.test("registered usage finalizes after industry deactivation without duplicate billing", async () => {
      api.clearRateLimitsForTest();
      const id = "finalization_deactivated_industry";
      const started = await start(id);
      const login = await originalFetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
      assert.equal(login.status, 200);
      const adminToken = (await login.json() as any).token;
      const change = (activeIndustries: string[]) => originalFetch(`${base}/orgs/${orgs[0]!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ activeIndustries }) });
      try {
        const replacement = state.config.industries.find((industry) => industry.enabled && !orgs[0]!.activeIndustries.includes(industry.id))!;
        assert.ok(replacement);
        const changed = await change([replacement.id]); assert.equal(changed.status, 200, await changed.clone().text());
        const payload = { ...requestContext(id), userId: users[0]!.id, startedAt: started.serverStartedAt, endedAt: new Date().toISOString(), rawDurationSeconds: 0 };
        const finish = () => originalFetch(`${base}/usage/sessions`, { method: "POST", headers: headers(), body: JSON.stringify(payload) });
        const first = await finish(); assert.equal(first.status, 201, await first.clone().text());
        assert.equal((await finish()).status, 201);
        const rows = await db.pool.query("SELECT u.* FROM usage_sessions u JOIN simulation_sessions s ON s.usage_session_record_id=u.id WHERE s.simulation_session_id=$1", [id]);
        assert.equal(rows.rowCount, 1);
        assert.equal(rows.rows[0].user_id, users[0]!.id); assert.equal(rows.rows[0].org_id, orgs[0]!.id);
        assert.notEqual((await call("simulation-sessions/start", requestContext("not_newly_authorized"))).status, 201);
      } finally { await change(orgs[0]!.activeIndustries); }
    });
    await t.test("legacy speech format works below thresholds; customer minute exhaustion still blocks new admission", async () => {
      await db.pool.query("DELETE FROM ai_usage_events");
      assert.equal((await call("ai/tts", { text, preset: "female-balanced" })).status, 200);
      const login = await originalFetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
      assert.equal(login.status, 200);
      const adminToken = (await login.json() as any).token;
      const update = await originalFetch(`${base}/orgs/${orgs[0]!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ monthlyMinutesAllotted: 0 }) });
      assert.equal(update.status, 200, await update.clone().text());
      const denied = await call("simulation-sessions/start", requestContext("no_purchased_minutes"));
      assert.equal(denied.status, 403); await denied.arrayBuffer();
      // Drain the route's serialized post-response persistence before dropping the local schema.
      await (await call("config")).arrayBuffer();
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await db.close();
  }
});
