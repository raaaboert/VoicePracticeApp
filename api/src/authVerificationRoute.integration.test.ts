import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createDefaultConfig, type MobileOnboardRequest } from "@voicepractice/shared";
import { createLocalAuthDatabase } from "./storage/authVerificationTestDatabase.js";
import { createAuthCodeDeliveryService, setAuthCodeDeliveryObserverForTest } from "./services/authCodeDelivery.js";
import { AuthVerificationStore, AuthVerificationAuthorityError } from "./storage/authVerificationStore.js";
import { exerciseOnboardingConsumer } from "./mobileOnboardingCompatibility.testSupport.js";

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
    process.env.APP_REVIEW_EMAIL = "reviewer-privacy@auth.test"; process.env.APP_REVIEW_CODE = "808080";
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
      assert.equal((await request("/mobile/onboard/verify-email", { userId: id, code, firstName: "New", lastName: "User" }, auth)).status, 400);
    });
    await t.test("authority binding reuses canonical profile normalization instead of rejecting legacy optional fields", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      const state = (await appState()).state_json;
      state.users.find((user: any) => user.id === users[0].id).divisionId = "retired-division";
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(state)]);
      await requestCode(users[0].email); assert.ok(lastCode);
      assert.equal((await verifyWeb(users[0].email, lastCode)).status, 200);
    });
    await t.test("independent PostgreSQL reads repair invalid managers deterministically without rewriting state and permit login", async (t) => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(60_001);
      const state = (await appState()).state_json;
      const target = state.users.find((u: any) => u.id === users[0].id);
      target.managerUserId = "deleted_manager";
      const undated = { ...user("legacy_undated", "legacy-undated@auth.test") } as any;
      delete undated.createdAt; delete undated.emailVerifiedAt;
      state.users.push(undated);
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(state)]);
      const store = new AuthVerificationStore({ provider: "postgres", databaseUrl: db.url, dbPath: "unused.json",
        secret: process.env.WEB_AUTH_TOKEN_SECRET!, pgPoolMax: 1, pgConnectTimeoutMs: 1000, pgIdleTimeoutMs: 100,
        normalizeAuthorityState: api.ensureDatabaseShape });
      try {
        let expected: string | undefined;
        t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
        try {
          for (let i = 0; i < 4; i++) {
            t.mock.timers.tick(2000);
            const loaded = api.ensureDatabaseShape((await appState()).state_json);
            const user = loaded.users.find((u) => u.id === target.id)!;
            assert.equal(user.managerUserId, null);
            assert.equal(user.updatedAt, target.updatedAt, "read-only repair must retain persisted revision");
            const fingerprint = store.bindIdentity(loaded, user, "sign_in").authorityBinding;
            if (i === 0) expected = fingerprint;
            assert.equal(fingerprint, expected);
            assert.equal(loaded.users.find((u) => u.id === undated.id)!.emailVerifiedAt, null,
              "missing legacy verification dates must not become fresh wall-clock authority");
          }
        } finally { t.mock.timers.reset(); }
        await requestCode(target.email); assert.match(lastCode, /^\d{6}$/);
        assert.deepEqual((await appState()).state_json, state, "code issuance must not rewrite app state to stabilize authority");
        assert.equal((await verifyWeb(target.email, lastCode)).status, 200);
      } finally { await store.close(); }
    });
    await t.test("Master manager deletion commits report cleanup, cancels stale codes, and leaves unrelated organizations intact", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(900_001);
      const state = (await appState()).state_json;
      const manager = user("delete_manager", "delete-manager@auth.test");
      const report = { ...user("former_report", "former-report@auth.test"), managerUserId: manager.id };
      const colleague = user("unrelated_manager", "unrelated-manager@auth.test");
      const unrelated = { ...user("unrelated_report", "unrelated-report@auth.test"), managerUserId: colleague.id };
      const otherOrg = { ...state.orgs[0], id: "org_unrelated", joinCode: "OTHERORG" };
      const foreignManager = { ...user("foreign_manager", "foreign-manager@auth.test"), orgId: otherOrg.id };
      const foreignReport = { ...user("foreign_report", "foreign-report@auth.test"), orgId: otherOrg.id, managerUserId: foreignManager.id };
      state.orgs.push(otherOrg);
      state.users.push(manager, report, colleague, unrelated, foreignManager, foreignReport);
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(state)]);
      await requestCode(manager.email); const managerCode = lastCode;
      const managerSession = await verifyWeb(manager.email, managerCode); assert.equal(managerSession.status, 200);
      api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(manager.email); const pendingManagerCode = lastCode;
      await requestCode(report.email); const staleReportCode = lastCode;
      assert.equal((await request(`/users/${manager.id}`, undefined, admin, "198.51.100.1", "DELETE")).status, 200);
      const committed = (await appState()).state_json;
      assert.equal(committed.users.some((u: any) => u.id === manager.id), false);
      const updatedReport = committed.users.find((u: any) => u.id === report.id);
      assert.equal(updatedReport.managerUserId, null);
      assert.notEqual(updatedReport.updatedAt, report.updatedAt);
      for (const unchanged of [colleague, unrelated, foreignManager, foreignReport]) {
        assert.deepEqual(committed.users.find((u: any) => u.id === unchanged.id), api.ensureDatabaseShape(state).users.find((u) => u.id === unchanged.id));
      }
      assert.equal((await request("/web/auth/session", undefined, managerSession.body.token)).status, 401);
      assert.equal((await verifyWeb(manager.email, pendingManagerCode)).status, 400);
      assert.equal((await verifyWeb(report.email, staleReportCode)).status, 400);
      assert.equal((await db.pool.query("SELECT COUNT(*)::int AS n FROM auth_verification_challenges WHERE user_id=ANY($1::text[]) AND consumed_at IS NULL AND invalidated_at IS NULL", [[manager.id, report.id]])).rows[0].n, 0);
      api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(report.email); assert.match(lastCode, /^\d{6}$/);
      assert.equal((await verifyWeb(report.email, lastCode)).status, 200);
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
    await t.test("permission revocation racing HTTP verification commits cancellation before stale authentication can succeed", async () => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(900_001);
      const target = users[2];
      await requestCode(target.email); const code = lastCode; assert.match(code, /^\d{6}$/);
      let entered!: () => void, release!: () => void;
      const atCommit = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      api.setDatabaseSaveBarrierForTest(async () => { entered(); await gate; });
      const revocation = patch(`/users/${target.id}`, { dashboardAccessEnabled: false });
      let verification: ReturnType<typeof verifyWeb> | undefined;
      try {
        await atCommit;
        verification = verifyWeb(target.email, code);
      } finally { api.setDatabaseSaveBarrierForTest(null); release(); }
      assert.equal((await revocation).status, 200);
      assert.equal((await verification!).status, 400);
      assert.equal((await db.pool.query("SELECT COUNT(*)::int AS n FROM auth_verification_challenges WHERE user_id=$1 AND consumed_at IS NULL AND invalidated_at IS NULL", [target.id])).rows[0].n, 0);
      assert.equal((await patch(`/users/${target.id}`, { dashboardAccessEnabled: true })).status, 200);
      assert.equal((await verifyWeb(target.email, code)).status, 400, "re-grant cannot revive canceled challenge");
      api.advanceAuthVerificationClockForTest(60_001);
      await requestCode(target.email); assert.match(lastCode, /^\d{6}$/);
      assert.equal((await verifyWeb(target.email, lastCode)).status, 200);
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
        await assert.rejects(store.issue(staleIdentity), AuthVerificationAuthorityError);
      } finally { await store.close(); }
    });
    await t.test("pre-verification mobile privacy and installed-client compatibility through PostgreSQL HTTP", async (t) => {
      api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(900_001);
      const state = (await appState()).state_json;
      const org = { ...state.orgs[0], id: "PRIVATE_ORG_9E2", joinCode: "PRIVACY2", divisionsEnabled: true };
      const otherOrg = { ...org, id: "PRIVATE_OTHER_ORG_9E2", joinCode: "PRIVACY3" };
      const manager = { ...user("PRIVATE_MANAGER_9E2", "private-manager@auth.test"), orgId: org.id };
      const rich = (id: string, changes: Record<string, unknown> = {}) => ({
        ...user(id, `${id}@privacy.test`), orgId: org.id, orgRole: "org_admin", performanceAccess: "organization",
        firstName: "PRIVATE_STORED_FIRST", lastName: "PRIVATE_STORED_LAST", timezone: "Asia/Tokyo",
        employeeId: `PRIVATE_EMPLOYEE_${id}`, managerUserId: manager.id, divisionId: "PRIVATE_DIVISION_9E2",
        dashboardAccessEnabled: true, createdAt: "2001-01-02T03:04:05.000Z", updatedAt: "2002-02-03T04:05:06.000Z",
        emailVerifiedAt: "2003-03-04T05:06:07.000Z", pendingTimezone: "Pacific/Auckland",
        pendingTimezoneEffectiveAt: "2099-01-01T00:00:00.000Z", planAnchorAt: "2004-04-05T06:07:08.000Z",
        manualBonusSeconds: 97531, dailySecondsCapOverride: 87654, allowDailyOverageThisCycle: true,
        dailyOverageExpiresAt: "2099-02-01T00:00:00.000Z", dailyOverageMode: "finite",
        dailyOverageStartedAt: "2005-05-06T07:08:09.000Z", dailyOverageBaseSecondsCap: 76543,
        dailyOverageExtraSecondsGranted: 65432, internalFutureProperty: { value: "PRIVATE_FUTURE_PROPERTY" }, ...changes,
      });
      const verifiedUser = rich("private_verified");
      const unverifiedUser = rich("private_unverified", { emailVerifiedAt: null });
      const privilegedUser = rich("private_privileged", { isSuperUser: true, isPlatformAdmin: true });
      const reonboardingUser = rich("private_reonboarding", { mobileProfileReonboardingRequired: true });
      const disabledUser = rich("private_disabled", { status: "disabled" });
      const reviewer = rich("private_reviewer", { email: process.env.APP_REVIEW_EMAIL });
      state.orgs.push(org, otherOrg);
      state.orgDivisions.push({ id: "PRIVATE_DIVISION_9E2", orgId: org.id, name: "Private Division", active: true, createdAt: now, updatedAt: now });
      state.users.push(manager, verifiedUser, unverifiedUser, privilegedUser, reonboardingUser, disabledUser, reviewer);
      await db.pool.query("UPDATE app_state SET state_json=$1::jsonb WHERE id='primary'", [JSON.stringify(state)]);
      const submitted = (email: string, extra: Record<string, unknown> = {}): MobileOnboardRequest => ({
        email, firstName: "Caller", lastName: "Presentation", timezone: "America/Denver", ...extra,
      });
      const assertProjection = (payload: any, input: ReturnType<typeof submitted>) => {
        assert.deepEqual(Object.keys(payload).sort(), ["authToken", "domainMatch", "user", "verificationExpiresAt", "verificationRequired"]);
        assert.equal(payload.verificationRequired, true); assert.equal(payload.domainMatch, null);
        assert.ok(Number.isFinite(Date.parse(payload.verificationExpiresAt)));
        assert.deepEqual(payload.user, {
          id: payload.user.id, email: input.email.trim().toLowerCase(), firstName: input.firstName, lastName: input.lastName,
          timezone: input.timezone, emailVerifiedAt: null, employeeId: null, managerUserId: null, divisionId: null,
          isPlatformAdmin: false, isSuperUser: false, dashboardAccessEnabled: false, mobileProfileReonboardingRequired: false,
          accountType: "individual", tier: "free", status: "active", orgId: null, orgRole: "user",
          pendingTimezone: null, pendingTimezoneEffectiveAt: null, planAnchorAt: "1970-01-01T00:00:00.000Z",
          manualBonusSeconds: 0, dailySecondsCapOverride: null, allowDailyOverageThisCycle: false, dailyOverageExpiresAt: null,
          createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
        });
        assert.match(payload.authToken, /^mobile_onboarding_v1\./);
        const tokenData = JSON.parse(Buffer.from(payload.authToken.split(".")[1], "base64url").toString("utf8"));
        assert.deepEqual(tokenData, { purpose: "existing_mobile_onboarding", version: 1, userId: payload.user.id,
          email: input.email.trim().toLowerCase(), firstName: input.firstName, lastName: input.lastName, timezone: input.timezone,
          joinCode: input.joinCode ?? "", expiresAt: payload.verificationExpiresAt });
        assert.doesNotMatch(JSON.stringify([payload, tokenData]), /PRIVATE_|Asia\/Tokyo|Pacific\/Auckland|97531|87654|76543|65432|2001-01|2002-02|2003-03|2004-04|2005-05/);
      };
      const onboard = async (input: ReturnType<typeof submitted>, status = 200) => {
        const response = await fetch(base + "/mobile/onboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const payload = await response.json();
        assert.equal(response.status, status, JSON.stringify(payload));
        assert.doesNotMatch(JSON.stringify([...response.headers]), /PRIVATE_|Asia\/Tokyo|Pacific\/Auckland|97531|87654/);
        assertProjection(payload, input);
        return payload;
      };
      const verify = (payload: any, code: string, extra: Record<string, unknown> = {}) =>
        request("/mobile/onboard/verify-email", { userId: payload.user.id, code, ...extra }, payload.authToken);

      for (const existing of [verifiedUser, unverifiedUser, privilegedUser]) {
        await t.test(`allowlisted placeholder protects stored profile for ${existing.id}`, async () => {
          const before = (await appState()).state_json;
          const input = submitted(` ${existing.email.toUpperCase()} `);
          const payload = await onboard(input); const code = lastCode;
          assert.equal(payload.user.id, existing.id);
          assert.deepEqual((await appState()).state_json, before, "presentation values are not persisted before verification");
          for (const route of [`/mobile/users/${existing.id}`, `/mobile/users/${existing.id}/config`, `/mobile/users/${existing.id}/entitlements`]) {
            assert.equal((await request(route, undefined, payload.authToken)).status, 401);
          }
          const result = await verify(payload, code); assert.equal(result.status, 200);
          assert.equal(result.body.verificationRequired, false); assert.notEqual(result.body.authToken, payload.authToken);
          const actual = (await appState()).state_json.users.find((u: any) => u.id === existing.id);
          const { performanceAccess: _internal, ...expected } = actual;
          assert.deepEqual(result.body.user, expected, "authorized profile remains full and unchanged in shape");
          assert.equal(result.body.user.employeeId, existing.employeeId);
          assert.equal(result.body.user.orgId, org.id); assert.equal(result.body.user.orgRole, "org_admin");
          assert.equal(result.body.user.firstName, input.firstName); assert.equal(result.body.user.timezone, input.timezone);
          assert.equal((await request(`/mobile/users/${existing.id}`, undefined, result.body.authToken)).status, 200);
          assert.equal((await verify(payload, code)).status, 400, "consumed signed-token challenge cannot replay");
        });
      }
      await t.test("first-time and interrupted retries echo only current submitted values and issue no usable normal credential", async () => {
        const first = await onboard(submitted("privacy-new@auth.test"), 201); const firstCode = lastCode;
        const firstChallengeId = (await db.pool.query("SELECT id FROM auth_verification_challenges WHERE user_id=$1 AND invalidated_at IS NULL", [first.user.id])).rows[0].id;
        assert.equal((await request(`/mobile/users/${first.user.id}`, undefined, first.authToken)).status, 401);
        assert.equal((await request("/mobile/onboard/resend-verification", { userId: first.user.id }, first.authToken)).status, 429);
        api.advanceAuthVerificationClockForTest(60_001);
        const retryInput = submitted("privacy-new@auth.test", { firstName: "Retry", lastName: "Caller", timezone: "Europe/London" });
        const retry = await onboard(retryInput); const retryCode = lastCode;
        assert.equal(retry.user.id, first.user.id);
        const pending = (await appState()).state_json.users.find((u: any) => u.id === first.user.id);
        assert.equal(pending.firstName, null); assert.equal(pending.lastName, null);
        assert.equal(pending.timezone, "America/Denver", "retry projection must not read or rewrite the pending stored timezone");
        assert.ok((await db.pool.query("SELECT invalidated_at FROM auth_verification_challenges WHERE id=$1", [firstChallengeId])).rows[0].invalidated_at);
        if (firstCode !== retryCode) assert.equal((await verify(first, firstCode)).status, 400);
        const result = await verify(retry, retryCode); assert.equal(result.status, 200);
        assert.equal(result.body.user.timezone, "Europe/London"); assert.equal(result.body.user.firstName, "Retry");
        assert.equal((await request(`/mobile/users/${first.user.id}`, undefined, result.body.authToken)).status, 200);
      });
      await t.test("interrupted provider delivery leaves a private pending profile and retry uses current caller presentation", async () => {
        api.setAuthCodeDeliveryServiceForTest({ sendWebSignInCode: async () => { throw new Error("unused"); },
          sendEmailVerificationCode: async () => { throw new Error("ambiguous private transport failure"); } });
        try {
          const failed = await request("/mobile/onboard", submitted("privacy-interrupted@auth.test"));
          assert.equal(failed.status, 502); assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE_|private transport|firstName|orgId/);
        } finally { api.setAuthCodeDeliveryServiceForTest(null); }
        const pending = (await appState()).state_json.users.find((u: any) => u.email === "privacy-interrupted@auth.test");
        api.advanceAuthVerificationClockForTest(60_001);
        const payload = await onboard(submitted(pending.email, { firstName: "Recovered", timezone: "Europe/London" }));
        assert.equal(payload.user.id, pending.id);
        assert.equal((await verify(payload, lastCode)).status, 200);
      });
      await t.test("server enforces company code and re-onboarding despite neutral account hints", async () => {
        assert.equal((await request("/mobile/onboard", submitted(reonboardingUser.email))).status, 400);
        assert.equal((await request("/mobile/onboard", submitted(reonboardingUser.email, { joinCode: "PRIVACY3" }))).status, 403);
        const payload = await onboard(submitted(reonboardingUser.email, { joinCode: "PRIVACY2" }));
        assert.equal(payload.user.mobileProfileReonboardingRequired, false);
        const result = await verify(payload, lastCode, { joinCode: "PRIVACY3", firstName: "Forged", accountType: "individual" });
        assert.equal(result.status, 200); assert.equal(result.body.user.orgId, org.id);
        assert.equal(result.body.user.firstName, "Caller"); assert.equal(result.body.user.mobileProfileReonboardingRequired, false);
        // A newly imposed requirement is also checked at verification, independent of client hints.
        api.advanceAuthVerificationClockForTest(60_001);
        const later = await onboard(submitted(unverifiedUser.email)); const code = lastCode;
        assert.equal((await patch(`/users/${unverifiedUser.id}`, { mobileProfileReonboardingRequired: true })).status, 200);
        assert.equal((await verify(later, code)).status, 400);
      });
      await t.test("disabled user and organization restrictions remain enforced without private profile responses", async () => {
        const disabled = await request("/mobile/onboard", submitted(disabledUser.email));
        assert.equal(disabled.status, 403); assert.deepEqual(Object.keys(disabled.body), ["error"]);
        assert.equal((await patch(`/orgs/${org.id}`, { status: "disabled" })).status, 200);
        const blocked = await request("/mobile/onboard", submitted(verifiedUser.email));
        assert.equal(blocked.status, 403); assert.deepEqual(Object.keys(blocked.body), ["error"]);
        assert.doesNotMatch(JSON.stringify([disabled.body, blocked.body]), /PRIVATE_|employeeId|firstName|orgId/);
        assert.equal((await patch(`/orgs/${org.id}`, { status: "active" })).status, 200);
      });
      await t.test("expired and invalid codes cannot exchange the private placeholder for a full profile", async () => {
        const payload = await onboard(submitted("privacy-expired@auth.test"), 201); const code = lastCode;
        const wrong = code === "999999" ? "999998" : "999999";
        assert.equal((await verify(payload, wrong)).status, 400);
        api.advanceAuthVerificationClockForTest(900_001);
        assert.equal((await verify(payload, code)).status, 400);
        assert.equal((await request(`/mobile/users/${payload.user.id}`, undefined, payload.authToken)).status, 401);
      });
      await t.test("App Store reviewer still verifies through PostgreSQL using the same private placeholder", async () => {
        const payload = await onboard(submitted(String(reviewer.email)));
        const result = await verify(payload, "808080"); assert.equal(result.status, 200);
        assert.equal(result.body.user.id, reviewer.id); assert.equal(result.body.user.orgId, org.id);
        assert.equal((await verify(payload, "808080")).status, 400);
      });
      for (const revision of ["current", "frozen"] as const) {
        await t.test(`${revision} actual mobile onboarding callback and setup helpers reach verification with the reduced response`, async () => {
          for (const email of [`privacy-client-${revision}@auth.test`, String(privilegedUser.email)]) {
            api.clearRateLimitsForTest(); api.advanceAuthVerificationClockForTest(900_001);
            const input = submitted(email);
            const payload = await exerciseOnboardingConsumer(revision, input, async (body) => {
              const status = email.endsWith("@auth.test") ? 201 : 200;
              return onboard(body, status);
            });
            const result = await verify(payload, lastCode); assert.equal(result.status, 200);
          }
        });
      }
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
