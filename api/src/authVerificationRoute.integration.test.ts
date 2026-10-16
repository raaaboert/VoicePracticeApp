import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createDefaultConfig } from "@voicepractice/shared";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { setAuthCodeDeliveryObserverForTest } from "./services/authCodeDelivery.js";

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
      ENABLE_INTERNAL_DEBUG_ENDPOINTS: "false", TRAINING_CONTENT_STORAGE_PROVIDER: "disabled" });
    delete process.env.APP_REVIEW_EMAIL; delete process.env.APP_REVIEW_CODE;
    const api = await import("./index.js");
    await t.test("missing-schema startup fails before API listen", async () => {
      await assert.rejects(api.startApiServer(), /auth_verification_accounts/);
    });
    await db.migrate();
    server = await new Promise<Server>((resolve) => { const s = api.app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (route: string, body?: unknown, auth?: string, ip = "198.51.100.1") => {
      const r = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: {
        "Content-Type": "application/json", "X-Forwarded-For": ip, ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() as any };
    };
    let lastCode = "";
    setAuthCodeDeliveryObserverForTest(({ code }) => { lastCode = code; });
    const requestCode = async (email: string) => { lastCode = ""; return request("/web/auth/request-code", { email }); };
    const verifyWeb = (email: string, code: string, ip?: string) => request("/web/auth/verify-code", { email, code }, undefined, ip);
    const appState = async () => (await db.pool.query("SELECT state_json, updated_at FROM app_state WHERE id='primary'")).rows[0];

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
      for (let i = 0; i < 4; i++) {
        const bad = next === "999999" ? "999998" : "999999";
        assert.equal((await request("/mobile/onboard/verify-email", { userId: users[0].id, code: bad, firstName: "Test", lastName: "User" }, onboarded.body.authToken, `192.0.2.${i}`)).status, 400);
      }
      assert.equal((await request("/mobile/onboard/verify-email", { userId: users[0].id, code: next, firstName: "Test", lastName: "User" }, onboarded.body.authToken)).status, 400);
      assert.equal((await requestCode(users[0].email)).status, 200); assert.equal(lastCode, "");
      api.advanceAuthVerificationClockForTest(15 * 60_000 + 1); api.clearRateLimitsForTest();
      await requestCode(users[0].email); assert.ok(lastCode); assert.equal((await verifyWeb(users[0].email, lastCode)).status, 200);
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
