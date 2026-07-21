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
      buildUser("user_authorized_active", "authorized-active@example.com"),
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
      buildMobileToken("user_manage", "token_manage")
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
  assert.equal((result.body.plan as { id?: string } | null)?.id, "perf_plan_current");
  assert.equal((result.body.progress as { performance?: { eligibleScoreCount?: number } } | null)?.performance?.eligibleScoreCount, 3);
  assert.equal(Array.isArray(result.body.insights), true);
  assert.equal((result.body.displayState as { state?: string }).state, "active_on_track");
});

test("GET /mobile/users/:userId/performance/current rejects another user's mobile token", async () => {
  const result = await getCurrentPerformance("user_current", "token_other");

  assert.equal(result.status, 401);
  assert.equal(result.body.error, "Invalid mobile token.");
});

test("GET /mobile/users/:userId/performance/current returns a successful empty response when there is no active plan", async () => {
  const result = await getCurrentPerformance("user_empty", "token_empty");

  assert.equal(result.status, 200);
  assert.equal(result.body.plan, null);
  assert.equal(result.body.progress, null);
  assert.deepEqual(result.body.insights, []);
  assert.equal((result.body.displayState as { state?: string }).state, "no_active_plan");
});

test("GET /mobile/users/:userId/performance/current finalizes an expired active plan once before responding", async () => {
  const [first, second] = await Promise.all([
    getCurrentPerformance("user_expired", "token_expired"),
    getCurrentPerformance("user_expired", "token_expired")
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.plan, null);
  assert.equal(second.body.plan, null);

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
  assert.deepEqual(
    (detail.body.auditEvents as Array<{ actorId?: string | null }>).map((event) => event.actorId),
    [null]
  );

  const crossUser = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current", "token_other");
  assert.equal(crossUser.status, 401);
});

test("mobile Performance cancellation cancels only an unexpired own active plan", async () => {
  const result = await mobileRequest("/mobile/users/user_current/performance/plans/perf_plan_current/cancel", "token_current", {
    method: "POST",
    body: JSON.stringify({ reason: "I want to reset my goal." })
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.cancelled, true);
  assert.equal(result.body.finalizedInstead, false);
  assert.equal((result.body.plan as { status?: string; cancellationReason?: string }).status, "cancelled");
  assert.equal((result.body.plan as { status?: string; cancellationReason?: string }).cancellationReason, "I want to reset my goal.");
});

test("dashboard Performance workspace lists scoped users and Focus Topic candidates", async () => {
  const result = await dashboardRequest("/dashboard/performance");

  assert.equal(result.status, 200);
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

test("dashboard Performance write routes require plan-management access", async () => {
  const workspace = await dashboardRequest("/dashboard/performance", undefined, dashboardViewerToken);
  assert.equal(workspace.status, 200);
  const users = workspace.body.users as Array<{ canManagePerformancePlans?: boolean }>;
  assert.equal(users.length > 0, true);
  assert.equal(users.every((user) => user.canManagePerformancePlans === false), true);
  const plans = workspace.body.plans as Array<{ canCancel?: boolean }>;
  assert.equal(plans.every((plan) => plan.canCancel === false), true);

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

  const detail = await dashboardRequest(`/dashboard/performance/plans/${encodeURIComponent(createdPlan.id!)}`);
  assert.equal(detail.status, 200);
  assert.equal(((detail.body.plan as { plan?: { id?: string } }).plan?.id), createdPlan.id);

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
