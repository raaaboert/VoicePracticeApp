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
  PerformancePlan,
  PerformancePlanScopeItem,
  SimulationScoreRecord,
  UsageSessionRecord,
  UserProfile
} from "@voicepractice/shared";

import { createPerformancePlanStore, PerformancePlanStore } from "./storage/performancePlanStore.js";
import { createScoreRecordStore } from "./storage/scoreRecordStore.js";
import { createUsageSessionStore } from "./storage/usageSessionStore.js";

const MOBILE_TOKEN_SECRET = "mobile_token_secret_for_performance_route_tests";
const NOW = "2026-07-20T16:00:00.000Z";

let tempDir: string;
let dbPath: string;
let baseUrl: string;
let server: Server;
let planStore: PerformancePlanStore;

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

function buildUser(id: string, email: string): UserProfile {
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
    divisionId: null,
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: NOW,
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function buildOrg(): EnterpriseOrg {
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
    divisionsEnabled: false,
    customScenarios: [],
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
      buildUser("user_expired", "expired@example.com")
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
      buildMobileToken("user_current", "token_current"),
      buildMobileToken("user_empty", "token_empty"),
      buildMobileToken("user_other", "token_other"),
      buildMobileToken("user_expired", "token_expired")
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
    auditEvents: []
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

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "performance-current-route-"));
  dbPath = path.join(tempDir, "db.local.json");
  process.env.NODE_ENV = "test";
  process.env.PERITIO_ENV = "development";
  process.env.STORAGE_PROVIDER = "file";
  process.env.DB_PATH = dbPath;
  process.env.PORT = "4101";
  process.env.ADMIN_TOKEN_SECRET = "admin_token_secret_for_performance_route_tests";
  process.env.WEB_AUTH_TOKEN_SECRET = "web_auth_token_secret_for_performance_route_tests";
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
