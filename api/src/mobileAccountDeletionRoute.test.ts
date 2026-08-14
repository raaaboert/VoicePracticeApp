import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { type ApiDatabase, createDefaultConfig, type EnterpriseOrg, type UserProfile } from "@voicepractice/shared";

const NOW = "2026-08-14T18:00:00.000Z";
const MOBILE_TOKEN_SECRET = "mobile_account_deletion_route_secret";
const TOKEN_A = "delete_token_a";
const TOKEN_B = "delete_token_b";
const EMAIL_A = "delete-me@example.test";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let setDeletionFailure: (error: Error | null) => void;

function hashToken(token: string): string {
  return crypto.createHmac("sha256", MOBILE_TOKEN_SECRET).update(token).digest("hex");
}

function org(id: string): EnterpriseOrg {
  return {
    id,
    name: `Organization ${id}`,
    status: "active",
    contactName: "Organization Owner",
    contactEmail: `owner-${id}@example.test`,
    emailDomain: null,
    joinCode: `JOIN-${id}`,
    activeIndustries: ["people_management"],
    dailySecondsQuota: 3600,
    perUserDailySecondsCap: 1800,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 1000,
    renewalTotalUsd: 1000,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: false,
    customScenarios: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function user(id: string, email: string, orgId: string, employeeId: string): UserProfile {
  return {
    id,
    email,
    firstName: id === "user_a" ? "Delete" : "Keep",
    lastName: "Person",
    employeeId,
    managerUserId: null,
    emailVerifiedAt: NOW,
    dashboardAccessEnabled: true,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId,
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

function storagePath(suffix: string): string {
  const parsed = path.parse(dbPath);
  return path.join(parsed.dir, `${parsed.name}.${suffix}${parsed.ext}`);
}

async function request(pathname: string, init?: RequestInit, token?: string) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-account-deletion-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  const database: ApiDatabase = {
    config: createDefaultConfig(NOW),
    users: [user("user_a", EMAIL_A, "org_a", "EMP-A"), user("user_b", "keep@example.test", "org_b", "EMP-B")],
    orgs: [org("org_a"), org("org_b")],
    orgDivisions: [],
    orgTrainings: [],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [
      { id: "assignment_a", trainingPackId: "pack_a", orgId: "org_a", userId: "user_a", active: true, assignedAt: NOW, assignedByUserId: "user_a", requiredScenarioIds: ["scenario_a"], completionRule: "scored_required_scenarios_v1", startedAt: null, completedAt: null, createdAt: NOW, updatedAt: NOW },
      { id: "assignment_b", trainingPackId: "pack_b", orgId: "org_b", userId: "user_b", active: true, assignedAt: NOW, assignedByUserId: "user_a", requiredScenarioIds: ["scenario_b"], completionRule: "scored_required_scenarios_v1", startedAt: null, completedAt: null, createdAt: NOW, updatedAt: NOW },
    ],
    usageSessions: [],
    mobileAuthTokens: [
      { userId: "user_a", tokenHash: hashToken(TOKEN_A), createdAt: NOW, updatedAt: NOW },
      { userId: "user_b", tokenHash: hashToken(TOKEN_B), createdAt: NOW, updatedAt: NOW },
    ],
    emailVerifications: [{ id: "verify_a", userId: "user_a", email: EMAIL_A, codeHash: "secret-code-hash", createdAt: NOW, expiresAt: "2026-08-15T18:00:00.000Z", consumedAt: null }],
    webAuthChallenges: [{ id: "challenge_a", userId: "user_a", email: EMAIL_A, challengeType: "sign_in", codeHash: "challenge-hash", createdAt: NOW, expiresAt: "2026-08-15T18:00:00.000Z", consumedAt: null }],
    enterpriseJoinRequests: [{ id: "join_a", userId: "user_a", email: EMAIL_A, emailDomain: "example.test", orgId: "org_a", orgNameSnapshot: "Organization org_a", joinCodeSnapshot: "JOIN-org_a", status: "pending", createdAt: NOW, expiresAt: "2026-08-21T18:00:00.000Z", updatedAt: NOW, decidedAt: null, decidedByUserId: null, decisionReason: null }],
    appStateMigrations: {},
    admin: { passwordHash: null, activeSessionIds: [] },
  };
  await writeFile(dbPath, JSON.stringify(database, null, 2), "utf8");
  await writeFile(storagePath("usage-sessions"), JSON.stringify({ records: [
    { id: "usage_a", userId: "user_a", orgId: "org_a", segmentId: "people_management", scenarioId: "scenario_a", startedAt: NOW, endedAt: NOW, rawDurationSeconds: 61, billedSecondsAdded: 90, createdAt: NOW },
    { id: "usage_b", userId: "user_b", orgId: "org_b", segmentId: "people_management", scenarioId: "scenario_b", startedAt: NOW, endedAt: NOW, rawDurationSeconds: 31, billedSecondsAdded: 60, createdAt: NOW },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("simulation-sessions"), JSON.stringify({ records: [
    { simulationSessionId: "sim_a", userId: "user_a", orgId: "org_a", segmentId: "people_management", scenarioId: "scenario_a", serverStartedAt: NOW, lastSeenAt: NOW, status: "usage_recorded", usageRecordedAt: NOW, usageSessionRecordId: "usage_a" },
    { simulationSessionId: "sim_b", userId: "user_b", orgId: "org_b", segmentId: "people_management", scenarioId: "scenario_b", serverStartedAt: NOW, lastSeenAt: NOW, status: "usage_recorded", usageRecordedAt: NOW, usageSessionRecordId: "usage_b" },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("score-records"), JSON.stringify({ records: [
    { id: "score_a", simulationSessionId: "sim_a", userId: "user_a", orgId: "org_a", segmentId: "people_management", scenarioId: "scenario_a", startedAt: NOW, endedAt: NOW, overallScore: 80, persuasion: 80, clarity: 80, empathy: 80, assertiveness: 80, summary: `Private summary for ${EMAIL_A}`, coachingArtifact: { strengths: ["Private strength"], improvementAreas: [], coachingPriority: null }, normalizedCoachingThemes: { strengths: [{ id: "private", label: "Private" }], improvementAreas: [], coachingPriority: null }, createdAt: NOW },
    { id: "score_b", simulationSessionId: "sim_b", userId: "user_b", orgId: "org_b", segmentId: "people_management", scenarioId: "scenario_b", startedAt: NOW, endedAt: NOW, overallScore: 90, persuasion: 90, clarity: 90, empathy: 90, assertiveness: 90, summary: "Keep summary", createdAt: NOW },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("ai-usage-events"), JSON.stringify({ events: [
    { id: "ai_a", kind: "turn", userId: "user_a", orgId: "org_a", segmentId: "people_management", scenarioId: "scenario_a", model: "test-model", promptVersion: "test", rubricVersion: null, inputTokens: 10, outputTokens: 5, totalTokens: 15, createdAt: NOW },
    { id: "ai_b", kind: "turn", userId: "user_b", orgId: "org_b", segmentId: "people_management", scenarioId: "scenario_b", model: "test-model", promptVersion: "test", rubricVersion: null, inputTokens: 20, outputTokens: 10, totalTokens: 30, createdAt: NOW },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("support-cases"), JSON.stringify({ cases: [
    { id: "case_a", status: "open", userId: "user_a", orgId: "org_a", segmentId: null, scenarioId: null, message: `Help ${EMAIL_A}`, transcriptEncrypted: "encrypted-private-transcript", transcriptExpiresAt: "2026-08-15T18:00:00.000Z", transcriptFileName: "private.txt", transcriptMeta: null, createdAt: NOW, updatedAt: NOW },
    { id: "case_b", status: "open", userId: "user_b", orgId: "org_b", segmentId: null, scenarioId: null, message: "Keep support", transcriptEncrypted: null, transcriptExpiresAt: null, transcriptFileName: null, transcriptMeta: null, createdAt: NOW, updatedAt: NOW },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("web-auth-sessions"), JSON.stringify({ sessions: [
    { sessionId: "web_a", userId: "user_a", accessType: "dashboard", orgId: "org_a", createdAt: NOW, updatedAt: NOW, lastSeenAt: NOW, expiresAt: "2026-08-15T18:00:00.000Z", createdUserAgent: null, lastSeenUserAgent: null, createdIp: null, lastSeenIp: null },
    { sessionId: "web_b", userId: "user_b", accessType: "dashboard", orgId: "org_b", createdAt: NOW, updatedAt: NOW, lastSeenAt: NOW, expiresAt: "2026-08-15T18:00:00.000Z", createdUserAgent: null, lastSeenUserAgent: null, createdIp: null, lastSeenIp: null },
  ] }, null, 2), "utf8");
  await writeFile(storagePath("audit-events"), JSON.stringify({ events: [
    { id: "audit_a", actorType: "mobile_user", actorId: "user_a", action: "profile.updated", orgId: "org_a", userId: "user_a", message: `Updated ${EMAIL_A}`, metadata: { email: EMAIL_A, firstName: "Delete" }, createdAt: NOW },
  ] }, null, 2), "utf8");

  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "account-deletion-admin-password";
  process.env.ADMIN_TOKEN_SECRET = "account-deletion-admin-secret";
  process.env.WEB_AUTH_TOKEN_SECRET = "account-deletion-web-token-secret-32-characters";
  process.env.WEB_AUTH_CODE_SECRET = "account-deletion-web-code-secret-32-characters";
  process.env.SUPPORT_TRANSCRIPT_SECRET = "account-deletion-support-secret-32-characters";
  process.env.AUTH_CODE_DELIVERY_PROVIDER = "log_only";
  delete process.env.DATABASE_URL;

  const imported = await import("./index.js");
  setDeletionFailure = imported.setMobileAccountDeletionFailureForTest;
  server = await new Promise<Server>((resolve) => {
    const started = imported.app.listen(0, () => resolve(started));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("self-delete rejects unauthenticated and cross-user requests", async () => {
  assert.equal((await request("/mobile/users/user_a", { method: "DELETE" })).status, 401);
  assert.equal((await request("/mobile/users/user_b", { method: "DELETE" }, TOKEN_A)).status, 403);
  assert.equal((await request("/mobile/users/user_a", undefined, TOKEN_A)).status, 200);
});

test("a failed deletion remains logged in and retryable", async () => {
  setDeletionFailure(new Error("simulated deletion failure"));
  assert.equal((await request("/mobile/users/user_a", { method: "DELETE" }, TOKEN_A)).status, 500);
  setDeletionFailure(null);
  assert.equal((await request("/mobile/users/user_a", undefined, TOKEN_A)).status, 200);
});

test("self-delete removes identity and de-identifies retained organization history", async () => {
  const deleted = await request("/mobile/users/user_a", { method: "DELETE" }, TOKEN_A);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true, alreadyDeleted: false });

  const database = JSON.parse(await readFile(dbPath, "utf8")) as ApiDatabase;
  assert.equal(database.users.some((entry) => entry.id === "user_a"), false);
  assert.equal(database.users.some((entry) => entry.id === "user_b" && entry.orgId === "org_b"), true);
  assert.equal(database.mobileAuthTokens.some((entry) => entry.userId === "user_a"), false);
  assert.equal(database.emailVerifications.some((entry) => entry.userId === "user_a"), false);
  assert.equal(database.webAuthChallenges.some((entry) => entry.userId === "user_a"), false);
  assert.equal(database.enterpriseJoinRequests.some((entry) => entry.userId === "user_a"), false);
  assert.equal(database.trainingPackAssignments.some((entry) => entry.userId === "user_a"), false);
  assert.equal(database.trainingPackAssignments.find((entry) => entry.userId === "user_b")?.assignedByUserId, null);

  const usage = JSON.parse(await readFile(storagePath("usage-sessions"), "utf8")) as { records: Array<Record<string, any>> };
  const simulations = JSON.parse(await readFile(storagePath("simulation-sessions"), "utf8")) as { records: Array<Record<string, any>> };
  const scores = JSON.parse(await readFile(storagePath("score-records"), "utf8")) as { records: Array<Record<string, any>> };
  const ai = JSON.parse(await readFile(storagePath("ai-usage-events"), "utf8")) as { events: Array<Record<string, any>> };
  const support = JSON.parse(await readFile(storagePath("support-cases"), "utf8")) as { cases: Array<Record<string, any>> };
  const web = JSON.parse(await readFile(storagePath("web-auth-sessions"), "utf8")) as { sessions: Array<Record<string, any>> };
  const audit = JSON.parse(await readFile(storagePath("audit-events"), "utf8")) as { events: Array<Record<string, any>> };

  assert.equal(usage.records.length, 2);
  assert.equal(usage.records.find((entry) => entry.id === "usage_a")?.userId, "deleted_user");
  assert.equal(simulations.records.length, 2);
  assert.equal(simulations.records.find((entry) => entry.simulationSessionId === "sim_a")?.userId, "deleted_user");
  assert.equal(scores.records.length, 2);
  const deletedScore = scores.records.find((entry) => entry.id === "score_a");
  assert.equal(deletedScore?.userId, "deleted_user");
  assert.equal(deletedScore?.summary, undefined);
  assert.equal(deletedScore?.coachingArtifact, null);
  assert.equal(deletedScore?.normalizedCoachingThemes, null);
  assert.equal(ai.events.length, 2);
  assert.equal(ai.events.find((entry) => entry.id === "ai_a")?.userId, "deleted_user");
  assert.equal(support.cases.some((entry) => entry.userId === "user_a"), false);
  assert.equal(support.cases.some((entry) => entry.userId === "user_b"), true);
  assert.equal(web.sessions.some((entry) => entry.userId === "user_a"), false);
  assert.equal(web.sessions.some((entry) => entry.userId === "user_b"), true);
  assert.equal(audit.events.some((entry) => entry.userId === "user_a" || entry.actorId === "user_a"), false);

  const retainedText = JSON.stringify({ database, usage, simulations, scores, ai, support, web, audit });
  assert.doesNotMatch(retainedText, new RegExp(EMAIL_A, "i"));
  assert.doesNotMatch(retainedText, /"firstName":"Delete"/);
  assert.equal((await request("/mobile/users/user_b", undefined, TOKEN_A)).status, 401);
  assert.equal((await request("/mobile/users/user_b", undefined, TOKEN_B)).status, 200);
});

test("self-delete retry is idempotent and the same email can create a new account", async () => {
  const retry = await request("/mobile/users/user_a", { method: "DELETE" }, TOKEN_A);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, { deleted: true, alreadyDeleted: true });

  const onboarded = await request("/mobile/onboard", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL_A, firstName: "New", lastName: "Account", timezone: "America/Denver" }),
  });
  assert.equal(onboarded.status, 201);
  assert.notEqual(onboarded.body.user.id, "user_a");
  assert.equal(onboarded.body.user.email, EMAIL_A);
});
