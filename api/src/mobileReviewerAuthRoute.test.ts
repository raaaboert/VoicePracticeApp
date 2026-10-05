import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  EnterpriseOrg,
  UserProfile,
} from "@voicepractice/shared";

const NOW = "2026-08-10T12:00:00.000Z";
const REVIEWER_EMAIL = "reviewer@example.test";
const REVIEWER_CODE = "808080";
const ADMIN_PASSWORD = "reviewer-route-admin-password";
const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_reviewer_route_tests";
const APPROVED_EXISTING_TOKEN = "approved_existing_mobile_token";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let clearRateLimitsForTest: () => void;
let setDatabaseSaveBarrierForTest: (barrier: (() => Promise<void>) | null) => void;
let setAuthenticationResponseObserverForTest: (
  observer: ((route: string, status: number) => void) | null,
) => void;
let setPostCommitAuditFailureForTest: (error: Error | null) => void;
let normalResponseKeys: string[];
let reviewerUserId: string;
let reviewerNormalToken: string;

function buildOrg(): EnterpriseOrg {
  return {
    id: "org_review_test",
    name: "Review Test Organization",
    status: "active",
    contactName: "Test Owner",
    contactEmail: "owner@example.test",
    emailDomain: null,
    joinCode: "REVIEW20",
    activeIndustries: ["people_management"],
    dailySecondsQuota: 3600,
    perUserDailySecondsCap: 1800,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 10_000,
    renewalTotalUsd: 1000,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: false,
    customScenarios: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildApprovedEnterpriseUser(): UserProfile {
  return {
    id: "approved_enterprise_user",
    email: "approved@example.test",
    firstName: "Approved",
    lastName: "Member",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_review_test",
    orgRole: "user",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildApprovedEnterpriseUser(),
      {
        ...buildApprovedEnterpriseUser(),
        id: "dashboard_auth_user",
        email: "dashboard-auth@example.test",
        firstName: "Dashboard",
        lastName: "Auth",
        dashboardAccessEnabled: true,
      },
    ],
    orgs: [buildOrg()],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      {
        userId: "approved_enterprise_user",
        tokenHash: crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(APPROVED_EXISTING_TOKEN).digest("hex"),
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    appStateMigrations: {},
    admin: {
      passwordHash: null,
      activeSessionIds: [],
    },
  };
}

async function apiRequest(pathname: string, init?: RequestInit, authToken?: string) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json() as Record<string, any>,
  };
}

async function onboard(email: string, options?: { joinCode?: string; forwardedFor?: string }) {
  return apiRequest("/mobile/onboard", {
    method: "POST",
    headers: options?.forwardedFor ? { "X-Forwarded-For": options.forwardedFor } : undefined,
    body: JSON.stringify({
      email,
      firstName: "Store",
      lastName: "Reviewer",
      timezone: "America/Denver",
      ...(options?.joinCode ? { joinCode: options.joinCode } : {}),
    }),
  });
}

async function verify(
  userId: string,
  code: string,
  authToken?: string,
  options?: { joinCode?: string; forwardedFor?: string }
) {
  return apiRequest("/mobile/onboard/verify-email", {
    method: "POST",
    headers: options?.forwardedFor ? { "X-Forwarded-For": options.forwardedFor } : undefined,
    body: JSON.stringify({
      userId,
      code,
      firstName: "Store",
      lastName: "Reviewer",
      ...(options?.joinCode ? { joinCode: options.joinCode } : {}),
    }),
  }, authToken);
}

async function captureVerificationCode<T>(runner: () => Promise<T>): Promise<{ result: T; code: string }> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = await runner();
    const code = logs.join("\n").match(/code=(\d{6})/)?.[1];
    assert.ok(code);
    return { result, code };
  } finally {
    console.log = originalLog;
  }
}

async function readDb(): Promise<ApiDatabase> {
  return JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
}

async function requestWhilePersistenceHeld<T>(route: string, runner: () => Promise<T>): Promise<T> {
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
  let releaseSave!: () => void;
  const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
  let responseObserved = false;

  setDatabaseSaveBarrierForTest(async () => {
    markSaveStarted();
    await saveRelease;
  });
  setAuthenticationResponseObserverForTest((observedRoute) => {
    if (observedRoute === route) responseObserved = true;
  });

  const pending = runner();
  try {
    await saveStarted;
    assert.equal(responseObserved, false);
    releaseSave();
    const result = await pending;
    assert.equal(responseObserved, true);
    return result;
  } finally {
    releaseSave();
    setDatabaseSaveBarrierForTest(null);
    setAuthenticationResponseObserverForTest(null);
  }
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-reviewer-auth-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  await writeFile(dbPath, JSON.stringify(buildDatabase(), null, 2), "utf8");

  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = ADMIN_PASSWORD;
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_reviewer_route_tests";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_reviewer_route_tests";
  process.env.WEB_AUTH_CODE_SECRET = "web_auth_code_secret_for_reviewer_route_tests";
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_secret_for_reviewer_route_tests";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  process.env.MOBILE_REVERIFY_ON_ONBOARD = "true";
  process.env.APP_REVIEW_EMAIL = `  ${REVIEWER_EMAIL.toUpperCase()}  `;
  process.env.APP_REVIEW_CODE = ` ${REVIEWER_CODE} `;
  delete process.env.DATABASE_URL;

  const imported = await import("./index.js");
  clearRateLimitsForTest = imported.clearRateLimitsForTest;
  setDatabaseSaveBarrierForTest = imported.setDatabaseSaveBarrierForTest;
  setAuthenticationResponseObserverForTest = imported.setAuthenticationResponseObserverForTest;
  setPostCommitAuditFailureForTest = imported.setPostCommitAuditFailureForTest;
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(tempDir, { recursive: true, force: true });
});

test("normal OTP establishes the baseline mobile verification response", async () => {
  const { result: onboarded, code } = await captureVerificationCode(() => onboard("normal-baseline@example.test"));
  assert.equal(onboarded.status, 201);

  const verified = await verify(onboarded.body.user.id, code, onboarded.body.authToken);
  assert.equal(verified.status, 200);
  normalResponseKeys = Object.keys(verified.body).sort();
});

test("authentication successes wait for durable persistence and persistence failure never reports success", async () => {
  clearRateLimitsForTest();

  const login = await requestWhilePersistenceHeld("POST /auth/login", () =>
    apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })
  );
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, "string");
  assert.ok(Date.parse(login.body.expiresAt as string) > Date.now());

  const logout = await requestWhilePersistenceHeld("POST /auth/logout", () =>
    apiRequest("/auth/logout", { method: "POST" }, login.body.token as string)
  );
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.body, { ok: true });
  assert.equal((await apiRequest("/orgs", undefined, login.body.token as string)).status, 401);

  const webChallenge = await captureVerificationCode(() =>
    apiRequest("/web/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "dashboard-auth@example.test" }),
    })
  );
  assert.equal(webChallenge.result.status, 200);
  const webVerified = await requestWhilePersistenceHeld("POST /web/auth/verify-code", () =>
    apiRequest("/web/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ email: "dashboard-auth@example.test", code: webChallenge.code }),
    })
  );
  assert.equal(webVerified.status, 200);
  assert.equal(typeof webVerified.body.token, "string");
  assert.ok(Date.parse(webVerified.body.expiresAt as string) > Date.now());
  assert.equal((await apiRequest("/web/auth/session", undefined, webVerified.body.token as string)).status, 200);

  const originalLog = console.log;
  const onboardingLogs: string[] = [];
  console.log = (...args: unknown[]) => {
    onboardingLogs.push(args.map(String).join(" "));
  };
  let mobileOnboarded: Awaited<ReturnType<typeof onboard>>;
  try {
    mobileOnboarded = await requestWhilePersistenceHeld("POST /mobile/onboard", () =>
      onboard("durability-mobile@example.test")
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(mobileOnboarded.status, 201);
  const mobileCode = onboardingLogs.join("\n").match(/code=(\d{6})/)?.[1];
  assert.ok(mobileCode);
  const mobileUserId = mobileOnboarded.body.user.id as string;
  const mobileVerified = await requestWhilePersistenceHeld("POST /mobile/onboard/verify-email", () =>
    verify(mobileUserId, mobileCode, mobileOnboarded.body.authToken as string)
  );
  assert.equal(mobileVerified.status, 200);
  assert.equal(mobileVerified.body.verificationRequired, false);
  assert.equal(
    (await apiRequest(`/mobile/users/${mobileUserId}/entitlements`, undefined, mobileVerified.body.authToken as string)).status,
    200,
  );

  const secondLogin = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert.equal(secondLogin.status, 200);
  const changedPassword = "durability-admin-password";
  const passwordChange = await requestWhilePersistenceHeld("POST /auth/change-password", () =>
    apiRequest("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: changedPassword }),
    }, secondLogin.body.token as string)
  );
  assert.equal(passwordChange.status, 200);
  assert.equal((await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })).status, 401);
  assert.equal((await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: changedPassword }),
  })).status, 200);

  let successObserved = false;
  setDatabaseSaveBarrierForTest(async () => {
    throw new Error("controlled authentication persistence failure");
  });
  setAuthenticationResponseObserverForTest((route, status) => {
    if (route === "POST /auth/login" && status === 200) successObserved = true;
  });
  try {
    const failedLogin = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: changedPassword }),
    });
    assert.equal(failedLogin.status, 500);
    assert.equal(successObserved, false);
  } finally {
    setDatabaseSaveBarrierForTest(null);
    setAuthenticationResponseObserverForTest(null);
  }
});

test("committed support cases and revoked web sessions remain successful when post-commit audit delivery fails", async () => {
  clearRateLimitsForTest();

  const webChallenge = await captureVerificationCode(() =>
    apiRequest("/web/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "dashboard-auth@example.test" }),
    })
  );
  assert.equal(webChallenge.result.status, 200);
  const webVerified = await apiRequest("/web/auth/verify-code", {
    method: "POST",
    body: JSON.stringify({ email: "dashboard-auth@example.test", code: webChallenge.code }),
  });
  assert.equal(webVerified.status, 200);
  const webToken = webVerified.body.token as string;

  setPostCommitAuditFailureForTest(new Error("controlled post-commit audit failure"));
  try {
    const publicSupport = await apiRequest("/mobile/public/support/errors", {
      method: "POST",
      body: JSON.stringify({
        message: "[AUTO-ERROR] controlled public support failure",
        context: "b-class-test",
      }),
    });
    assert.equal(publicSupport.status, 201);
    assert.equal(typeof publicSupport.body.caseId, "string");

    const authenticatedSupport = await apiRequest(
      "/mobile/users/approved_enterprise_user/support/cases",
      {
        method: "POST",
        body: JSON.stringify({ message: "Controlled authenticated support failure" }),
      },
      APPROVED_EXISTING_TOKEN,
    );
    assert.equal(authenticatedSupport.status, 201);
    assert.equal(typeof authenticatedSupport.body.caseId, "string");

    const supportPath = path.join(tempDir, "db.local.support-cases.json");
    const supportPayload = JSON.parse(await readFile(supportPath, "utf8")) as {
      cases: Array<{ id: string; userId: string; message: string }>;
    };
    assert.equal(supportPayload.cases.some((entry) => entry.id === publicSupport.body.caseId), true);
    assert.equal(
      supportPayload.cases.some(
        (entry) => entry.id === authenticatedSupport.body.caseId && entry.userId === "approved_enterprise_user",
      ),
      true,
    );

    const logout = await apiRequest("/web/auth/logout", { method: "POST" }, webToken);
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.body, { ok: true });
    assert.equal((await apiRequest("/web/auth/session", undefined, webToken)).status, 401);
    assert.equal((await apiRequest("/web/auth/logout", { method: "POST" }, webToken)).status, 401);
  } finally {
    setPostCommitAuditFailureForTest(null);
  }
});

test("hostile existing-user onboarding leaves durable account state and the current token unchanged until OTP succeeds", async () => {
  const before = await readDb();
  const beforeUser = before.users.find((entry) => entry.id === "approved_enterprise_user");
  const beforeToken = before.mobileAuthTokens.find((entry) => entry.userId === "approved_enterprise_user");
  assert.ok(beforeUser);
  assert.ok(beforeToken);

  const { result: onboarded, code } = await captureVerificationCode(() =>
    apiRequest("/mobile/onboard", {
      method: "POST",
      body: JSON.stringify({
        email: "approved@example.test",
        firstName: "Hostile",
        lastName: "Mutation",
        timezone: "America/New_York",
        joinCode: "REVIEW20",
      }),
    })
  );
  assert.equal(onboarded.status, 200);
  assert.equal(onboarded.body.verificationRequired, true);

  const pending = await readDb();
  const pendingUser = pending.users.find((entry) => entry.id === "approved_enterprise_user");
  const pendingToken = pending.mobileAuthTokens.find((entry) => entry.userId === "approved_enterprise_user");
  assert.equal(pendingUser?.emailVerifiedAt, beforeUser.emailVerifiedAt);
  assert.equal(pendingUser?.timezone, beforeUser.timezone);
  assert.equal(pendingUser?.firstName, beforeUser.firstName);
  assert.equal(pendingUser?.lastName, beforeUser.lastName);
  assert.equal(pendingUser?.updatedAt, beforeUser.updatedAt);
  assert.equal(pendingToken?.tokenHash, beforeToken.tokenHash);

  const currentTokenStillWorks = await apiRequest(
    "/mobile/users/approved_enterprise_user/entitlements",
    undefined,
    APPROVED_EXISTING_TOKEN
  );
  assert.equal(currentTokenStillWorks.status, 200);

  const verified = await verify(
    "approved_enterprise_user",
    code,
    onboarded.body.authToken,
    { joinCode: "REVIEW20" }
  );
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.firstName, "Hostile");
  assert.equal(verified.body.user.lastName, "Mutation");
  assert.equal(verified.body.user.timezone, "America/New_York");
  assert.notEqual(verified.body.authToken, onboarded.body.authToken);

  const oldTokenDeniedAfterSuccess = await apiRequest(
    "/mobile/users/approved_enterprise_user/entitlements",
    undefined,
    APPROVED_EXISTING_TOKEN
  );
  assert.equal(oldTokenDeniedAfterSuccess.status, 401);
  const finalTokenWorks = await apiRequest(
    "/mobile/users/approved_enterprise_user/entitlements",
    undefined,
    verified.body.authToken
  );
  assert.equal(finalTokenWorks.status, 200);
});

test("reviewer fixed code requires the correct interim token and follows the normal success path", async () => {
  const reviewerOnboard = await captureVerificationCode(() =>
    onboard(`  ${REVIEWER_EMAIL.toUpperCase()}  `, { joinCode: "REVIEW20" })
  );
  assert.equal(reviewerOnboard.result.status, 201);
  reviewerUserId = reviewerOnboard.result.body.user.id;
  const interimToken = reviewerOnboard.result.body.authToken as string;
  const before = reviewerOnboard.result.body.user as UserProfile;

  const noToken = await verify(reviewerUserId, REVIEWER_CODE, undefined, { joinCode: "REVIEW20" });
  assert.equal(noToken.status, 401);

  const attacker = await captureVerificationCode(() => onboard("wrong-token@example.test"));
  const wrongToken = await verify(
    reviewerUserId,
    REVIEWER_CODE,
    attacker.result.body.authToken,
    { joinCode: "REVIEW20" }
  );
  assert.equal(wrongToken.status, 401);

  const verificationLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => verificationLogs.push(args.map(String).join(" "));
  let verified;
  try {
    verified = await verify(reviewerUserId, REVIEWER_CODE, interimToken, { joinCode: "REVIEW20" });
  } finally {
    console.log = originalLog;
  }

  assert.equal(verified.status, 200);
  assert.deepEqual(Object.keys(verified.body).sort(), normalResponseKeys);
  assert.equal(verificationLogs.join("\n").includes(REVIEWER_CODE), false);
  reviewerNormalToken = verified.body.authToken;
  assert.notEqual(reviewerNormalToken, interimToken);

  const after = verified.body.user as UserProfile;
  for (const field of ["accountType", "tier", "orgId", "orgRole", "isPlatformAdmin", "isSuperUser"] as const) {
    assert.equal(after[field], before[field], `reviewer verification changed ${field}`);
  }

  const oldTokenDenied = await apiRequest(`/mobile/users/${reviewerUserId}/entitlements`, undefined, interimToken);
  assert.equal(oldTokenDenied.status, 401);
  const rotatedTokenAllowed = await apiRequest(`/mobile/users/${reviewerUserId}/entitlements`, undefined, reviewerNormalToken);
  assert.equal(rotatedTokenAllowed.status, 200);

  const db = await readDb();
  const reviewerChallenges = db.emailVerifications.filter((entry) => entry.userId === reviewerUserId);
  assert.ok(reviewerChallenges.some((entry) => entry.consumedAt !== null));
  const requests = db.enterpriseJoinRequests.filter((entry) => entry.userId === reviewerUserId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.status, "pending");
  assert.equal(db.users.find((entry) => entry.id === reviewerUserId)?.orgId, null);
});

test("reviewer account can still use a newly generated normal OTP and reuses its pending request", async () => {
  const { result: onboarded, code } = await captureVerificationCode(() =>
    onboard(REVIEWER_EMAIL, { joinCode: "REVIEW20" })
  );
  assert.equal(onboarded.status, 200);
  assert.equal(onboarded.body.verificationRequired, true);

  const verificationLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => verificationLogs.push(args.map(String).join(" "));
  let verified;
  try {
    verified = await verify(reviewerUserId, code, onboarded.body.authToken, { joinCode: "REVIEW20" });
  } finally {
    console.log = originalLog;
  }
  assert.equal(verified.status, 200);
  assert.equal(verificationLogs.join("\n").includes(code), false);
  assert.equal(verificationLogs.join("\n").includes(REVIEWER_CODE), false);
  assert.deepEqual(Object.keys(verified.body).sort(), normalResponseKeys);
  assert.notEqual(verified.body.authToken, onboarded.body.authToken);
  reviewerNormalToken = verified.body.authToken;

  const db = await readDb();
  assert.equal(db.enterpriseJoinRequests.filter((entry) => entry.userId === reviewerUserId).length, 1);
});

test("mobile settings reject changed email atomically while unchanged email still permits timezone updates", async () => {
  const setup = await captureVerificationCode(() => onboard("settings-security@example.test"));
  const settingsUserId = setup.result.body.user.id as string;
  const settingsVerified = await verify(settingsUserId, setup.code, setup.result.body.authToken);
  assert.equal(settingsVerified.status, 200);
  const settingsToken = settingsVerified.body.authToken as string;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const before = await readDb();
  const beforeUser = before.users.find((entry) => entry.id === settingsUserId);
  const beforeVerificationCount = before.emailVerifications.length;
  assert.ok(beforeUser);

  const rejected = await apiRequest(`/mobile/users/${settingsUserId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      email: "attacker-controlled@example.test",
      timezone: "America/New_York",
    }),
  }, settingsToken);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "mobile_email_change_disabled");

  const afterRejected = await readDb();
  const unchangedUser = afterRejected.users.find((entry) => entry.id === settingsUserId);
  assert.equal(unchangedUser?.email, beforeUser.email);
  assert.equal(unchangedUser?.emailVerifiedAt, beforeUser.emailVerifiedAt);
  assert.equal(unchangedUser?.pendingTimezone, beforeUser.pendingTimezone);
  assert.equal(afterRejected.emailVerifications.length, beforeVerificationCount);
  assert.equal(
    afterRejected.emailVerifications.some((entry) => entry.email === "attacker-controlled@example.test"),
    false
  );

  const allowed = await apiRequest(`/mobile/users/${settingsUserId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      email: beforeUser.email,
      timezone: "America/New_York",
    }),
  }, settingsToken);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.email, beforeUser.email);
  assert.equal(allowed.body.pendingTimezone, "America/New_York");
});

test("reviewer fixed code is isolated from dashboard and platform-admin authentication", async () => {
  const dashboard = await apiRequest("/web/auth/verify-code", {
    method: "POST",
    body: JSON.stringify({ email: REVIEWER_EMAIL, code: REVIEWER_CODE }),
  });
  assert.equal(dashboard.status, 400);
  assert.equal(JSON.stringify(dashboard.body).includes("reviewer"), false);

  const platformAdmin = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: REVIEWER_CODE }),
  });
  assert.equal(platformAdmin.status, 401);
});

test("existing approved enterprise member remains approved after normal OTP re-verification", async () => {
  const { result: onboarded, code } = await captureVerificationCode(() =>
    onboard("approved@example.test", { joinCode: "REVIEW20" })
  );
  assert.equal(onboarded.status, 200);
  assert.equal(onboarded.body.verificationRequired, true);

  const verified = await verify("approved_enterprise_user", code, onboarded.body.authToken, { joinCode: "REVIEW20" });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.accountType, "enterprise");
  assert.equal(verified.body.user.tier, "enterprise");
  assert.equal(verified.body.user.orgId, "org_review_test");
  assert.equal(verified.body.user.orgRole, "user");

  const db = await readDb();
  assert.equal(db.enterpriseJoinRequests.some((entry) => entry.userId === "approved_enterprise_user"), false);
});

test("reviewer userId-only limiter aggregates verification attempts across source IPs", async () => {
  const reviewerOnboard = await captureVerificationCode(() => onboard(REVIEWER_EMAIL, { joinCode: "REVIEW20" }));
  const interimToken = reviewerOnboard.result.body.authToken as string;
  clearRateLimitsForTest();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await verify(reviewerUserId, "999999", interimToken, {
      joinCode: "REVIEW20",
      forwardedFor: `198.51.100.${attempt + 1}`,
    });
    assert.equal(result.status, 400);
  }

  const limited = await verify(reviewerUserId, "999999", interimToken, {
    joinCode: "REVIEW20",
    forwardedFor: "203.0.113.250",
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "Too many requests. Please wait and retry.");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(JSON.stringify(limited.body).includes("reviewer"), false);
});

test("normal users are not subject to reviewer limiter while existing IP:userId limiting remains active", async () => {
  const normalOnboard = await captureVerificationCode(() => onboard("normal-rate@example.test"));
  const userId = normalOnboard.result.body.user.id as string;
  const interimToken = normalOnboard.result.body.authToken as string;

  clearRateLimitsForTest();
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const result = await verify(userId, "999999", interimToken, {
      forwardedFor: `192.0.2.${attempt + 1}`,
    });
    assert.equal(result.status, 400);
  }

  clearRateLimitsForTest();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await verify(userId, "999999", interimToken, { forwardedFor: "198.51.100.200" });
    assert.equal(result.status, 400);
  }
  const ipLimited = await verify(userId, "999999", interimToken, { forwardedFor: "198.51.100.200" });
  assert.equal(ipLimited.status, 429);
  assert.equal(ipLimited.body.error, "Too many requests. Please wait and retry.");
});

test("reviewer and submitted codes are absent from persisted state and verification logs", async () => {
  const fileNames = await readdir(tempDir);
  const persistedText = (
    await Promise.all(fileNames.map(async (fileName) => {
      try {
        return await readFile(path.join(tempDir, fileName), "utf8");
      } catch {
        return "";
      }
    }))
  ).join("\n");

  assert.equal(persistedText.includes(REVIEWER_CODE), false);
  assert.equal(persistedText.includes("999999"), false);
});
