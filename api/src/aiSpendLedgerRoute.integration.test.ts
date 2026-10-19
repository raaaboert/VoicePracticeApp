import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createAiUsageEventStore } from "./storage/aiUsageEventStore.js";
import { createDatabaseStorage } from "./storage.js";

const url = process.env.AI_SPEND_INTEGRATION_DATABASE_URL?.trim()
  || process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();

test("PostgreSQL record-mode HTTP TTS preserves auth, successful audio and existing global budget errors", { skip: !url }, async (t) => {
  const db = await createLocalAuthDatabase(url!);
  let server: Server | undefined;
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: db.url,
      FOCUS_TOPIC_AUTHORITY: "legacy", PG_IDLE_TIMEOUT_MS: "100", AUTH_CODE_DELIVERY_PROVIDER: "log_only",
      MOBILE_TOKEN_SECRET: "ai_ledger_http_mobile_token_secret_32_characters", WEB_AUTH_TOKEN_SECRET: "ai_ledger_http_web_token_secret_32_characters",
      ADMIN_TOKEN_SECRET: "ai_ledger_http_admin_token_secret_32_characters", ADMIN_BOOTSTRAP_PASSWORD: "ai_ledger_http_local_password",
      SUPPORT_TRANSCRIPT_SECRET: "ai_ledger_http_support_secret_32_characters", TRAINING_CONTENT_STORAGE_PROVIDER: "disabled",
      ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", OPENAI_API_KEY: "local-mocked-provider-key", ENABLE_REMOTE_TTS: "true",
      AI_SPEND_LEDGER_MODE: "record", AI_SPEND_LEDGER_HMAC_SECRET: "ai_ledger_http_distinct_fingerprint_secret_32_characters",
      OPENAI_MAX_DAILY_CALLS_GLOBAL: "2", OPENAI_MAX_DAILY_CALLS_PER_USER: "1",
      OPENAI_MAX_DAILY_TOKENS_GLOBAL: "1000000", OPENAI_MAX_DAILY_TOKENS_PER_USER: "1000000" });
    await db.migrate();
    const api = await import("./index.js");
    await t.test("record mode refuses missing 025 before API startup/listen", async () => {
      await assert.rejects(api.startApiServer(), /ai_provider_attempts/);
    });
    const state = api.createDefaultDatabase(); const now = new Date().toISOString(); api.ensureDemoEnterpriseData(state, now);
    const sourceUser = state.users.find((u) => u.accountType === "enterprise" && !u.isSuperUser)!; assert.ok(sourceUser);
    const sourceOrg = state.orgs.find((o) => o.id === sourceUser.orgId)!; assert.ok(sourceOrg);
    const org = { ...sourceOrg, id: "org_ledger_http", joinCode: "LEDGERHTTP" };
    const user = { ...sourceUser, id: "ledger_http_user", email: "ledger-http@example.test", orgId: org.id };
    state.users = [user]; state.orgs = [org];
    user.status = "active"; user.emailVerifiedAt = now; user.manualBonusSeconds = 0;
    user.firstName = "Ledger"; user.lastName = "Tester"; user.mobileProfileReonboardingRequired = false;
    org.status = "active"; org.perUserDailySecondsCap = 36000; org.monthlyMinutesAllotted = 10000;
    const token = "local-ledger-http-token";
    state.mobileAuthTokens = [{ userId: user.id, tokenHash: createHmac("sha256", process.env.MOBILE_TOKEN_SECRET!).update(token).digest("hex"), createdAt: now, updatedAt: now }];
    const storage = createDatabaseStorage({ provider: "postgres", databaseUrl: db.url, dbPath: "unused",
      pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100, queryPool: db.pool,
      ensureDatabaseShape: api.ensureDatabaseShape, createDefaultDatabase: api.createDefaultDatabase });
    await storage.save(state);
    const usage = createAiUsageEventStore({ provider: "postgres", dbPath: "unused", databaseUrl: db.url,
      pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100 });
    await usage.initialize();
    await db.pool.query(await readFile(new URL("../sql/025_ai_spend_ledger.sql", import.meta.url), "utf8"));
    server = await new Promise<Server>((resolve) => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let calls = 0, fail = false;
    globalThis.fetch = async (input, init) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!target.startsWith("https://api.openai.com/")) return originalFetch(input, init);
      calls++;
      return fail ? new Response(JSON.stringify({ error: { message: "simulated provider failure" } }), { status: 500, headers: { "Content-Type": "application/json" } })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    };
    const request = (credential = token) => originalFetch(`${base}/mobile/users/${user.id}/ai/tts`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ text: "PRIVATE_HTTP_SPEECH_SENTINEL", preset: "female-balanced" }) });
    await t.test("unauthorized request cannot spend or reserve", async () => {
      assert.equal((await request("wrong-token")).status, 401); assert.equal(calls, 0);
      assert.equal((await db.pool.query("SELECT * FROM ai_provider_attempts")).rowCount, 0);
    });
    await t.test("successful audio has one event/attempt and measured characters, without raw speech persistence", async () => {
      const result = await request(); assert.equal(result.status, 200, await result.clone().text());
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([1, 2, 3]));
      assert.equal(calls, 1);
      const rows = (await db.pool.query("SELECT * FROM ai_provider_attempts")).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].state, "succeeded"); assert.equal(rows[0].actor_id, user.id);
      assert.equal(rows[0].org_id, org.id); assert.equal(rows[0].tts_characters, String("PRIVATE_HTTP_SPEECH_SENTINEL".length));
      assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_HTTP_SPEECH_SENTINEL|local-mocked-provider-key/);
      assert.equal((await usage.listEvents()).length, 1);
    });
    await t.test("possible billable failure keeps existing safe error and blocks exhaustion before another provider call", async () => {
      fail = true; const failure = await request(); assert.equal(failure.status, 503);
      assert.equal((await failure.json() as any).code, "ai_unavailable");
      assert.equal(calls, 2, "enterprise user still has the established per-user exemption");
      const rejected = await request(); assert.equal(rejected.status, 429);
      assert.equal((await rejected.json() as any).error, "Daily AI request limit reached for this environment.");
      assert.equal(calls, 2); assert.equal((await usage.listEvents()).length, 2);
      assert.equal((await db.pool.query("SELECT * FROM ai_provider_attempts WHERE state='unknown'")).rowCount, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await db.close();
  }
});
