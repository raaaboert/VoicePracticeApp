import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { splitTextForRemoteTtsFastStart } from "@voicepractice/shared";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createDatabaseStorage } from "./storage.js";
import { createFocusTopicAuthorityStore } from "./storage/focusTopicAuthorityStore.js";
import { createAiUsageEventStore } from "./storage/aiUsageEventStore.js";
import { createTrainingContentStore } from "./storage/trainingContentStore.js";

const databaseUrl = process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
test("PostgreSQL HTTP authorized simulation continuity preserves speech, scoring and accounting beyond technical thresholds", { skip: !databaseUrl }, async (t) => {
  const db = await createLocalAuthDatabase(databaseUrl!);
  const originalFetch = globalThis.fetch;
  let server: Server | undefined;
  try {
    Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: db.url,
      PG_IDLE_TIMEOUT_MS: "100", FOCUS_TOPIC_AUTHORITY: "assignments", AI_SPEND_LEDGER_MODE: "off",
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
    const usage = createAiUsageEventStore({ provider: "postgres", databaseUrl: db.url, dbPath: "unused", pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100 }); await usage.initialize();
    server = await new Promise<Server>((resolve) => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const text = "Let us clarify the concern and agree the next step. ".repeat(14).trim();
    const score = { communicationScore: 80, outcomeScore: 75, overallScore: 78, completionLevel: "complete", objectiveAchieved: true,
      persuasion: 8, clarity: 7, empathy: 9, assertiveness: 8, strengths: ["Clear"], improvements: ["Close"], summary: "Agreed a plan." };
    let providerCalls = 0, scoring = false, failProvider = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.openai.com/")) return originalFetch(input, init);
      providerCalls++;
      if (failProvider) return new Response(JSON.stringify({ error: { message: "private-provider-error" } }), { status: 500 });
      if (url.endsWith("/audio/speech")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
      if (url.endsWith("/audio/transcriptions")) return Response.json({ text: "I will identify the concern and agree a clear next step." });
      const content = scoring ? JSON.stringify(score) : text;
      if (url.endsWith("/responses")) return Response.json({ output_text: content, model: "mocked-local", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
      if (url.endsWith("/chat/completions")) return Response.json({ choices: [{ message: { content } }], model: "mocked-local", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      throw new Error("Unexpected mocked provider route");
    };
    const headers = (actor = 0) => ({ Authorization: `Bearer ${tokens[actor]}`, "Content-Type": "application/json" });
    const call = (path: string, body?: unknown, actor = 0) => originalFetch(`${base}/mobile/users/${users[actor]!.id}/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: headers(actor), body: body === undefined ? undefined : JSON.stringify(body) });
    const requestContext = (id: string, actor = 0) => ({ simulationSessionId: id, scenarioId: scenario.id, segmentId: segment.id, trainingId: state.orgTrainings[actor]!.id, industryId: orgs[actor]!.activeIndustries[0] });
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
