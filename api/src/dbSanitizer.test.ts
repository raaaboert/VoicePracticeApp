import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiDatabase,
  createDefaultConfig,
  EnterpriseOrg,
  UserProfile
} from "@voicepractice/shared";

import { OPERATIONAL_TABLES, sanitizeAppState } from "./dbSanitizer.js";

const NOW = "2026-07-09T12:00:00.000Z";

function makeOrg(overrides: Partial<EnterpriseOrg>): EnterpriseOrg {
  return {
    id: "org_real",
    name: "Real Customer",
    status: "active",
    contactName: "Real Admin",
    contactEmail: "admin@realco.com",
    emailDomain: "realco.com",
    joinCode: "REALCODE",
    activeIndustries: ["sales"],
    dailySecondsQuota: 28_800,
    perUserDailySecondsCap: 3_600,
    pendingPerUserDailySecondsCap: null,
    pendingPerUserDailySecondsCapEffectiveAt: null,
    manualBonusSeconds: 0,
    contractSignedAt: NOW,
    monthlyMinutesAllotted: 1_000,
    renewalTotalUsd: 0,
    softLimitPercentTriggers: [80, 100],
    maxSimulationMinutes: 20,
    divisionsEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeUser(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: "usr_real",
    email: "learner@realco.com",
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: true,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_real",
    orgRole: "user",
    divisionId: "div_real",
    timezone: "UTC",
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

function makeDb(): ApiDatabase {
  return {
    config: createDefaultConfig(NOW),
    orgs: [
      makeOrg({}),
      makeOrg({
        id: "org_demo_sales",
        name: "Demo Sales",
        contactEmail: "admin@summitrevenue.example",
        emailDomain: "summitrevenue.example"
      })
    ],
    users: [
      makeUser({}),
      makeUser({ id: "usr_demo_sales_rep", email: "rep@summitrevenue.example", orgId: "org_demo_sales" }),
      makeUser({ id: "usr_local", email: "customer-admin@primary.local", orgId: null, accountType: "individual", tier: "free" }),
      makeUser({ id: "usr_stage_review", email: "reviewer@realco.com", orgId: "org_real" })
    ],
    orgDivisions: [
      { id: "div_real", orgId: "org_real", name: "Real Division", active: true, createdAt: NOW, updatedAt: NOW },
      { id: "div_demo", orgId: "org_demo_sales", name: "Demo Division", active: true, createdAt: NOW, updatedAt: NOW }
    ],
    orgTrainings: [
      { id: "trn_real", orgId: "org_real", name: "Real Training", status: "active", description: "", divisionId: "div_real", createdAt: NOW, updatedAt: NOW },
      { id: "trn_demo", orgId: "org_demo_sales", name: "Demo Training", status: "active", description: "", createdAt: NOW, updatedAt: NOW }
    ],
    orgTrainingPackAttachments: [
      { id: "att_pack_real", orgId: "org_real", trainingId: "trn_real", trainingPackId: "pack_real", createdAt: NOW, updatedAt: NOW },
      { id: "att_pack_demo", orgId: "org_demo_sales", trainingId: "trn_demo", trainingPackId: "pack_demo", createdAt: NOW, updatedAt: NOW }
    ],
    orgTrainingScenarioAttachments: [
      { id: "att_scenario_real", orgId: "org_real", trainingId: "trn_real", scenarioId: "sales_discount_pushback", createdAt: NOW, updatedAt: NOW },
      { id: "att_scenario_demo", orgId: "org_demo_sales", trainingId: "trn_demo", scenarioId: "sales_discount_pushback", createdAt: NOW, updatedAt: NOW }
    ],
    orgStandardScenarioDivisionAssignments: [
      { id: "std_real", orgId: "org_real", scenarioId: "sales_discount_pushback", divisionId: "div_real", createdAt: NOW, updatedAt: NOW },
      { id: "std_demo", orgId: "org_demo_sales", scenarioId: "sales_discount_pushback", divisionId: "div_demo", createdAt: NOW, updatedAt: NOW }
    ],
    trainingPackAssignments: [
      {
        id: "assign_real",
        trainingPackId: "pack_real",
        orgId: "org_real",
        userId: "usr_real",
        active: true,
        assignedAt: NOW,
        assignedByUserId: "usr_demo_sales_rep",
        requiredScenarioIds: ["sales_discount_pushback"],
        completionRule: "scored_required_scenarios_v1",
        startedAt: NOW,
        completedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "assign_demo",
        trainingPackId: "pack_demo",
        orgId: "org_demo_sales",
        userId: "usr_demo_sales_rep",
        active: true,
        assignedAt: NOW,
        assignedByUserId: null,
        requiredScenarioIds: ["sales_discount_pushback"],
        completionRule: "scored_required_scenarios_v1",
        startedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    usageSessions: [
      {
        id: "sess_demo_1",
        userId: "usr_real",
        orgId: "org_real",
        segmentId: "sales_representative",
        scenarioId: "sales_discount_pushback",
        startedAt: NOW,
        endedAt: NOW,
        rawDurationSeconds: 120,
        createdAt: NOW
      }
    ],
    scoreRecords: [
      {
        id: "score_1",
        simulationSessionId: "sim_1",
        userId: "usr_real",
        orgId: "org_real",
        segmentId: "sales_representative",
        scenarioId: "sales_discount_pushback",
        startedAt: NOW,
        endedAt: NOW,
        overallScore: 80,
        persuasion: 80,
        clarity: 80,
        empathy: 80,
        assertiveness: 80,
        createdAt: NOW
      }
    ],
    aiUsageEvents: [
      {
        id: "ai_1",
        kind: "turn",
        userId: "usr_real",
        orgId: "org_real",
        segmentId: "sales_representative",
        scenarioId: "sales_discount_pushback",
        model: "model",
        promptVersion: "prompt",
        rubricVersion: null,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        createdAt: NOW
      }
    ],
    auditEvents: [
      {
        id: "audit_1",
        actorType: "platform_admin",
        actorId: null,
        action: "test",
        orgId: "org_real",
        userId: "usr_real",
        message: "test",
        metadata: null,
        createdAt: NOW
      }
    ],
    supportCases: [
      {
        id: "case_1",
        status: "open",
        userId: "usr_real",
        orgId: "org_real",
        segmentId: null,
        scenarioId: null,
        message: "help",
        transcriptEncrypted: "secret",
        transcriptExpiresAt: NOW,
        transcriptFileName: "transcript.txt",
        transcriptMeta: null,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    mobileAuthTokens: [{ userId: "usr_real", tokenHash: "hash", createdAt: NOW, updatedAt: NOW }],
    emailVerifications: [
      { id: "ev_1", userId: "usr_real", email: "learner@realco.com", codeHash: "hash", createdAt: NOW, expiresAt: NOW, consumedAt: null }
    ],
    webAuthChallenges: [
      { id: "wa_1", userId: "usr_real", email: "learner@realco.com", challengeType: "sign_in", codeHash: "hash", createdAt: NOW, expiresAt: NOW, consumedAt: null }
    ],
    webAuthSessions: [
      {
        sessionId: "web_1",
        userId: "usr_real",
        accessType: "customer_dashboard_user",
        orgId: "org_real",
        createdAt: NOW,
        updatedAt: NOW,
        lastSeenAt: NOW,
        expiresAt: NOW,
        createdUserAgent: null,
        lastSeenUserAgent: null,
        createdIp: null,
        lastSeenIp: null
      }
    ],
    enterpriseJoinRequests: [
      {
        id: "join_1",
        userId: "usr_real",
        email: "learner@realco.com",
        emailDomain: "realco.com",
        orgId: "org_real",
        orgNameSnapshot: "Real Customer",
        joinCodeSnapshot: "REALCODE",
        status: "pending",
        createdAt: NOW,
        expiresAt: NOW,
        updatedAt: NOW,
        decidedAt: null,
        decidedByUserId: null,
        decisionReason: null
      }
    ],
    admin: {
      passwordHash: "salt:hash",
      activeSessionIds: ["adm_1"]
    }
  };
}

test("sanitizer dry-run style transformation does not mutate original app_state", () => {
  const db = makeDb();
  const before = JSON.stringify(db);

  const result = sanitizeAppState(db, "prod-bootstrap");

  assert.equal(JSON.stringify(db), before);
  assert.equal(result.report.before.mobileAuthTokens, 1);
  assert.equal(result.report.after.mobileAuthTokens, 0);
});

test("sanitizer clears session, token, OTP, support, and operational app_state records", () => {
  const { sanitized, report } = sanitizeAppState(makeDb(), "prod-bootstrap");

  assert.deepEqual(sanitized.mobileAuthTokens, []);
  assert.deepEqual(sanitized.emailVerifications, []);
  assert.deepEqual(sanitized.webAuthChallenges, []);
  assert.deepEqual(sanitized.enterpriseJoinRequests, []);
  assert.deepEqual(sanitized.admin.activeSessionIds, []);
  assert.deepEqual(sanitized.usageSessions, []);
  assert.equal(sanitized.scoreRecords, undefined);
  assert.equal(sanitized.aiUsageEvents, undefined);
  assert.equal(sanitized.auditEvents, undefined);
  assert.equal(sanitized.supportCases, undefined);
  assert.equal(sanitized.webAuthSessions, undefined);
  assert.equal(report.deleted.mobileAuthTokens, 1);
  assert.equal(report.deleted.legacySupportCases, 1);
});

test("sanitizer operational table inventory clears performance foundation tables", () => {
  assert(OPERATIONAL_TABLES.includes("performance_plans"));
  assert(OPERATIONAL_TABLES.includes("performance_plan_scope_items"));
  assert(OPERATIONAL_TABLES.includes("performance_plan_audit_events"));
});

test("sanitizer preserves real content/config while removing safely identifiable demo/local records", () => {
  const { sanitized, report } = sanitizeAppState(makeDb(), "staging-refresh");

  assert.deepEqual(sanitized.orgs.map((org) => org.id), ["org_real"]);
  assert.deepEqual(
    sanitized.users.map((user) => user.id).sort(),
    ["usr_real", "usr_stage_review"]
  );
  assert.equal(sanitized.config.activeSegmentId, "project_manager");
  assert.deepEqual(sanitized.orgTrainings.map((training) => training.id), ["trn_real"]);
  assert.deepEqual(sanitized.orgTrainingPackAttachments.map((attachment) => attachment.id), ["att_pack_real"]);
  assert.deepEqual(sanitized.orgTrainingScenarioAttachments.map((attachment) => attachment.id), ["att_scenario_real"]);
  assert.deepEqual(sanitized.orgStandardScenarioDivisionAssignments.map((assignment) => assignment.id), ["std_real"]);
  assert.deepEqual(report.removedOrgIds, ["org_demo_sales"]);
  assert.deepEqual(report.removedUserIds.sort(), ["usr_demo_sales_rep", "usr_local"]);
});

test("sanitizer preserves assignment config but clears assignment progress and invalid assigner references", () => {
  const { sanitized, report } = sanitizeAppState(makeDb(), "prod-bootstrap");
  const assignments = sanitized.trainingPackAssignments;

  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].id, "assign_real");
  assert.equal(assignments[0].startedAt, null);
  assert.equal(assignments[0].completedAt, null);
  assert.equal(assignments[0].assignedByUserId, null);
  assert.equal(report.deleted.trainingPackAssignments, 1);
  assert.equal(report.changed.trainingPackAssignmentsProgressReset, 1);
  assert.equal(report.changed.assignedByUserIdsCleared, 1);
});

