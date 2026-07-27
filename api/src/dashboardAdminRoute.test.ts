import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  EnterpriseJoinRequestRecord,
  EnterpriseOrg,
  MobileAuthRecord,
  UserProfile
} from "@voicepractice/shared";

import { createWebAuthService } from "./services/webAuth.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";

const NOW = "2026-07-25T15:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_dashboard_admin_route_tests";
const WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_dashboard_admin_route_tests";
const WEB_AUTH_CODE_SECRET = "web_auth_code_secret_for_dashboard_admin_route_tests";
const ADMIN_BOOTSTRAP_PASSWORD = "dashboard_admin_route_admin_password";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let orgAdminToken: string;
let userAdminToken: string;
let regularDashboardToken: string;
let superToken: string;
let adminToken: string | null = null;

function hashMobileToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function buildMobileToken(userId: string, token: string): MobileAuthRecord {
  return {
    userId,
    tokenHash: hashMobileToken(token),
    createdAt: NOW,
    updatedAt: NOW
  };
}

function buildOrg(overrides: Partial<EnterpriseOrg> = {}): EnterpriseOrg {
  return {
    id: overrides.id ?? "org_1",
    name: overrides.name ?? "Acme Trial",
    status: overrides.status ?? "active",
    contactName: overrides.contactName ?? "Alex Admin",
    contactEmail: overrides.contactEmail ?? "alex@acme.example",
    emailDomain: overrides.emailDomain ?? "acme.example",
    joinCode: overrides.joinCode ?? "ACME2026",
    activeIndustries: overrides.activeIndustries ?? ["people_management"],
    dailySecondsQuota: overrides.dailySecondsQuota ?? 3600,
    perUserDailySecondsCap: overrides.perUserDailySecondsCap ?? 1800,
    pendingPerUserDailySecondsCap: overrides.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    contractSignedAt: overrides.contractSignedAt ?? NOW,
    monthlyMinutesAllotted: overrides.monthlyMinutesAllotted ?? 10_000,
    renewalTotalUsd: overrides.renewalTotalUsd ?? 1000,
    softLimitPercentTriggers: overrides.softLimitPercentTriggers ?? [80, 100],
    maxSimulationMinutes: overrides.maxSimulationMinutes ?? 20,
    divisionsEnabled: overrides.divisionsEnabled ?? false,
    customScenarios: overrides.customScenarios ?? [],
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
    ...overrides
  };
}

function buildUser(id: string, email: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email,
    employeeId: overrides.employeeId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt === undefined ? NOW : overrides.emailVerifiedAt,
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "America/Denver",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? NOW,
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW
  };
}

function buildJoinRequest(id: string, userId: string, email: string, orgId = "org_1"): EnterpriseJoinRequestRecord {
  return {
    id,
    userId,
    email,
    emailDomain: email.split("@")[1] ?? "",
    orgId,
    orgNameSnapshot: orgId === "org_1" ? "Acme Trial" : "Other Trial",
    joinCodeSnapshot: orgId === "org_1" ? "ACME2026" : "OTHER2026",
    status: "pending",
    createdAt: NOW,
    expiresAt: "2099-07-25T15:00:00.000Z",
    updatedAt: NOW,
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null
  };
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser("org_admin", "admin@acme.example", {
        orgRole: "org_admin",
        dashboardAccessEnabled: true,
        employeeId: "ADM-1",
      }),
      buildUser("org_admin_peer", "admin-peer@acme.example", {
        orgRole: "org_admin",
        employeeId: "ADM-2",
      }),
      buildUser("user_admin", "manager@acme.example", {
        orgRole: "user_admin",
        dashboardAccessEnabled: true,
        employeeId: "MGR-1",
      }),
      buildUser("eligible_user_admin", "eligible-manager@acme.example", {
        orgRole: "user_admin",
        employeeId: "MGR-2",
      }),
      buildUser("disabled_user_admin", "disabled-manager@acme.example", {
        orgRole: "user_admin",
        status: "disabled",
        employeeId: "MGR-D",
      }),
      buildUser("learner", "learner@acme.example", {
        orgRole: "user",
        employeeId: "EMP-1",
      }),
      buildUser("learner_status", "learner-status@acme.example", {
        orgRole: "user",
        employeeId: "EMP-S",
      }),
      buildUser("learner_atomic", "learner-atomic@acme.example", {
        orgRole: "user",
        employeeId: null,
      }),
      buildUser("regular_dashboard", "viewer@acme.example", {
        orgRole: "user",
        dashboardAccessEnabled: true,
      }),
      buildUser("other_org_admin", "admin@other.example", {
        orgId: "org_2",
        orgRole: "org_admin",
        dashboardAccessEnabled: true,
      }),
      buildUser("other_org_user", "learner@other.example", {
        orgId: "org_2",
        orgRole: "user",
        employeeId: "EMP-1",
      }),
      buildUser("gmail_join", "gmail.user@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("gmail_join_2", "gmail.two@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("pending_user", "pending@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("reject_user", "reject@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("gmail_invalid", "invalid.gmail@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("rate_limited", "rate.limit@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("other_pending", "other-pending@gmail.com", {
        accountType: "individual",
        tier: "free",
        orgId: null,
        orgRole: "user",
      }),
      buildUser("super_user", "super@peritio.test", {
        accountType: "individual",
        tier: "pro_plus",
        orgId: null,
        orgRole: "user",
        dashboardAccessEnabled: false,
        isPlatformAdmin: true,
        isSuperUser: true,
      }),
    ],
    orgs: [
      buildOrg(),
      buildOrg({
        id: "org_2",
        name: "Other Trial",
        contactEmail: "admin@other.example",
        emailDomain: "other.example",
        joinCode: "OTHER2026",
      })
    ],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      buildMobileToken("gmail_join", "token_gmail"),
      buildMobileToken("gmail_join_2", "token_gmail_2"),
      buildMobileToken("pending_user", "token_pending"),
      buildMobileToken("gmail_invalid", "token_gmail_invalid"),
      buildMobileToken("rate_limited", "token_rate_limited"),
      buildMobileToken("org_admin", "token_org_admin"),
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [
      buildJoinRequest("jr_pending", "pending_user", "pending@gmail.com"),
      buildJoinRequest("jr_reject", "reject_user", "reject@gmail.com"),
      buildJoinRequest("jr_mobile", "gmail_join_2", "gmail.two@gmail.com"),
      buildJoinRequest("jr_other", "other_pending", "other-pending@gmail.com", "org_2"),
    ],
    admin: {
      passwordHash: null,
      activeSessionIds: []
    }
  };
}

async function readDb(): Promise<ApiDatabase> {
  return JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
}

function auditEventsPath(): string {
  const parsed = path.parse(dbPath);
  const extension = parsed.ext || ".json";
  return path.join(parsed.dir, `${parsed.name}.audit-events${extension}`);
}

async function readAuditMetadataJson(): Promise<string> {
  const payload = JSON.parse(await readFile(auditEventsPath(), "utf8")) as {
    events?: Array<{ metadata?: unknown }>;
  };
  return JSON.stringify((payload.events ?? []).map((event) => event.metadata ?? null));
}

async function readUser(userId: string): Promise<UserProfile | undefined> {
  const db = await readDb();
  return db.users.find((user) => user.id === userId);
}

async function waitForWriteToSettle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function waitForPersistedUserState(
  userId: string,
  predicate: (user: UserProfile | undefined) => boolean
): Promise<UserProfile | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const user = await readUser(userId);
    if (predicate(user)) {
      return user;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return await readUser(userId);
}

async function waitForPersistedUserOrg(userId: string, orgId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const db = await readDb();
    if (db.users.find((user) => user.id === userId)?.orgId === orgId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const db = await readDb();
  assert.equal(db.users.find((user) => user.id === userId)?.orgId, orgId);
}

async function seedStores(): Promise<void> {
  const db = buildDatabase();
  await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");

  const webAuthService = createWebAuthService({
    tokenSecret: WEB_AUTH_TOKEN_SECRET,
    codeSecret: WEB_AUTH_CODE_SECRET,
  });
  const webAuthStore = createWebAuthSessionStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1,
  });
  await webAuthStore.initialize();

  const issue = async (userId: string, accessType: "customer_dashboard_user" | "super_user", orgId: string | null) => {
    const user = db.users.find((entry) => entry.id === userId);
    assert.ok(user);
    const issued = webAuthService.issueSession(user, 14 * 24 * 60, new Date(NOW), { accessType, orgId });
    await webAuthStore.saveSession(issued.record);
    return issued.token;
  };

  orgAdminToken = await issue("org_admin", "customer_dashboard_user", "org_1");
  userAdminToken = await issue("user_admin", "customer_dashboard_user", "org_1");
  regularDashboardToken = await issue("regular_dashboard", "customer_dashboard_user", "org_1");
  superToken = await issue("super_user", "super_user", null);
}

async function dashboardRequest(pathname: string, token = orgAdminToken, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function mobileRequest(pathname: string, token: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function getAdminToken(): Promise<string> {
  if (adminToken) {
    return adminToken;
  }
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_BOOTSTRAP_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { token: string };
  adminToken = payload.token;
  return adminToken;
}

async function adminRequest(pathname: string, init?: RequestInit) {
  const token = await getAdminToken();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "dashboard-admin-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.PORT = "4102";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_dashboard_admin_route_tests";
  process.env.ADMIN_BOOTSTRAP_PASSWORD = ADMIN_BOOTSTRAP_PASSWORD;
  process.env.WEB_AUTH_TOKEN_SECRET = WEB_AUTH_TOKEN_SECRET;
  process.env.WEB_AUTH_CODE_SECRET = WEB_AUTH_CODE_SECRET;
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_transcript_secret_for_dashboard_admin_route_tests";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  delete process.env.DATABASE_URL;

  await seedStores();

  const imported = await import("./index.js");
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dashboard admin users are tenant-scoped and regular users cannot access Admin", async () => {
  const denied = await dashboardRequest("/dashboard/admin/users", regularDashboardToken);
  assert.equal(denied.status, 403);

  const result = await dashboardRequest("/dashboard/admin/users");
  assert.equal(result.status, 200);
  const users = result.body.users as Array<{ userId: string; employeeId: string | null }>;
  assert.equal(users.some((user) => user.userId === "learner"), true);
  assert.equal(users.some((user) => user.userId === "other_org_user"), false);
  assert.equal(users.find((user) => user.userId === "learner")?.employeeId, "EMP-1");
});

test("dashboard admin role boundaries block user-admin access to administrators", async () => {
  const userAdminDeactivateOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateOrgAdmin.status, 403);
  assert.equal((await readUser("org_admin_peer"))?.status, "active");

  const userAdminEditOrgAdmin = await dashboardRequest("/dashboard/admin/users/org_admin_peer", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "UA-NOPE" }),
  });
  assert.equal(userAdminEditOrgAdmin.status, 403);
  assert.equal((await readUser("org_admin_peer"))?.employeeId, "ADM-2");

  const userAdminDeactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(userAdminDeactivateUserAdmin.status, 403);
  assert.equal((await readUser("eligible_user_admin"))?.status, "active");

  const userAdminReactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/disabled_user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(userAdminReactivateUserAdmin.status, 403);
  assert.equal((await readUser("disabled_user_admin"))?.status, "disabled");

  const orgAdminDeactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(orgAdminDeactivateUserAdmin.status, 200);
  assert.equal((orgAdminDeactivateUserAdmin.body.user as { status?: string }).status, "disabled");

  const orgAdminReactivateUserAdmin = await dashboardRequest("/dashboard/admin/users/eligible_user_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(orgAdminReactivateUserAdmin.status, 200);
  assert.equal((orgAdminReactivateUserAdmin.body.user as { status?: string }).status, "active");

  const orgAdminDeactivateUser = await dashboardRequest("/dashboard/admin/users/learner_status", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(orgAdminDeactivateUser.status, 200);
  assert.equal((orgAdminDeactivateUser.body.user as { status?: string }).status, "disabled");

  const orgAdminReactivateUser = await dashboardRequest("/dashboard/admin/users/learner_status", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(orgAdminReactivateUser.status, 200);
  assert.equal((orgAdminReactivateUser.body.user as { status?: string }).status, "active");

  const selfDeactivation = await dashboardRequest("/dashboard/admin/users/org_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(selfDeactivation.status, 403);
  assert.equal((await readUser("org_admin"))?.status, "active");
});

test("Employee ID edits support clear, conflict, CSV export, and user-admin role limits", async () => {
  const updated = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "  EMP-2  " }),
  });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.user as { employeeId?: string }).employeeId, "EMP-2");

  const conflict = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "MGR-1" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "employee_id_conflict");

  const forbidden = await dashboardRequest("/dashboard/admin/users/user_admin", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(forbidden.status, 403);

  const disabled = await dashboardRequest("/dashboard/admin/users/learner", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((disabled.body.user as { status?: string }).status, "disabled");

  const exported = await dashboardRequest("/dashboard/admin/users/export");
  assert.equal(exported.status, 200);
  const rows = exported.body.rows as Array<{ employeeId: string; email: string; role: string; status: string }>;
  assert.equal(rows.some((row) => row.email === "learner@acme.example" && row.employeeId === "EMP-2"), true);
  assert.equal(rows.some((row) => row.email === "learner@other.example"), false);

  const auditMetadata = await readAuditMetadataJson();
  assert.equal(auditMetadata.includes("EMP-2"), false);
  assert.equal(auditMetadata.includes("employeeIdChanged"), true);
});

test("dashboard admin user patching is atomic across Employee ID and status", async () => {
  const selfStatusDenied = await dashboardRequest("/dashboard/admin/users/org_admin", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "ADM-SELF-NEW", status: "disabled" }),
  });
  assert.equal(selfStatusDenied.status, 403);
  await waitForWriteToSettle();
  const orgAdmin = await readUser("org_admin");
  assert.equal(orgAdmin?.employeeId, "ADM-1");
  assert.equal(orgAdmin?.status, "active");

  const conflictWithValidStatus = await dashboardRequest("/dashboard/admin/users/learner_atomic", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "MGR-1", status: "disabled" }),
  });
  assert.equal(conflictWithValidStatus.status, 409);
  await waitForWriteToSettle();
  const afterConflict = await readUser("learner_atomic");
  assert.equal(afterConflict?.employeeId, null);
  assert.equal(afterConflict?.status, "active");

  const successfulCombined = await dashboardRequest("/dashboard/admin/users/learner_atomic", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "AT-1", status: "disabled" }),
  });
  assert.equal(successfulCombined.status, 200);
  const afterSuccess = await waitForPersistedUserState(
    "learner_atomic",
    (user) => user?.employeeId === "AT-1" && user.status === "disabled"
  );
  assert.equal(afterSuccess?.employeeId, "AT-1");
  assert.equal(afterSuccess?.status, "disabled");
});

test("dashboard admin write routes reject cross-tenant manipulation attempts", async () => {
  const crossTenantUserPatch = await dashboardRequest("/dashboard/admin/users/other_org_user?orgId=org_2", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(crossTenantUserPatch.status, 404);
  assert.equal((await readUser("other_org_user"))?.status, "active");

  const crossTenantApproval = await dashboardRequest("/dashboard/admin/access-requests/jr_other?orgId=org_2", orgAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(crossTenantApproval.status, 404);
  const db = await readDb();
  assert.equal(db.enterpriseJoinRequests.find((request) => request.id === "jr_other")?.status, "pending");
});

test("platform user audit metadata does not serialize raw Employee IDs", async () => {
  const created = await adminRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      email: "platform-created@acme.example",
      tier: "enterprise",
      accountType: "enterprise",
      orgId: "org_1",
      orgRole: "user",
      employeeId: "PLAT-RAW-1",
    }),
  });
  assert.equal(created.status, 201);
  const createdUserId = (created.body as { id?: string }).id;
  assert.ok(createdUserId);

  const updated = await adminRequest(`/users/${createdUserId}`, {
    method: "PATCH",
    body: JSON.stringify({ employeeId: "PLAT-RAW-2" }),
  });
  assert.equal(updated.status, 200);

  const auditMetadata = await readAuditMetadataJson();
  assert.equal(auditMetadata.includes("PLAT-RAW-1"), false);
  assert.equal(auditMetadata.includes("PLAT-RAW-2"), false);
  assert.equal(auditMetadata.includes("employeeIdPresent"), true);
  assert.equal(auditMetadata.includes("employeeIdChanged"), true);
});

test("company-code join requests accept Gmail, are duplicate-safe, and still require approval", async () => {
  const created = await mobileRequest("/mobile/users/gmail_join/org-access-requests", "token_gmail", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  assert.equal(created.status, 201);

  const duplicate = await mobileRequest("/mobile/users/gmail_join/org-access-requests", "token_gmail", {
    method: "POST",
    body: JSON.stringify({ joinCode: "ACME2026" }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.created, false);

  const db = await readDb();
  const gmailUser = db.users.find((user) => user.id === "gmail_join");
  assert.equal(gmailUser?.accountType, "individual");
  assert.equal(gmailUser?.orgId, null);
});

test("company-code join requests reject invalid codes and rate-limit repeated attempts", async () => {
  const invalid = await mobileRequest("/mobile/users/gmail_invalid/org-access-requests", "token_gmail_invalid", {
    method: "POST",
    body: JSON.stringify({ joinCode: "NO-SUCH-CODE" }),
  });
  assert.equal(invalid.status, 404);
  assert.equal((await readUser("gmail_invalid"))?.orgId, null);

  let latestStatus = 0;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const result = await mobileRequest("/mobile/users/rate_limited/org-access-requests", "token_rate_limited", {
      method: "POST",
      body: JSON.stringify({ joinCode: `NOPE-${attempt}` }),
    });
    latestStatus = result.status;
    if (attempt < 20) {
      assert.equal(result.status, 404);
    }
  }
  assert.equal(latestStatus, 429);
  assert.equal((await readUser("rate_limited"))?.orgId, null);
});

test("dashboard and mobile approvals use the same pending-request transition", async () => {
  const approved = await dashboardRequest("/dashboard/admin/access-requests/jr_pending", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  });
  assert.equal(approved.status, 200);
  assert.equal((approved.body.request as { status?: string }).status, "approved");

  const usersAfterApproval = await dashboardRequest("/dashboard/admin/users", userAdminToken);
  assert.equal(usersAfterApproval.status, 200);
  const users = usersAfterApproval.body.users as Array<{ userId: string; email: string; status: string; orgRole: string }>;
  assert.equal(
    users.some((user) =>
      user.userId === "pending_user" &&
      user.email === "pending@gmail.com" &&
      user.status === "active" &&
      user.orgRole === "user"
    ),
    true
  );

  const rejected = await dashboardRequest("/dashboard/admin/access-requests/jr_reject", userAdminToken, {
    method: "PATCH",
    body: JSON.stringify({ action: "reject", reason: "Not a trial user." }),
  });
  assert.equal(rejected.status, 200);
  assert.equal((rejected.body.request as { status?: string }).status, "rejected");
  assert.equal((await readUser("reject_user"))?.orgId, null);

  const mobileApproved = await mobileRequest(
    "/mobile/users/org_admin/admin/org/access-requests/jr_mobile",
    "token_org_admin",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "approve" }),
    }
  );
  assert.equal(mobileApproved.status, 200);
  assert.equal((mobileApproved.body.request as { status?: string }).status, "approved");

  await waitForPersistedUserOrg("pending_user", "org_1");
  await waitForPersistedUserOrg("gmail_join_2", "org_1");
});

test("super users need explicit organization context and final active org-admin deactivation is blocked", async () => {
  const aggregateDenied = await dashboardRequest("/dashboard/admin/users", superToken);
  assert.equal(aggregateDenied.status, 400);

  const scoped = await dashboardRequest("/dashboard/admin/users?orgId=org_2", superToken);
  assert.equal(scoped.status, 200);
  const scopedUsers = scoped.body.users as Array<{ userId: string }>;
  assert.deepEqual(scopedUsers.map((user) => user.userId).sort(), ["other_org_admin", "other_org_user"]);

  const finalAdminDenied = await dashboardRequest("/dashboard/admin/users/other_org_admin?orgId=org_2", superToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(finalAdminDenied.status, 403);
});
