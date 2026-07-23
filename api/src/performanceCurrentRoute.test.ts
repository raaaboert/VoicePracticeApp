import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  EnterpriseOrg,
  MobileAuthRecord,
  OrgTrainingRecord,
  OrgTrainingScenarioAttachmentRecord,
  PerformanceAuditEvent,
  PerformancePlan,
  PerformancePlanScopeItem,
  SimulationScoreRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

import { createPerformancePlanStore, PerformancePlanStore } from "./storage/performancePlanStore.js";
import { createScoreRecordStore } from "./storage/scoreRecordStore.js";
import { createUsageSessionStore } from "./storage/usageSessionStore.js";
import { createWebAuthSessionStore } from "./storage/webAuthSessionStore.js";
import { createWebAuthService } from "./services/webAuth.js";

const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_performance_route_tests";
const WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_performance_route_tests";
const WEB_AUTH_CODE_SECRET = "web_auth_code_secret_for_performance_route_tests";
const NOW = "2026-07-20T16:00:00.000Z";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let planStore: PerformancePlanStore;
let dashboardToken: string;
let dashboardViewerToken: string;
let platformDashboardToken: string;

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

function buildUser(id: string, email: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email,
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    divisionId: "division_a",
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
    ...overrides
  };
}

function buildOrg(overrides: Partial<EnterpriseOrg> = {}): EnterpriseOrg {
  return {
    id: "org_1",
    name: "Acme Learning",
    status: "active",
    contactName: "Pat Admin",
    contactEmail: "admin@example.com",
    emailDomain: "example.com",
    joinCode: "ACME2026",
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
    enableModularPromptArchitecture: false,
    divisionsEnabled: true,
    customScenarios: [
      {
        id: "custom_1",
        orgId: "org_1",
        segmentId: "manager",
        title: "Coaching Follow-up",
        summary: "Follow up with a teammate after a missed milestone.",
        description: "Practice a focused coaching conversation.",
        desiredOutcome: "Agree on the next concrete action.",
        aiRole: "team member",
        scoringGuidance: "Score coaching clarity.",
        applicableIndustryIds: ["people_management"],
        enabled: true,
        provenance: {
          sourceMode: "scratch",
          creationMethod: "manual"
        },
        createdBy: "dashboard_admin",
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function buildFocusTopic(): OrgTrainingRecord {
  return {
    id: "focus_topic_1",
    orgId: "org_1",
    name: "Manager Coaching",
    status: "active",
    description: "Focused coaching scenarios for managers.",
    divisionId: "division_a",
    createdAt: NOW,
    updatedAt: NOW
  };
}

function buildFocusTopicScenarioAttachment(): OrgTrainingScenarioAttachmentRecord {
  return {
    id: "focus_topic_scenario_1",
    orgId: "org_1",
    trainingId: "focus_topic_1",
    scenarioId: "custom_1",
    createdAt: NOW,
    updatedAt: NOW
  };
}

function buildDatabase(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    users: [
      buildUser("user_current", "current@example.com"),
      buildUser("user_empty", "empty@example.com"),
      buildUser("user_other", "other@example.com"),
      buildUser("user_expired", "expired@example.com"),
      buildUser("user_expired_cancel", "expired-cancel@example.com"),
      buildUser("user_expired_late", "expired-late@example.com"),
      buildUser("user_expired_create", "expired-create@example.com"),
      buildUser("user_manage", "manage@example.com"),
      buildUser("user_edit", "edit@example.com"),
      buildUser("user_self_created_edit", "self-created-edit@example.com"),
      buildUser("user_started_edit", "started-edit@example.com"),
      buildUser("user_authorized_active", "authorized-active@example.com"),
      buildUser("user_concurrent_duplicate", "concurrent-duplicate@example.com"),
      buildUser("user_concurrent_distinct", "concurrent-distinct@example.com"),
      buildUser("user_platform_target", "platform-target@example.com"),
      buildUser("user_inactive", "inactive@example.com", {
        status: "disabled"
      }),
      buildUser("user_inactive_division_b", "inactive-south@example.com", {
        status: "disabled",
        divisionId: "division_b"
      }),
      buildUser("dashboard_admin", "admin@example.com", {
        dashboardAccessEnabled: true,
        orgRole: "org_admin"
      }),
      buildUser("dashboard_viewer", "viewer@example.com", {
        dashboardAccessEnabled: true,
        orgRole: "user"
      }),
      buildUser("platform_admin", "platform-admin@peritio.ai", {
        accountType: "individual",
        orgId: null,
        divisionId: null,
        orgRole: "user",
        dashboardAccessEnabled: false,
        isSuperUser: true,
        isPlatformAdmin: true
      }),
      buildUser("user_other_org", "other-org@example.com", {
        orgId: "org_2",
        divisionId: null
      }),
      buildUser("user_other_org_inactive", "other-org-inactive@example.com", {
        orgId: "org_2",
        divisionId: null,
        status: "disabled"
      })
    ],
    orgs: [
      buildOrg(),
      buildOrg({
        id: "org_2",
        name: "Other Company",
        contactEmail: "owner@other.example.com",
        emailDomain: "other.example.com",
        joinCode: "OTHER2026",
        customScenarios: []
      })
    ],
    orgDivisions: [
      {
        id: "division_a",
        orgId: "org_1",
        name: "North",
        active: true,
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "division_b",
        orgId: "org_1",
        name: "South",
        active: true,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    orgTrainings: [buildFocusTopic()],
    orgTrainingPackAttachments: [],
    orgTrainingScenarioAttachments: [buildFocusTopicScenarioAttachment()],
    orgStandardScenarioDivisionAssignments: [],
    trainingPackAssignments: [],
    usageSessions: [],
    mobileAuthTokens: [
      buildMobileToken("user_current", "token_current"),
      buildMobileToken("user_empty", "token_empty"),
      buildMobileToken("user_other", "token_other"),
      buildMobileToken("user_expired", "token_expired"),
      buildMobileToken("user_expired_cancel", "token_expired_cancel"),
      buildMobileToken("user_manage", "token_manage"),
      buildMobileToken("user_self_created_edit", "token_self_created_edit"),
      buildMobileToken("user_inactive", "token_inactive")
    ],
    emailVerifications: [],
    webAuthChallenges: [],
    enterpriseJoinRequests: [],
    admin: {
      passwordHash: null,
      activeSessionIds: []
    }
  };
}

function buildPlan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  const planId = overrides.id ?? "perf_plan_current";
  const userId = overrides.userId ?? "user_current";
  return {
    id: planId,
    orgId: "org_1",
    userId,
    createdByActorType: "mobile_user",
    createdByActorId: userId,
    createdAt: overrides.createdAt ?? "2026-07-01T06:00:00.000Z",
    submittedAt: overrides.submittedAt ?? "2026-07-01T06:00:00.000Z",
    effectiveAt: overrides.effectiveAt ?? "2026-07-01T06:00:00.000Z",
    startDate: overrides.startDate ?? "2026-07-01",
    endDate: overrides.endDate ?? "2099-12-31",
    timeZone: "America/Denver",
    status: "active",
    completedAt: null,
    cancelledAt: null,
    cancelledByActorType: null,
    cancelledByActorId: null,
    cancellationReason: null,
    activityGoal: {
      enabled: true,
      metricType: "total_session_count",
      targetValue: 1
    },
    performanceGoal: {
      enabled: true,
      metricType: "target_average_score",
      targetScore: 80,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scope: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: [],
      selectedScenarioIds: ["scenario_1"],
      scenarios: [
        {
          scenarioId: "scenario_1",
          displayName: "Difficult Performance Review",
          source: "standard",
          segmentId: "manager",
          segmentLabel: "Manager",
          focusTopics: [],
          selectionSources: ["direct"]
        }
      ]
    },
    baseline: null,
    finalResult: null,
    updatedAt: overrides.updatedAt ?? "2026-07-01T06:00:00.000Z"
  };
}

function buildScopeItem(overrides: Partial<PerformancePlanScopeItem> = {}): PerformancePlanScopeItem {
  return {
    id: overrides.id ?? "perf_scope_current",
    planId: overrides.planId ?? "perf_plan_current",
    orgId: "org_1",
    userId: overrides.userId ?? "user_current",
    scenarioId: "scenario_1",
    scenarioDisplayName: "Difficult Performance Review",
    scenarioSource: "standard",
    segmentId: "manager",
    segmentLabel: "Manager",
    focusTopicId: null,
    focusTopicName: null,
    selectionSources: ["direct"],
    metadataSnapshot: {},
    createdAt: "2026-07-01T06:00:00.000Z"
  };
}

function buildAuditEvent(overrides: Partial<PerformanceAuditEvent> = {}): PerformanceAuditEvent {
  return {
    id: overrides.id ?? "perf_audit_current",
    planId: overrides.planId ?? "perf_plan_current",
    orgId: overrides.orgId ?? "org_1",
    userId: overrides.userId ?? "user_current",
    actorType: overrides.actorType ?? "web_user",
    actorId: overrides.actorId ?? "dashboard_admin",
    action: overrides.action ?? "created",
    changedFields: overrides.changedFields ?? ["plan"],
    oldValues: overrides.oldValues ?? null,
    newValues: overrides.newValues ?? null,
    reason: overrides.reason ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T06:00:00.000Z"
  };
}

function buildUsage(userId: string, overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    id: overrides.id ?? `usage_${userId}`,
    userId,
    orgId: "org_1",
    divisionId: null,
    segmentId: "manager",
    scenarioId: "scenario_1",
    trainingId: null,
    trainingPackId: null,
    startedAt: overrides.startedAt ?? "2026-07-10T15:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-07-10T15:10:00.000Z",
    rawDurationSeconds: 600,
    createdAt: overrides.createdAt ?? "2026-07-10T15:10:00.000Z"
  };
}

function buildScore(userId: string, id: string, overallScore: number, endedAt: string): SimulationScoreRecord {
  return {
    id,
    simulationSessionId: `sim_${id}`,
    userId,
    orgId: "org_1",
    divisionId: null,
    segmentId: "manager",
    scenarioId: "scenario_1",
    trainingId: null,
    trainingPackId: null,
    industryId: null,
    startedAt: endedAt,
    endedAt,
    communicationScore: overallScore,
    outcomeScore: overallScore,
    overallScore,
    completionLevel: "complete",
    objectiveAchieved: true,
    persuasion: 8,
    clarity: 8,
    empathy: 8,
    assertiveness: 8,
    summary: "Good attempt",
    coachingArtifact: null,
    normalizedCoachingThemes: null,
    rubricVersion: "rubric",
    model: "model",
    promptVersion: "prompt",
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    createdAt: endedAt
  };
}

async function seedStores(): Promise<void> {
  await writeFile(dbPath, JSON.stringify(buildDatabase(), null, 2), "utf8");

  planStore = createPerformancePlanStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1
  });
  await planStore.initialize();
  await planStore.createPlan({
    plan: buildPlan(),
    scopeItems: [buildScopeItem()],
    auditEvents: [buildAuditEvent()]
  });
  await planStore.createPlan({
    plan: buildPlan({
      id: "perf_plan_expired",
      userId: "user_expired",
      startDate: "2026-07-01",
      endDate: "2026-07-02"
    }),
    scopeItems: [
      buildScopeItem({
        id: "perf_scope_expired",
        planId: "perf_plan_expired",
        userId: "user_expired"
      })
    ],
    auditEvents: []
  });
  await planStore.createPlan({
    plan: buildPlan({
      id: "perf_plan_expired_cancel",
      userId: "user_expired_cancel",
      startDate: "2026-07-01",
      endDate: "2026-07-02"
    }),
    scopeItems: [
      buildScopeItem({
        id: "perf_scope_expired_cancel",
        planId: "perf_plan_expired_cancel",
        userId: "user_expired_cancel"
      })
    ],
    auditEvents: []
  });

  const usageStore = createUsageSessionStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1
  });
  await usageStore.initialize();
  await usageStore.appendRecord(buildUsage("user_current"));
  await usageStore.appendRecord(buildUsage("user_expired", { endedAt: "2026-07-01T15:10:00.000Z" }));
  await usageStore.appendRecord(buildUsage("user_expired_cancel", { endedAt: "2026-07-01T15:10:00.000Z" }));

  const scoreStore = createScoreRecordStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1
  });
  await scoreStore.initialize();
  await scoreStore.appendRecord(buildScore("user_current", "score_current_1", 80, "2026-07-10T15:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_current", "score_current_2", 90, "2026-07-10T16:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_current", "score_current_3", 85, "2026-07-10T17:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired", "score_expired_1", 80, "2026-07-01T15:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired", "score_expired_2", 90, "2026-07-01T16:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired", "score_expired_3", 85, "2026-07-01T17:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired_cancel", "score_expired_cancel_1", 80, "2026-07-01T15:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired_cancel", "score_expired_cancel_2", 90, "2026-07-01T16:00:00.000Z"));
  await scoreStore.appendRecord(buildScore("user_expired_cancel", "score_expired_cancel_3", 85, "2026-07-01T17:00:00.000Z"));

  const webAuthService = createWebAuthService({
    tokenSecret: WEB_AUTH_TOKEN_SECRET,
    codeSecret: WEB_AUTH_CODE_SECRET
  });
  const dashboardUser = buildDatabase().users.find((user) => user.id === "dashboard_admin");
  assert.ok(dashboardUser);
  const issued = webAuthService.issueSession(dashboardUser, 14 * 24 * 60, new Date(NOW), {
    accessType: "customer_dashboard_user",
    orgId: "org_1"
  });
  dashboardToken = issued.token;
  const dashboardViewer = buildDatabase().users.find((user) => user.id === "dashboard_viewer");
  assert.ok(dashboardViewer);
  const viewerIssued = webAuthService.issueSession(dashboardViewer, 14 * 24 * 60, new Date(NOW), {
    accessType: "customer_dashboard_user",
    orgId: "org_1"
  });
  dashboardViewerToken = viewerIssued.token;
  const platformUser = buildDatabase().users.find((user) => user.id === "platform_admin");
  assert.ok(platformUser);
  const platformIssued = webAuthService.issueSession(platformUser, 14 * 24 * 60, new Date(NOW), {
    accessType: "super_user",
    orgId: null
  });
  platformDashboardToken = platformIssued.token;
  const webAuthStore = createWebAuthSessionStore({
    provider: "file",
    dbPath,
    databaseUrl: null,
    pgPoolMax: 1,
    pgConnectTimeoutMs: 1,
    pgIdleTimeoutMs: 1
  });
  await webAuthStore.initialize();
  await webAuthStore.saveSession(issued.record);
  await webAuthStore.saveSession(viewerIssued.record);
  await webAuthStore.saveSession(platformIssued.record);
}

async function getCurrentPerformance(userId: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/mobile/users/${encodeURIComponent(userId)}/performance/current`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>
  };
}

async function mobileRequest(pathname: string, token: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>
  };
}

async function mobileRawRequest(pathname: string, token: string, init?: RequestInit): Promise<{ status: number; bodyText: string }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  return {
    status: response.status,
    bodyText: await response.text()
  };
}

async function dashboardRequest(
  pathname: string,
  init?: RequestInit,
  token = dashboardToken
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>
  };
}

function buildCreatePlanRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: "user_manage",
    orgId: "org_1",
    startDate: "2099-07-20",
    endDate: "2099-08-20",
    timeZone: "America/Denver",
    activityGoal: {
      enabled: true,
      metricType: "total_session_count",
      targetValue: 1
    },
    performanceGoal: {
      enabled: false,
      metricType: null,
      targetScore: null,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_topic_1"],
      selectedScenarioIds: []
    },
    ...overrides
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-current-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.PORT = "4101";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_performance_route_tests";
  process.env.WEB_AUTH_TOKEN_SECRET = WEB_AUTH_TOKEN_SECRET;
  process.env.WEB_AUTH_CODE_SECRET = WEB_AUTH_CODE_SECRET;
  process.env.MOBILE_TOKEN_SECRET = MOBILE_TOKEN_SECRET;
  process.env.SUPPORT_TRANSCRIPT_SECRET = "support_transcript_secret_for_performance_route_tests";
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

test("GET /mobile/users/:userId/performance/current lets a valid mobile token read its own Performance data", async () => {
  const result = await getCurrentPerformance("user_current", "token_current");

  assert.equal(result.status, 200);
  const activePlans = result.body.activePlans as Array<{ plan?: { id?: string }; progress?: { performance?: { eligibleScoreCount?: number } }; insights?: unknown[] }>;
  assert.equal(activePlans[0]?.plan?.id, "perf_plan_current");
  assert.equal(activePlans[0]?.progress?.performance?.eligibleScoreCount, 3);
  assert.equal(Array.isArray(activePlans[0]?.insights), true);
  assert.equal((result.body.displayState as { state?: string }).state, "active_plans_on_track");
});

test("GET /mobile/users/:userId/performance/current rejects another user's mobile token", async () => {
  const result = await getCurrentPerformance("user_current", "token_other");

  assert.equal(result.status, 401);
  assert.equal(result.body.error, "Invalid mobile token.");
});

test("GET /mobile/users/:userId/performance/current returns a successful empty response when there is no active plan", async () => {
  const result = await getCurrentPerformance("user_empty", "token_empty");

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.activePlans, []);
  assert.equal((result.body.displayState as { state?: string }).state, "no_active_plans");
});

test("mobile Performance options, preview, and create let a user create only their own plan", async () => {
  const options = await mobileRequest("/mobile/users/user_empty/performance/options", "token_empty");
  assert.equal(options.status, 200);
  assert.equal(
    (options.body.availableFocusTopics as Array<{ id?: string }>).some((topic) => topic.id === "focus_topic_1"),
    true
  );
  assert.equal(
    (options.body.availableScenarios as Array<{ scenarioId?: string }>).some((scenario) => scenario.scenarioId === "custom_1"),
    true
  );

  const requestBody = buildCreatePlanRequest({
    userId: "user_empty",
    orgId: null,
    startDate: "2099-09-01",
    endDate: "2099-10-01",
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_topic_1"],
      selectedScenarioIds: []
    }
  });

  const preview = await mobileRequest("/mobile/users/user_empty/performance/preview", "token_empty", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true);

  const created = await mobileRequest("/mobile/users/user_empty/performance/plans", "token_empty", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(created.status, 201);
  assert.equal((created.body.plan as { userId?: string; createdByActorType?: string; createdByActorId?: string }).userId, "user_empty");
  assert.equal((created.body.plan as { createdByActorType?: string }).createdByActorType, "mobile_user");
  assert.equal((created.body.plan as { createdByActorId?: string }).createdByActorId, "user_empty");

  const current = await getCurrentPerformance("user_empty", "token_empty");
  assert.equal(current.status, 200);
  assert.equal(((current.body.activePlans as Array<{ plan?: { userId?: string } }>)[0]?.plan?.userId), "user_empty");

  const duplicate = await mobileRequest("/mobile/users/user_empty/performance/plans", "token_empty", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "performance_plan_duplicate_active_definition");

  const distinct = await mobileRequest("/mobile/users/user_empty/performance/plans", "token_empty", {
    method: "POST",
    body: JSON.stringify({
      ...requestBody,
      startDate: "2099-09-02",
      endDate: "2099-10-02"
    })
  });
  assert.equal(distinct.status, 201);
  const multipleCurrent = await getCurrentPerformance("user_empty", "token_empty");
  assert.equal((multipleCurrent.body.activePlans as unknown[]).length, 2);

  const spoofed = await mobileRequest("/mobile/users/user_empty/performance/preview", "token_empty", {
    method: "POST",
    body: JSON.stringify({ ...requestBody, userId: "user_other" })
  });
  assert.equal(spoofed.status, 403);

  const otherToken = await mobileRequest("/mobile/users/user_empty/performance/plans", "token_other", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(otherToken.status, 401);
});

test("mobile Performance users cannot edit protected fields after plan creation", async () => {
  const requestBody = buildCreatePlanRequest({
    userId: "user_other",
    orgId: null,
    startDate: "2099-09-05",
    endDate: "2099-10-05",
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_topic_1"],
      selectedScenarioIds: []
    }
  });
  const created = await mobileRequest("/mobile/users/user_other/performance/plans", "token_other", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(created.status, 201);
  const planId = (created.body.plan as { id?: string }).id;
  assert.ok(planId);

  const edited = await mobileRawRequest(`/mobile/users/user_other/performance/plans/${encodeURIComponent(planId)}`, "token_other", {
    method: "PATCH",
    body: JSON.stringify({
      userId: "user_empty",
      orgId: "org_2",
      startDate: "2099-01-01",
      endDate: "2099-12-31",
      activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 99 },
      performanceGoal: {
        enabled: true,
        metricType: "target_average_score",
        targetScore: 100,
        improvementAmount: null,
        comparisonMonthCount: null
      },
      baseline: { derivedTargetScore: 100 },
      scopeSelection: {
        allAssignedScenarios: true,
        selectedFocusTopicIds: ["tampered_topic"],
        selectedScenarioIds: ["tampered_scenario"]
      }
    })
  });
  assert.equal(edited.status, 404);

  const loaded = await planStore.getPlanById(planId);
  assert.equal(loaded?.plan.userId, "user_other");
  assert.equal(loaded?.plan.orgId, "org_1");
  assert.equal(loaded?.plan.startDate, "2099-09-05");
  assert.equal(loaded?.plan.endDate, "2099-10-05");
  assert.equal(loaded?.plan.activityGoal.targetValue, 1);
  assert.deepEqual(loaded?.plan.scope.selectedFocusTopicIds, ["focus_topic_1"]);
  assert.equal(loaded?.auditEvents.some((event) => event.action === "updated"), false);
});

test("mobile Performance create rejects inactive users and unavailable scenario ids", async () => {
  const inactive = await mobileRequest("/mobile/users/user_inactive/performance/plans", "token_inactive", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_inactive", orgId: null }))
  });
  assert.equal(inactive.status, 403);
  assert.equal(inactive.body.error, "User account is disabled.");

  const unavailable = await mobileRequest("/mobile/users/user_manage/performance/plans", "token_manage", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({
      userId: "user_manage",
      orgId: null,
      scopeSelection: {
        allAssignedScenarios: false,
        selectedFocusTopicIds: [],
        selectedScenarioIds: ["tampered_scenario"]
      }
    }))
  });
  assert.equal(unavailable.status, 400);
  assert.equal(Array.isArray(unavailable.body.errors), true);
  assert.match(String(unavailable.body.error), /not available/i);
});

test("GET /mobile/users/:userId/performance/current finalizes an expired active plan once before responding", async () => {
  const [first, second] = await Promise.all([
    getCurrentPerformance("user_expired", "token_expired"),
    getCurrentPerformance("user_expired", "token_expired")
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(first.body.activePlans, []);
  assert.deepEqual(second.body.activePlans, []);

  const finalized = await planStore.getPlanById("perf_plan_expired");
  assert.equal(finalized?.plan.status, "completed");
  assert.equal(finalized?.auditEvents.filter((event) => event.action === "completed").length, 1);
  assert.equal(finalized?.plan.finalResult?.sessionsCompleted, 1);
});

test("mobile Performance history and detail return only the authenticated user's plans", async () => {
  const history = await mobileRequest("/mobile/users/user_current/performance/plans", "token_current");
  assert.equal(history.status, 200);
  const plans = history.body.plans as Array<{ plan?: { id?: string } }>;
  assert.equal(plans.some((row) => row.plan?.id === "perf_plan_current"), true);

  const detail = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current", "token_current");
  assert.equal(detail.status, 200);
  assert.equal((detail.body.plan as { id?: string }).id, "perf_plan_current");
  const auditEvents = detail.body.auditEvents as Array<{ actorLabel?: string; actorRoleLabel?: string; actorId?: string }>;
  assert.deepEqual(auditEvents.map((event) => event.actorLabel), ["your manager"]);
  assert.equal(auditEvents.some((event) => "actorId" in event), false);

  const crossUser = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current", "token_other");
  assert.equal(crossUser.status, 401);
});

test("mobile Performance cancellation is denied for mobile users without leaking other plans", async () => {
  const crossUserCancel = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current/cancel", "token_other", {
    method: "POST",
    body: JSON.stringify({ reason: "Trying to cancel someone else's plan." })
  });
  assert.equal(crossUserCancel.status, 401);

  const otherPlanCancel = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_expired_cancel/cancel", "token_current", {
    method: "POST",
    body: JSON.stringify({ reason: "Trying to cancel another user's plan." })
  });
  assert.equal(otherPlanCancel.status, 404);
  assert.equal(otherPlanCancel.body.error, "Performance plan not found.");

  const result = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current/cancel", "token_current", {
    method: "POST",
    body: JSON.stringify({ reason: "I want to reset my goal." })
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "Performance plans can only be cancelled by an authorized dashboard manager.");
  assert.equal(result.body.code, "performance_plan_cancel_requires_manager");

  const loaded = await planStore.getPlanById("perf_plan_current");
  assert.equal(loaded?.plan.status, "active");
  assert.equal(loaded?.plan.cancellationReason, null);
  assert.equal(loaded?.auditEvents.some((event) => event.action === "cancelled"), false);
});

test("dashboard Performance workspace lists scoped users and Focus Topic candidates", async () => {
  const result = await dashboardRequest("/dashboard/performance");

  assert.equal(result.status, 200);
  assert.equal(result.body.scopeMode, "organization");
  assert.equal(result.body.defaultTimeZone, "UTC");
  const users = result.body.users as Array<{
    userId?: string;
    timeZone?: string;
    canManagePerformancePlans?: boolean;
    assignableFocusTopics?: Array<{ id?: string; name?: string }>;
    assignableScenarios?: Array<{ scenarioId?: string }>;
  }>;
  const managedUser = users.find((user) => user.userId === "user_manage");
  assert.ok(managedUser);
  assert.equal(managedUser.timeZone, "America/Denver");
  assert.equal(managedUser.canManagePerformancePlans, true);
  assert.equal(managedUser.assignableFocusTopics?.some((topic) => topic.name === "Manager Coaching"), true);
  assert.equal(managedUser.assignableScenarios?.some((scenario) => scenario.scenarioId === "custom_1"), true);
  assert.equal(users.some((user) => user.userId === "user_inactive"), false);
});

test("dashboard Performance super user sees a grouped portfolio instead of mixed plan rows", async () => {
  const result = await dashboardRequest("/dashboard/performance", undefined, platformDashboardToken);

  assert.equal(result.status, 200);
  assert.equal(result.body.scopeMode, "portfolio");
  assert.deepEqual(result.body.plans, []);
  assert.deepEqual(result.body.users, []);
  const summaries = result.body.organizationSummaries as Array<{ orgId?: string; activePlanCount?: number; visibleUserCount?: number }>;
  assert.equal(summaries.some((summary) => summary.orgId === "org_1" && (summary.activePlanCount ?? 0) >= 1), true);
  assert.equal(summaries.some((summary) => summary.orgId === "org_2"), true);
});

test("dashboard Performance super user manages selected company plans with platform-admin audit", async () => {
  const workspace = await dashboardRequest("/dashboard/performance?orgId=org_1", undefined, platformDashboardToken);
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.scopeMode, "organization");
  assert.deepEqual(workspace.body.selectedOrg, { orgId: "org_1", orgName: "Acme Learning" });
  assert.equal((workspace.body.plans as Array<{ plan?: { orgId?: string } }>).every((row) => row.plan?.orgId === "org_1"), true);

  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_platform_target" }))
  }, platformDashboardToken);
  assert.equal(created.status, 201);
  const planId = (created.body.plan as { id?: string }).id;
  assert.ok(planId);

  const updated = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify(buildCreatePlanRequest({
      userId: "user_platform_target",
      activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 4 }
    }))
  }, platformDashboardToken);
  assert.equal(updated.status, 200);

  const detail = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, undefined, platformDashboardToken);
  assert.equal(detail.status, 200);
  const auditEvents = detail.body.auditEvents as Array<{ actorLabel?: string; actorRoleLabel?: string; actorId?: string }>;
  assert.equal(auditEvents.some((event) => event.actorLabel === "platform-admin@peritio.ai" && event.actorRoleLabel === "Peritio administrator"), true);
  assert.equal(auditEvents.some((event) => "actorId" in event), false);

  const stored = await planStore.getPlanById(planId);
  assert.equal(stored?.auditEvents.some((event) => event.actorType === "platform_admin" && event.actorId === "platform_admin"), true);

  const cancelled = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Platform review complete." })
  }, platformDashboardToken);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancelled, true);
});

test("dashboard Performance preview validates a plan before creation", async () => {
  const result = await dashboardRequest("/dashboard/performance/preview", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest())
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.valid, true);
  assert.equal((result.body.scope as { scenarios?: unknown[] }).scenarios?.length, 1);
});

test("dashboard Performance preview and create reject malformed plan inputs with structured 400 responses", async () => {
  for (const pathname of ["/dashboard/performance/preview", "/dashboard/performance/plans"]) {
    const result = await dashboardRequest(pathname, {
      method: "POST",
      body: "{"
    });
    assert.equal(result.status, 400, `${pathname} invalid JSON`);
    assert.equal(result.body.error, "Request body must be valid JSON.");
  }

  const cases: Array<{ name: string; body: Record<string, unknown> }> = [
    {
      name: "missing scopeSelection",
      body: (() => {
        const { scopeSelection: _scopeSelection, ...body } = buildCreatePlanRequest();
        return body;
      })()
    },
    {
      name: "malformed activityGoal",
      body: buildCreatePlanRequest({ activityGoal: null })
    },
    {
      name: "missing performanceGoal",
      body: (() => {
        const { performanceGoal: _performanceGoal, ...body } = buildCreatePlanRequest();
        return body;
      })()
    },
    {
      name: "unsupported goal combination",
      body: buildCreatePlanRequest({
        activityGoal: { enabled: false, metricType: null, targetValue: null },
        performanceGoal: { enabled: false, metricType: null, targetScore: null, improvementAmount: null, comparisonMonthCount: null }
      })
    },
    {
      name: "invalid calendar date",
      body: buildCreatePlanRequest({ startDate: "2026-02-31" })
    },
    {
      name: "empty selection",
      body: buildCreatePlanRequest({
        scopeSelection: { allAssignedScenarios: false, selectedFocusTopicIds: [], selectedScenarioIds: [] }
      })
    },
    {
      name: "duplicate scenario selections",
      body: buildCreatePlanRequest({
        scopeSelection: {
          allAssignedScenarios: false,
          selectedFocusTopicIds: [],
          selectedScenarioIds: ["custom_1", "custom_1"]
        }
      })
    },
    {
      name: "unavailable scenario id",
      body: buildCreatePlanRequest({
        scopeSelection: {
          allAssignedScenarios: false,
          selectedFocusTopicIds: [],
          selectedScenarioIds: ["not_available"]
        }
      })
    },
    {
      name: "invalid improvement baseline",
      body: buildCreatePlanRequest({
        activityGoal: { enabled: false, metricType: null, targetValue: null },
        performanceGoal: {
          enabled: true,
          metricType: "improve_by_points",
          targetScore: null,
          improvementAmount: 10,
          comparisonMonthCount: 3
        }
      })
    }
  ];

  for (const testCase of cases) {
    const preview = await dashboardRequest("/dashboard/performance/preview", {
      method: "POST",
      body: JSON.stringify(testCase.body)
    });
    assert.equal(preview.status, 400, `preview ${testCase.name}`);
    assert.equal(Array.isArray(preview.body.errors), true, `preview ${testCase.name} errors`);

    const created = await dashboardRequest("/dashboard/performance/plans", {
      method: "POST",
      body: JSON.stringify(testCase.body)
    });
    assert.equal(created.status, 400, `create ${testCase.name}`);
    assert.equal(Array.isArray(created.body.errors), true, `create ${testCase.name} errors`);
  }
});

test("dashboard Performance preview and create reject inactive users", async () => {
  const preview = await dashboardRequest("/dashboard/performance/preview", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_inactive" }))
  });
  assert.equal(preview.status, 400);
  assert.match(String(preview.body.error), /active users/);
  assert.deepEqual(preview.body.errors, ["Performance plans can only be assigned to active users."]);

  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_inactive" }))
  });
  assert.equal(created.status, 400);
  assert.match(String(created.body.error), /active users/);
  assert.deepEqual(created.body.errors, ["Performance plans can only be assigned to active users."]);
});

test("dashboard Performance write routes do not leak cross-org inactive target status", async () => {
  for (const pathname of ["/dashboard/performance/preview", "/dashboard/performance/plans"]) {
    const inaccessible = await dashboardRequest(pathname, {
      method: "POST",
      body: JSON.stringify(buildCreatePlanRequest({ userId: "user_other_org_inactive", orgId: "org_2" }))
    });
    const missing = await dashboardRequest(pathname, {
      method: "POST",
      body: JSON.stringify(buildCreatePlanRequest({ userId: "missing_user", orgId: "org_2" }))
    });

    assert.equal(inaccessible.status, 404, `${pathname} cross-org inactive status`);
    assert.deepEqual(inaccessible.body, missing.body, `${pathname} cross-org inactive response shape`);
    assert.equal(inaccessible.body.error, "Dashboard user not found.");
  }
});

test("dashboard Performance write routes do not leak cross-division inactive target status", async () => {
  for (const pathname of ["/dashboard/performance/preview", "/dashboard/performance/plans"]) {
    const result = await dashboardRequest(`${pathname}?divisionId=division_a`, {
      method: "POST",
      body: JSON.stringify(buildCreatePlanRequest({ userId: "user_inactive_division_b" }))
    });

    assert.equal(result.status, 404, `${pathname} cross-division inactive status`);
    assert.equal(result.body.error, "Dashboard user not found.");
  }
});

test("dashboard Performance preview and create still work for authorized active targets", async () => {
  const input = buildCreatePlanRequest({ userId: "user_authorized_active" });
  const preview = await dashboardRequest("/dashboard/performance/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true);

  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(input)
  });

  assert.equal(created.status, 201);
  assert.equal((created.body.plan as { userId?: string; status?: string }).userId, "user_authorized_active");
  assert.equal((created.body.plan as { status?: string }).status, "active");
});

test("dashboard Performance concurrent identical creates return one success and one structured duplicate", async () => {
  const input = buildCreatePlanRequest({
    userId: "user_concurrent_duplicate",
    startDate: "2099-11-01",
    endDate: "2099-12-01"
  });

  const [first, second] = await Promise.all([
    dashboardRequest("/dashboard/performance/plans", {
      method: "POST",
      body: JSON.stringify(input)
    }),
    dashboardRequest("/dashboard/performance/plans", {
      method: "POST",
      body: JSON.stringify(input)
    })
  ]);

  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  const duplicate = [first, second].find((result) => result.status === 409);
  assert.equal(duplicate?.body.error, "An identical active Performance plan already exists for this user.");
  assert.equal(duplicate?.body.code, "performance_plan_duplicate_active_definition");
  const userPlans = await planStore.listPlansForUser("org_1", "user_concurrent_duplicate");
  assert.equal(userPlans.filter((entry) => entry.plan.status === "active").length, 1);
});

test("dashboard Performance concurrent different creates both succeed for one user", async () => {
  const firstInput = buildCreatePlanRequest({
    userId: "user_concurrent_distinct",
    startDate: "2099-11-05",
    endDate: "2099-12-05",
    activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 2 }
  });
  const secondInput = buildCreatePlanRequest({
    userId: "user_concurrent_distinct",
    startDate: "2099-11-05",
    endDate: "2099-12-05",
    activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 3 }
  });

  const [first, second] = await Promise.all([
    dashboardRequest("/dashboard/performance/plans", {
      method: "POST",
      body: JSON.stringify(firstInput)
    }),
    dashboardRequest("/dashboard/performance/plans", {
      method: "POST",
      body: JSON.stringify(secondInput)
    })
  ]);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const userPlans = await planStore.listPlansForUser("org_1", "user_concurrent_distinct");
  assert.equal(userPlans.filter((entry) => entry.plan.status === "active").length, 2);
});

test("dashboard Performance write routes require plan-management access", async () => {
  const workspace = await dashboardRequest("/dashboard/performance", undefined, dashboardViewerToken);
  assert.equal(workspace.status, 200);
  const users = workspace.body.users as Array<{ canManagePerformancePlans?: boolean }>;
  assert.equal(users.length > 0, true);
  assert.equal(users.every((user) => user.canManagePerformancePlans === false), true);
  const plans = workspace.body.plans as Array<{ canCancel?: boolean }>;
  assert.equal(plans.every((plan) => plan.canCancel === false), true);
  const editablePlans = workspace.body.plans as Array<{ canEdit?: boolean }>;
  assert.equal(editablePlans.every((plan) => plan.canEdit === false), true);

  const preview = await dashboardRequest(
    "/dashboard/performance/preview",
    {
      method: "POST",
      body: JSON.stringify(buildCreatePlanRequest())
    },
    dashboardViewerToken
  );
  assert.equal(preview.status, 403);
  assert.equal(preview.body.code, "dashboard_scope_denied");

  const created = await dashboardRequest(
    "/dashboard/performance/plans",
    {
      method: "POST",
      body: JSON.stringify(buildCreatePlanRequest())
    },
    dashboardViewerToken
  );
  assert.equal(created.status, 403);
  assert.equal(created.body.code, "dashboard_scope_denied");

  const cancelled = await dashboardRequest(
    "/dashboard/performance/plans/perf_plan_expired_cancel/cancel",
    {
      method: "POST",
      body: JSON.stringify({ reason: "No management permission." })
    },
    dashboardViewerToken
  );
  assert.equal(cancelled.status, 403);
  assert.equal(cancelled.body.code, "dashboard_scope_denied");

  const edited = await dashboardRequest(
    "/dashboard/performance/plans/perf_plan_current",
    {
      method: "PATCH",
      body: JSON.stringify(buildCreatePlanRequest({ userId: "user_current" }))
    },
    dashboardViewerToken
  );
  assert.equal(edited.status, 403);
  assert.equal(edited.body.code, "dashboard_scope_denied");
});

test("dashboard Performance create finalizes an expired active plan before creating the next plan", async () => {
  await planStore.createPlan({
    plan: buildPlan({
      id: "perf_plan_expired_create_old",
      userId: "user_expired_create",
      startDate: "2026-07-01",
      endDate: "2026-07-02"
    }),
    scopeItems: [
      buildScopeItem({
        id: "perf_scope_expired_create_old",
        planId: "perf_plan_expired_create_old",
        userId: "user_expired_create"
      })
    ],
    auditEvents: []
  });

  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_expired_create" }))
  });

  assert.equal(created.status, 201);
  assert.equal((created.body.plan as { userId?: string; status?: string }).userId, "user_expired_create");
  assert.equal((created.body.plan as { status?: string }).status, "active");

  const finalized = await planStore.getPlanById("perf_plan_expired_create_old");
  assert.equal(finalized?.plan.status, "completed");
  assert.equal(finalized?.auditEvents.filter((event) => event.action === "completed").length, 1);
});

test("dashboard Performance managers can edit active plans without changing the target user", async () => {
  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_edit" }))
  });
  assert.equal(created.status, 201);
  const planId = (created.body.plan as { id?: string }).id;
  assert.ok(planId);

  const detail = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`);
  assert.equal(detail.status, 200);
  assert.equal(((detail.body.plan as { canEdit?: boolean }).canEdit), true);

  const updatedRequest = buildCreatePlanRequest({
    userId: "user_edit",
    startDate: "2099-10-01",
    endDate: "2099-11-01",
    activityGoal: {
      enabled: true,
      metricType: "total_session_count",
      targetValue: 4
    },
    performanceGoal: {
      enabled: true,
      metricType: "target_average_score",
      targetScore: 90,
      improvementAmount: null,
      comparisonMonthCount: null
    },
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: [],
      selectedScenarioIds: ["custom_1"]
    }
  });

  const updated = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify(updatedRequest)
  });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.plan as { id?: string; userId?: string; startDate?: string }).id, planId);
  assert.equal((updated.body.plan as { userId?: string }).userId, "user_edit");
  assert.equal((updated.body.plan as { startDate?: string }).startDate, "2099-10-01");
  assert.equal((updated.body.plan as { activityGoal?: { targetValue?: number } }).activityGoal?.targetValue, 4);
  assert.equal((updated.body.plan as { performanceGoal?: { targetScore?: number } }).performanceGoal?.targetScore, 90);
  assert.deepEqual((updated.body.plan as { scope?: { selectedScenarioIds?: string[] } }).scope?.selectedScenarioIds, ["custom_1"]);

  const loaded = await planStore.getPlanById(planId);
  assert.equal(loaded?.auditEvents.some((event) => event.action === "updated" && event.actorId === "dashboard_admin"), true);
  assert.equal(loaded?.scopeItems.length, 1);
  assert.equal(loaded?.scopeItems[0].scenarioId, "custom_1");

  const second = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({
      userId: "user_edit",
      startDate: "2099-12-01",
      endDate: "2100-01-01",
      activityGoal: { enabled: true, metricType: "total_session_count", targetValue: 7 }
    }))
  });
  assert.equal(second.status, 201);
  const secondPlanId = (second.body.plan as { id?: string }).id;
  assert.ok(secondPlanId);
  const duplicateEdit = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(secondPlanId)}`, {
    method: "PATCH",
    body: JSON.stringify(updatedRequest)
  });
  assert.equal(duplicateEdit.status, 409);
  assert.equal(duplicateEdit.body.code, "performance_plan_duplicate_active_definition");

  const spoofed = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...updatedRequest, userId: "user_other" })
  });
  assert.equal(spoofed.status, 400);
  assert.match(String(spoofed.body.error), /target user cannot be changed/i);

  const wrongDivision = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}?divisionId=division_b`, {
    method: "PATCH",
    body: JSON.stringify(updatedRequest)
  });
  assert.equal(wrongDivision.status, 404);

  const cancelled = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Testing terminal edit guard." })
  });
  assert.equal(cancelled.status, 200);

  const terminalEdit = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify(updatedRequest)
  });
  assert.equal(terminalEdit.status, 409);
});

test("dashboard Performance managers can edit mobile self-created plans", async () => {
  const requestBody = buildCreatePlanRequest({
    userId: "user_self_created_edit",
    orgId: null,
    startDate: "2099-08-01",
    endDate: "2099-09-01",
    scopeSelection: {
      allAssignedScenarios: false,
      selectedFocusTopicIds: ["focus_topic_1"],
      selectedScenarioIds: []
    }
  });
  const created = await mobileRequest("/mobile/users/user_self_created_edit/performance/plans", "token_self_created_edit", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  assert.equal(created.status, 201);
  assert.equal((created.body.plan as { createdByActorType?: string }).createdByActorType, "mobile_user");
  const planId = (created.body.plan as { id?: string }).id;
  assert.ok(planId);

  const updated = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify(buildCreatePlanRequest({
      userId: "user_self_created_edit",
      startDate: "2099-08-05",
      endDate: "2099-09-05",
      activityGoal: {
        enabled: true,
        metricType: "total_session_count",
        targetValue: 3
      },
      scopeSelection: {
        allAssignedScenarios: false,
        selectedFocusTopicIds: [],
        selectedScenarioIds: ["custom_1"]
      }
    }))
  });

  assert.equal(updated.status, 200);
  assert.equal((updated.body.plan as { userId?: string }).userId, "user_self_created_edit");
  assert.equal((updated.body.plan as { startDate?: string }).startDate, "2099-08-05");
  assert.equal((updated.body.plan as { activityGoal?: { targetValue?: number } }).activityGoal?.targetValue, 3);
  const loaded = await planStore.getPlanById(planId);
  assert.equal(loaded?.plan.createdByActorType, "mobile_user");
  assert.equal(loaded?.plan.createdByActorId, "user_self_created_edit");
  assert.equal(loaded?.auditEvents.some((event) => event.action === "updated" && event.actorId === "dashboard_admin"), true);
});

test("dashboard Performance edit can preserve an already-started active plan start date", async () => {
  await planStore.createPlan({
    plan: buildPlan({
      id: "perf_plan_started_edit",
      userId: "user_started_edit",
      startDate: "2026-07-01",
      endDate: "2099-12-31"
    }),
    scopeItems: [
      buildScopeItem({
        id: "perf_scope_started_edit",
        planId: "perf_plan_started_edit",
        userId: "user_started_edit"
      })
    ],
    auditEvents: []
  });

  const updated = await dashboardRequest("/dashboard/performance/plans/perf_plan_started_edit", {
    method: "PATCH",
    body: JSON.stringify(buildCreatePlanRequest({
      userId: "user_started_edit",
      startDate: "2026-07-01",
      endDate: "2099-12-31",
      activityGoal: {
        enabled: true,
        metricType: "total_session_count",
        targetValue: 3
      }
    }))
  });

  assert.equal(updated.status, 200);
  assert.equal((updated.body.plan as { startDate?: string; activityGoal?: { targetValue?: number } }).startDate, "2026-07-01");
  assert.equal((updated.body.plan as { activityGoal?: { targetValue?: number } }).activityGoal?.targetValue, 3);
});

test("dashboard Performance create, detail, duplicate protection, and cancel work through authorized scope", async () => {
  const created = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest())
  });

  assert.equal(created.status, 201);
  const createdPlan = created.body.plan as { id?: string; status?: string; userId?: string };
  assert.equal(createdPlan.status, "active");
  assert.equal(createdPlan.userId, "user_manage");
  assert.ok(createdPlan.id);

  const duplicate = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest())
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "performance_plan_duplicate_active_definition");

  const distinct = await dashboardRequest("/dashboard/performance/plans", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({
      startDate: "2099-07-21",
      endDate: "2099-08-21"
    }))
  });
  assert.equal(distinct.status, 201);

  const detail = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(createdPlan.id!)}`);
  assert.equal(detail.status, 200);
  assert.equal(((detail.body.plan as { plan?: { id?: string } }).plan?.id), createdPlan.id);

  const wrongDivisionCancel = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(createdPlan.id!)}/cancel?divisionId=division_b`, {
    method: "POST",
    body: JSON.stringify({ reason: "Out of scope." })
  });
  assert.equal(wrongDivisionCancel.status, 404);
  assert.equal(wrongDivisionCancel.body.error, "Performance plan not found.");

  const cancelled = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(createdPlan.id!)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Manager changed the assignment." })
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancelled, true);
  assert.equal((cancelled.body.plan as { status?: string; cancellationReason?: string }).status, "cancelled");
  assert.equal((cancelled.body.plan as { status?: string; cancellationReason?: string }).cancellationReason, "Manager changed the assignment.");
});

test("dashboard Performance routes reject cross-org and division-mismatched access", async () => {
  const crossOrg = await dashboardRequest("/dashboard/performance/preview", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest({ userId: "user_other_org", orgId: "org_2" }))
  });
  assert.equal(crossOrg.status, 404);

  const wrongDivision = await dashboardRequest("/dashboard/performance/preview?divisionId=division_b", {
    method: "POST",
    body: JSON.stringify(buildCreatePlanRequest())
  });
  assert.equal(wrongDivision.status, 404);
});

test("dashboard Performance cancellation finalizes expired active plans instead of cancelling", async () => {
  await planStore.createPlan({
    plan: buildPlan({
      id: "perf_plan_expired_cancel_late",
      userId: "user_expired_late",
      startDate: "2026-07-01",
      endDate: "2026-07-02"
    }),
    scopeItems: [
      buildScopeItem({
        id: "perf_scope_expired_cancel_late",
        planId: "perf_plan_expired_cancel_late",
        userId: "user_expired_late"
      })
    ],
    auditEvents: []
  });

  const result = await dashboardRequest("/dashboard/performance/plans/perf_plan_expired_cancel_late/cancel", {
    method: "POST",
    body: JSON.stringify({ reason: "Too late to cancel." })
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.cancelled, false);
  assert.equal(result.body.finalizedInstead, true);
  assert.equal((result.body.plan as { status?: string }).status, "completed");

  const finalized = await planStore.getPlanById("perf_plan_expired_cancel_late");
  assert.equal(finalized?.auditEvents.filter((event) => event.action === "completed").length, 1);
});
