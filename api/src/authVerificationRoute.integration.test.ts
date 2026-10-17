import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createDefaultConfig } from "@voicepractice/shared";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createAuthCodeDeliveryService, setAuthCodeDeliveryObserverForTest } from "./services/authCodeDelivery.js";
import { AuthVerificationStore } from "./storage/authVerificationStore.js";

const url = process.env.AUTH_VERIFICATION_INTEGRATION_DATABASE_URL?.trim() || process.env.FOCUS_TOPIC_AUTHORITY_INTEGRATION_DATABASE_URL?.trim();
const mobileSecret = "auth_http_mobile_token_secret_at_least_32_characters";
test("PostgreSQL dashboard/mobile authentication HTTP contracts and durable abuse controls", { skip: !url }, async (t) => {
  const db = await createLocalAuthDatabase(url!);
  let server: Server | undefined;
  const now = new Date().toISOString();
  const user = (id: string, email: string) => ({ id, email, firstName: "Test", lastName: "User", employeeId: null, managerUserId: null,
    emailVerifiedAt: now, dashboardAccessEnabled: true, isSuperUser: false, isPlatformAdmin: false,
    mobileProfileReonboardingRequired: false, accountType: "enterprise", tier: "enterprise", status: "active", orgId: "org_auth", orgRole: "user", performanceAccess: "none",
    timezone: "UTC", pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: now, manualBonusSeconds: 0,
    dailySecondsCapOverride: null, allowDailyOverageThisCycle: false, dailyOverageExpiresAt: null, createdAt: now, updatedAt: now });
  const users = [user("dashboard", "dashboard@auth.test"), user("mobile", "mobile@auth.test"), user("other", "other@auth.test")];
  const token = (userId: string) => ({ userId, tokenHash: crypto.createHmac("sha256", mobileSecret).update(`token_${userId}`).digest("hex"), createdAt: now, updatedAt: now });
  try {
    await db.pool.query("CREATE TABLE app_state(id TEXT PRIMARY KEY, state_json JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await db.pool.query("INSERT INTO app_state(id, state_json) VALUES ('primary',$1::jsonb)", [JSON.stringify({
      config: createDefaultConfig(now), users, orgs: [{ id: "org_auth", name: "Auth Test", status: "active", contactName: "Test", contactEmail: "owner@auth.test", joinCode: "AUTHTEST", activeIndustries: ["people_management"], dailySecondsQuota: 3600, perUserDailySecondsCap: 1800, manualBonusSeconds: 0, monthlyMinutesAllotted: 1000, maxSimulationMinutes: 20, createdAt: now, updatedAt: now }], orgDivisions: [], orgTrainings: [], orgTrainingPackAttachments: [], orgTrainingScenarioAttachments: [],
      orgStandardScenarioDivisionAssignments: [], trainingPackAssignments: [], usageSessions: [], mobileAuthTokens: users.map((u) => token(u.id)),
      emailVerifications: [], webAuthChallenges: [], enterpriseJoinRequests: [], appStateMigrations: {}, admin: { passwordHash: null, activeSessionIds: [] },
    })]);
    Object.assign(process.env, { NODE_ENV: "test", PERITIO_ENV: "development", STORAGE_PROVIDER: "postgres", DATABASE_URL: db.url,
      FOCUS_TOPIC_AUTHORITY: "legacy", PG_IDLE_TIMEOUT_MS: "100", AUTH_CODE_DELIVERY_PROVIDER: "log_only",
      WEB_AUTH_CODE_DELIVERY_PROVIDER: "log_only", MOBILE_EMAIL_VERIFICATION_DELIVERY_PROVIDER: "log_only", MOBILE_TOKEN_SECRET: mobileSecret,
      WEB_AUTH_TOKEN_SECRET: "auth_http_web_secret_of_at_least_32_characters", ADMIN_TOKEN_SECRET: "auth_http_admin_secret_of_at_least_32_characters", SUPPORT_TRANSCRIPT_SECRET: "auth_http_support_secret_of_at_least_32_characters",
      ADMIN_BOOTSTRAP_PASSWORD: "auth_test_admin_password",
      ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", TRAINING_CONTENT_STORAGE_PROVIDER: "disabled" });
    delete process.env.APP_REVIEW_EMAIL; delete process.env.APP_REVIEW_CODE;
    const api = await import("./index.js");
    await t.test("missing-schema startup fails before API listen", async () => {
      await assert.rejects(api.startApiServer(), /auth_verification_accounts/);
    });
    await db.migrate();
    server = await new Promise<Server>((resolve) => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (route: string, body?: unknown, auth?: string, ip = "198.51.100.1", method = body === undefined ? "GET" : "POST") => {
      const r = await fetch(base + route, { method, headers: {
        "Content-Type": "application/json", "X-Forwarded-For": ip, ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() as any };
    };
    let lastCode = "";
    setAuthCodeDeliveryObserverForTest(({ code }) => { lastCode = code; });
    const requestCode = async (email: string) => { lastCode = ""; return request("/web/auth/request-code", { email }); };
    const verifyWeb = (email: string, code: string, ip?: string) => request("/web/auth/verify-code", { email, code }, undefined, ip);
    const appState = async () => (await db.pool.query("SELECT state_json, updated_at FROM app_state WHERE id='primary'")).rows[0];
    const keyFor = (email: string) => crypto.createHmac("sha256", process.env.WEB_AUTH_TOKEN_SECRET!)
      .update(JSON.stringify(["peritio.auth.account.v1", email.trim().toLowerCase()])).digest("hex");
    const login = await request("/auth/login", { password: "auth_test_admin_password" });
    assert.equal(login.status, 200); const admin = login.body.token as string;
    const patch = (route: string, body: unknown) => request(route, body, admin, "198.51.100.1", "PATCH");

    await t.test("ten guesses without a challenge cannot lock a known account or disclose existence", async () => {
      let failure: unknown;
      for (let i = 0; i < 10; i++) {
        const result = await verifyWeb(users[0].email, "999999", `192.0.2.${i}`);
        assert.equal(result.status, 400); failure = result;
      }
      assert.deepEqual(await verifyWeb("unknown@auth.test", "999999", "203.0.113.1"), failure);
      const state = (await db.pool.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1", [keyFor(users[0].email)])).rows[0];
      assert.deepEqual(state.failure_times, []); assert.equal(state.locked_until, null);
      api.clearRateLimitsForTest();
    });

    await t.test("dashboard request, cooldown, unknown-account acknowledgement and successful one-time login", async () => {
      const issued = await requestCode(users[0].email); assert.equal(issued.status, 200); const code = lastCode; assert.match(code, /^\d{6}$/);
      const before = await appState();
      const limited = await requestCode(users[0].email); assert.equal(lastCode, ""); assert.deepEqual(limited, issued);
      assert.deepEqual(await requestCode("unknown@auth.test"), issued);
      assert.equal((await appState()).updated_at.getTime(), before.updated_at.getTime());
      const verified = await verifyWeb(users[0].email, code); assert.equal(verified.status, 200);
      assert.equal(typeof verified.body.token, "string"); assert.equal((await request("/web/auth/session", undefined, verified.body.token)).status, 200);
      assert.equal((await verifyWeb(users[0].email, code)).status, 400);
      assert.equal((await request("/web/auth/logout", {}, verified.body.token)).status, 200);
      assert.equal((await request("/web/auth/session", undefined, verified.body.token)).status, 401);
    });
    await t.test("mobile onboarding, resend cooldown, verification and token isolation remain compatible", async () => {
      const onboarded = await request("/mobile/onboard", { email: "new@auth.test", firstName: "New", lastName: "User", timezone: "UTC" });
      assert.equal(onboarded.status, 201); const code = lastCode;
      const id = onboarded.body.user.id, auth = onboarded.body.authToken;
      assert.equal((await request("/mobile/onboard/resend-verification", { userId: id }, auth)).status, 429);
      assert.equal((await request("/mobile/onboard/verify-email", { userId: id, code, firstName: "New", lastName: "User" }, "token_other")).status, 401);
      const verified = await request("/mobile/onboard/verify-email", { userId: id, code, firstName: "New", lastName: "User" }, auth);
      assert.equal(verified.status, 200); assert.equal(verified.body.verificationRequired, false);
      assert.equal((await request(`/mobile/users/other/entitlements`, undefined, verified.body.authToken)).status, 401);
      assert.equal((await request(`/mobile/users/${id}/entitlements`, undefined, verified.body.authToken)).status, 200);
      assert.equal((await request("/mobile/onboard/verify-email", { userId: id, code, firstName: "New", lastName: "User" }, auth)).status, 401);
    });
    await t.test("authority binding reuses canonical profile normalization instead of rejecting legacy optional fields", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      const state = (await appState()).state_json;
      state.users.find((user: any) => user.id === users[0].id).divisionId = "retired-division";
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(state)]);
      await requestCode(users[0].email); assert.ok(lastCode);
      assert.equal((await verifyWeb(users[0].email, lastCode)).status, 200);
    });
    await t.test("spoofed forwarding identities do not reset five-guess invalidation or durable shared account lock", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(users[0].email); const original = lastCode;
      const before = await appState();
      api.setDatabaseSaveBarrierForTest(async () => { throw new Error("authentication failure attempted full app_state rewrite"); });
      try {
        for (let i = 0; i < 5; i++) assert.equal((await verifyWeb(users[0].email, original === "999999" ? "999998" : "999999", `203.0.113.${i}, 10.0.0.1`)).status, 400);
        assert.equal((await verifyWeb(users[0].email, original)).status, 400);
      } finally { api.setDatabaseSaveBarrierForTest(null); }
      assert.equal((await appState()).updated_at.getTime(), before.updated_at.getTime());
      api.advanceAuthVerificationClockForTest(60_001);
      const onboarded = await request("/mobile/onboard", { email: users[0].email, firstName: "Test", lastName: "User", timezone: "UTC" });
      assert.equal(onboarded.status, 200); const next = lastCode;
      for (let i = 0; i < 5; i++) {
        const bad = next === "999999" ? "999998" : "999999";
        assert.equal((await request("/mobile/onboard/verify-email", { userId: users[0].id, code: bad, firstName: "Test", lastName: "User" }, onboarded.body.authToken, `192.0.2.${i}`)).status, 400);
      }
      assert.equal((await request("/mobile/onboard/verify-email", { userId: users[0].id, code: next, firstName: "Test", lastName: "User" }, onboarded.body.authToken)).status, 400);
      assert.equal((await requestCode(users[0].email)).status, 200); assert.equal(lastCode, "");
      api.advanceAuthVerificationClockForTest(15 * 60_000 + 1); api.clearRateLimitsForTest();
      await requestCode(users[0].email); assert.ok(lastCode); assert.equal((await verifyWeb(users[0].email, lastCode)).status, 200);
    });
    await t.test("new-user provider delivery observes committed state and holds no app-state or account lock", { timeout: 5000 }, async () => {
      let began!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => { began = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      api.setAuthCodeDeliveryServiceForTest({ sendWebSignInCode: async () => "email", sendEmailVerificationCode: async () => { began(); await resume; return "email"; } });
      const pending = request("/mobile/onboard", { email: "outside-lock@auth.test", firstName: "New", lastName: "User", timezone: "UTC" });
      try {
        await started;
        const state = (await appState()).state_json;
        const user = state.users.find((u: any) => u.email === "outside-lock@auth.test");
        assert.ok(user); assert.equal(user.emailVerifiedAt, null);
        assert.ok(state.mobileAuthTokens.some((token: any) => token.userId === user.id));
        assert.equal((await request("/orgs", undefined, admin)).status, 200);
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT * FROM auth_verification_accounts WHERE account_key=$1 FOR UPDATE NOWAIT", [keyFor(user.email)]);
          await client.query("ROLLBACK");
        } finally { client.release(); }
        release(); assert.equal((await pending).status, 201);
      } finally { release(); api.setAuthCodeDeliveryServiceForTest(null); await pending; }
    });
    await t.test("new onboarding persists nothing and sends nothing if the required pending-state commit fails", async () => {
      let sent = false;
      api.setAuthCodeDeliveryServiceForTest({ sendWebSignInCode: async () => "email", sendEmailVerificationCode: async () => { sent = true; return "email"; } });
      api.setDatabaseSaveBarrierForTest(async () => { throw new Error("controlled pending-user save failure"); });
      try {
        assert.equal((await request("/mobile/onboard", { email: "no-persist@auth.test", firstName: "New", lastName: "User", timezone: "UTC" })).status, 500);
        assert.equal(sent, false);
        assert.ok(!(await appState()).state_json.users.some((user: any) => user.email === "no-persist@auth.test"));
      } finally { api.setDatabaseSaveBarrierForTest(null); api.setAuthCodeDeliveryServiceForTest(null); }
    });
    await t.test("ambiguous delivery timeout leaves a recoverable pending user and a non-authenticating debited challenge", async () => {
      const originalFetch = globalThis.fetch;
      let providerSignal: AbortSignal | null = null;
      globalThis.fetch = (async (input, init) => {
        if (String(input) === "https://api.resend.com/emails") {
          providerSignal = init?.signal as AbortSignal;
          return await new Promise<Response>(() => {}); // Transport ignores abort: the bounded race must still settle.
        }
        return originalFetch(input, init);
      }) as typeof fetch;
      api.setAuthCodeDeliveryServiceForTest(createAuthCodeDeliveryService({ defaultProvider: "resend", webAuthProvider: null,
        mobileEmailVerificationProvider: null, resendApiKey: "re_test_timeout_api_key_123456", fromEmail: "sender@auth.test",
        fromName: "Test", replyTo: null, timeoutMs: 1 }));
      const email = "timeout-recover@auth.test";
      try {
        assert.equal((await request("/mobile/onboard", { email, firstName: "Recover", lastName: "User", timezone: "UTC" })).status, 502);
        assert.equal((providerSignal as AbortSignal | null)?.aborted, true);
        assert.equal((await request("/orgs", undefined, admin)).status, 200);
        const user = (await appState()).state_json.users.find((user: any) => user.email === email);
        assert.ok(user); assert.equal(user.emailVerifiedAt, null);
        const row = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE user_id=$1", [user.id])).rows[0];
        assert.ok(row.invalidated_at); assert.equal(row.delivered_at, null);
        assert.equal((await db.pool.query("SELECT issuances FROM auth_verification_accounts WHERE account_key=$1", [keyFor(email)])).rows[0].issuances.length, 1);
        api.setAuthCodeDeliveryServiceForTest(null); api.advanceAuthVerificationClockForTest(60_001);
        const recovered = await request("/mobile/onboard", { email, firstName: "Recover", lastName: "User", timezone: "UTC" });
        assert.equal(recovered.status, 200); assert.equal(recovered.body.user.id, user.id);
        const verified = await request("/mobile/onboard/verify-email", { userId: user.id, code: lastCode, firstName: "Recover", lastName: "User" }, recovered.body.authToken);
        assert.equal(verified.status, 200);
      } finally { api.setAuthCodeDeliveryServiceForTest(null); globalThis.fetch = originalFetch; }
    });
    await t.test("legacy app_state codes are never accepted and wrong account/cross-purpose codes fail", async () => {
      api.clearRateLimitsForTest();
      const legacy = { id: "old", userId: users[2].id, email: users[2].email, codeHash: crypto.createHmac("sha256", mobileSecret).update(`${users[2].id}:${users[2].email}:123456`).digest("hex"), createdAt: now, expiresAt: new Date(Date.now() + 900_000).toISOString(), consumedAt: null, challengeType: "sign_in" };
      await db.pool.query("UPDATE app_state SET state_json=jsonb_set(state_json,'{webAuthChallenges}',$1::jsonb) WHERE id='primary'", [JSON.stringify([legacy])]);
      assert.equal((await verifyWeb(users[2].email, "123456")).status, 400);
      await requestCode(users[2].email); const code = lastCode;
      assert.equal((await verifyWeb(users[1].email, code)).status, 400);
      const mobile = await request("/mobile/onboard", { email: users[1].email, firstName: "Test", lastName: "User", timezone: "UTC" });
      assert.equal(mobile.status, 200);
      assert.equal((await verifyWeb(users[1].email, lastCode)).status, 400, "email verification must not sign into an already-verified dashboard account");
    });
    await t.test("user disable, reactivation, role changes and email changes cancel pending challenges transactionally", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      const target = users[1];
      await requestCode(target.email); const code = lastCode;
      const challenge = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [target.id])).rows[0];
      assert.equal((await patch(`/users/${target.id}`, { status: "disabled" })).status, 200);
      assert.ok((await db.pool.query("SELECT invalidated_at FROM auth_verification_challenges WHERE id=$1", [challenge.id])).rows[0].invalidated_at);
      assert.equal((await patch(`/users/${target.id}`, { status: "active" })).status, 200);
      assert.equal((await verifyWeb(target.email, code)).status, 400);
      api.advanceAuthVerificationClockForTest(60_001); await requestCode(target.email); const roleCode = lastCode;
      assert.equal((await patch(`/users/${target.id}`, { orgRole: "user_admin" })).status, 200);
      assert.equal((await verifyWeb(target.email, roleCode)).status, 400);
      assert.equal((await patch(`/users/${target.id}`, { orgRole: "user" })).status, 200);
      assert.equal((await verifyWeb(target.email, roleCode)).status, 400);
      api.advanceAuthVerificationClockForTest(60_001); await requestCode(target.email); const emailCode = lastCode;
      assert.equal((await patch(`/users/${target.id}`, { email: "changed-mobile@auth.test" })).status, 200);
      assert.equal((await verifyWeb(target.email, emailCode)).status, 400);
      assert.equal((await verifyWeb("changed-mobile@auth.test", emailCode)).status, 400);
      assert.equal((await patch(`/users/${target.id}`, { email: target.email })).status, 200);
      assert.equal((await verifyWeb(target.email, emailCode)).status, 400);
    });
    await t.test("organization disable/re-enable cancels stale onboarding challenges and current authority denies verification", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      const onboarded = await request("/mobile/onboard", { email: users[0].email, firstName: "Test", lastName: "User", timezone: "UTC" });
      assert.equal(onboarded.status, 200); const code = lastCode;
      const challenge = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [users[0].id])).rows[0];
      assert.equal((await patch("/orgs/org_auth", { status: "disabled" })).status, 200);
      assert.ok((await db.pool.query("SELECT invalidated_at FROM auth_verification_challenges WHERE id=$1", [challenge.id])).rows[0].invalidated_at);
      const body = { userId: users[0].id, code, firstName: "Test", lastName: "User" };
      assert.equal((await request("/mobile/onboard/verify-email", body, onboarded.body.authToken)).status, 403);
      assert.equal((await patch("/orgs/org_auth", { status: "active" })).status, 200);
      assert.equal((await request("/mobile/onboard/verify-email", body, onboarded.body.authToken)).status, 400);
    });
    await t.test("challenge invalidation and account mutations roll back together on persistence failure", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(users[0].email); const code = lastCode;
      const challenge = (await db.pool.query("SELECT * FROM auth_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [users[0].id])).rows[0];
      api.setDatabaseSaveBarrierForTest(async () => { throw new Error("controlled authority commit failure"); });
      try { assert.equal((await patch(`/users/${users[0].id}`, { status: "disabled" })).status, 500); }
      finally { api.setDatabaseSaveBarrierForTest(null); }
      assert.equal((await appState()).state_json.users.find((u: any) => u.id === users[0].id).status, "active");
      assert.equal((await db.pool.query("SELECT invalidated_at FROM auth_verification_challenges WHERE id=$1", [challenge.id])).rows[0].invalidated_at, null);
      assert.equal((await verifyWeb(users[0].email, code)).status, 200);
    });
    await t.test("authority binding rejects stale codes and reviewer overrides if cancellation is missed", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(users[0].email); const code = lastCode;
      const before = (await appState()).state_json;
      const current = structuredClone(before);
      const user = current.users.find((u: any) => u.id === users[0].id);
      user.status = "disabled"; user.updatedAt = new Date(Date.now() + 1).toISOString();
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(current)]);
      assert.equal((await verifyWeb(users[0].email, code)).status, 400);
      user.status = "active"; user.updatedAt = new Date(Date.now() + 2).toISOString();
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(current)]);
      assert.equal((await verifyWeb(users[0].email, code)).status, 400);
      const store = new AuthVerificationStore({ provider: "postgres", databaseUrl: db.url, dbPath: "unused.json", secret: process.env.WEB_AUTH_TOKEN_SECRET!, pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100 });
      try {
        assert.equal(await store.verify(store.bindIdentity(current, user, "sign_in"), "808080", "808080"), "invalid");
        const staleIdentity = store.bindIdentity(before, before.users.find((u: any) => u.id === user.id), "sign_in");
        assert.equal(await store.issue(staleIdentity), null);
      } finally { await store.close(); }
    });
    await t.test("startup verifies required schema before API listen; no implicit DDL or legacy fallback", async () => {
      const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
      const start = source.slice(source.indexOf("export async function startApiServer"));
      assert.ok(start.indexOf("await authVerificationStore.initialize()") < start.indexOf("app.listen"));
      const store = await readFile(new URL("./storage/authVerificationStore.ts", import.meta.url), "utf8");
      assert.doesNotMatch(store, /CREATE TABLE/);
    });
  } finally {
    setAuthCodeDeliveryObserverForTest(null);
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    // Store pools use a 100ms idle timeout in this isolated test process.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await db.close();
  }
});
