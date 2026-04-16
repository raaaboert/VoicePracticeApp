import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApiDatabase,
  EnterpriseOrg,
  OrgDivisionRecord,
  OrgStandardScenarioDivisionAssignmentRecord,
  OrgTrainingRecord,
  UserProfile,
} from "@voicepractice/shared";

import {
  clearDivisionAssignmentsForDeletedDivision,
  isDivisionVisibleToUser,
  listOrgVisibleStandardScenarios,
  resolveLiveDivisionAttribution,
} from "./orgDivisions.js";

function createDivision(overrides: Partial<OrgDivisionRecord>): OrgDivisionRecord {
  return {
    id: overrides.id ?? "division_a",
    orgId: overrides.orgId ?? "org_1",
    name: overrides.name ?? "Division A",
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? "2026-04-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T00:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

function createUser(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    emailVerifiedAt: overrides.emailVerifiedAt ?? "2026-04-15T00:00:00.000Z",
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId ?? "org_1",
    orgRole: overrides.orgRole ?? "user",
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "America/Denver",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-04-01T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-04-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T00:00:00.000Z",
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? false,
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
  };
}

function createTraining(overrides: Partial<OrgTrainingRecord>): OrgTrainingRecord {
  return {
    id: overrides.id ?? "training_1",
    orgId: overrides.orgId ?? "org_1",
    name: overrides.name ?? "Training 1",
    status: overrides.status ?? "active",
    description: overrides.description ?? "",
    divisionId: overrides.divisionId ?? null,
    createdAt: overrides.createdAt ?? "2026-04-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T00:00:00.000Z",
  };
}

function createAssignment(
  overrides: Partial<OrgStandardScenarioDivisionAssignmentRecord>
): OrgStandardScenarioDivisionAssignmentRecord {
  return {
    id: overrides.id ?? "assignment_1",
    orgId: overrides.orgId ?? "org_1",
    scenarioId: overrides.scenarioId ?? "scenario_standard_1",
    divisionId: overrides.divisionId ?? "division_a",
    createdAt: overrides.createdAt ?? "2026-04-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T00:00:00.000Z",
  };
}

function createDb(overrides?: Partial<ApiDatabase>): ApiDatabase {
  return {
    config: overrides?.config ?? {
      activeSegmentId: "sales",
      defaultDifficulty: "medium",
      defaultPersonaStyle: "skeptical",
      industries: [],
      roleIndustries: [],
      segments: [],
      tiers: [],
      enterprise: {
        visibleInApp: true,
        contactEmail: "support@example.com",
        contactUrl: "https://example.com",
        defaultOrgDailySecondsQuota: 0,
        defaultPerUserDailySecondsCap: 0,
        allowManualBonusSeconds: true,
      },
      featureFlags: {
        scoringEnabled: true,
        customScenarioBuilder: true,
      },
      updatedAt: "2026-04-15T00:00:00.000Z",
    },
    users: overrides?.users ?? [],
    orgs: overrides?.orgs ?? [],
    orgDivisions: overrides?.orgDivisions ?? [],
    orgTrainings: overrides?.orgTrainings ?? [],
    orgTrainingPackAttachments: overrides?.orgTrainingPackAttachments ?? [],
    orgTrainingScenarioAttachments: overrides?.orgTrainingScenarioAttachments ?? [],
    orgStandardScenarioDivisionAssignments: overrides?.orgStandardScenarioDivisionAssignments ?? [],
    trainingPackAssignments: overrides?.trainingPackAssignments ?? [],
    usageSessions: overrides?.usageSessions ?? [],
    scoreRecords: overrides?.scoreRecords ?? [],
    aiUsageEvents: overrides?.aiUsageEvents ?? [],
    auditEvents: overrides?.auditEvents ?? [],
    supportCases: overrides?.supportCases ?? [],
    mobileAuthTokens: overrides?.mobileAuthTokens ?? [],
    emailVerifications: overrides?.emailVerifications ?? [],
    webAuthChallenges: overrides?.webAuthChallenges ?? [],
    webAuthSessions: overrides?.webAuthSessions ?? [],
    enterpriseJoinRequests: overrides?.enterpriseJoinRequests ?? [],
    admin: overrides?.admin ?? {
      passwordHash: null,
      activeSessionIds: [],
    },
  };
}

function createOrg(overrides?: Partial<EnterpriseOrg>): EnterpriseOrg {
  return {
    id: overrides?.id ?? "org_1",
    name: overrides?.name ?? "Org 1",
    status: overrides?.status ?? "active",
    contactName: overrides?.contactName ?? "Org Admin",
    contactEmail: overrides?.contactEmail ?? "admin@example.com",
    emailDomain: overrides?.emailDomain ?? "example.com",
    joinCode: overrides?.joinCode ?? "JOINME",
    dailySecondsQuota: overrides?.dailySecondsQuota ?? 0,
    perUserDailySecondsCap: overrides?.perUserDailySecondsCap ?? 0,
    pendingPerUserDailySecondsCap: overrides?.pendingPerUserDailySecondsCap ?? null,
    pendingPerUserDailySecondsCapEffectiveAt: overrides?.pendingPerUserDailySecondsCapEffectiveAt ?? null,
    manualBonusSeconds: overrides?.manualBonusSeconds ?? 0,
    monthlyMinutesAllotted: overrides?.monthlyMinutesAllotted ?? 0,
    renewalTotalUsd: overrides?.renewalTotalUsd ?? 0,
    softLimitPercentTriggers: overrides?.softLimitPercentTriggers ?? [],
    maxSimulationMinutes: overrides?.maxSimulationMinutes ?? 20,
    contractSignedAt: overrides?.contractSignedAt ?? "2026-04-15T00:00:00.000Z",
    createdAt: overrides?.createdAt ?? "2026-04-15T00:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? "2026-04-15T00:00:00.000Z",
    activeIndustries: overrides?.activeIndustries ?? ["solar"],
    customScenarios: overrides?.customScenarios ?? [],
    divisionsEnabled: overrides?.divisionsEnabled ?? false,
  };
}

test("resolveLiveDivisionAttribution returns a matching training division when user and training align", () => {
  const db = createDb({
    users: [createUser({ divisionId: "division_a" })],
    orgTrainings: [createTraining({ id: "training_a", divisionId: "division_a" })],
    orgDivisions: [createDivision({ id: "division_a" })],
  });

  const divisionId = resolveLiveDivisionAttribution({
    db,
    orgId: "org_1",
    user: db.users[0]!,
    trainingId: "training_a",
    scenarioSource: "custom",
    scenarioId: "scenario_custom_1",
    divisionsEnabled: true,
  });

  assert.equal(divisionId, "division_a");
});

test("resolveLiveDivisionAttribution does not stamp user-only assignment for general content", () => {
  const db = createDb({
    users: [createUser({ divisionId: "division_a" })],
    orgDivisions: [createDivision({ id: "division_a" })],
  });

  const divisionId = resolveLiveDivisionAttribution({
    db,
    orgId: "org_1",
    user: db.users[0]!,
    trainingId: null,
    scenarioSource: "standard",
    scenarioId: "scenario_standard_1",
    divisionsEnabled: true,
  });

  assert.equal(divisionId, null);
});

test("resolveLiveDivisionAttribution uses standard scenario overlay only for standard scenarios", () => {
  const db = createDb({
    users: [createUser({ divisionId: "division_a" })],
    orgDivisions: [createDivision({ id: "division_a" })],
    orgStandardScenarioDivisionAssignments: [createAssignment({ scenarioId: "scenario_standard_1" })],
  });

  assert.equal(
    resolveLiveDivisionAttribution({
      db,
      orgId: "org_1",
      user: db.users[0]!,
      trainingId: null,
      scenarioSource: "standard",
      scenarioId: "scenario_standard_1",
      divisionsEnabled: true,
    }),
    "division_a"
  );

  assert.equal(
    resolveLiveDivisionAttribution({
      db,
      orgId: "org_1",
      user: db.users[0]!,
      trainingId: null,
      scenarioSource: "custom",
      scenarioId: "scenario_standard_1",
      divisionsEnabled: true,
    }),
    null
  );
});

test("resolveLiveDivisionAttribution ignores inactive divisions", () => {
  const db = createDb({
    users: [createUser({ divisionId: "division_a" })],
    orgTrainings: [createTraining({ id: "training_a", divisionId: "division_a" })],
    orgDivisions: [createDivision({ id: "division_a", active: false, deletedAt: "2026-04-15T01:00:00.000Z" })],
  });

  const divisionId = resolveLiveDivisionAttribution({
    db,
    orgId: "org_1",
    user: db.users[0]!,
    trainingId: "training_a",
    scenarioSource: "custom",
    scenarioId: "scenario_custom_1",
    divisionsEnabled: true,
  });

  assert.equal(divisionId, null);
});

test("isDivisionVisibleToUser preserves general content and blocks mismatched division content", () => {
  assert.equal(
    isDivisionVisibleToUser({ divisionsEnabled: false, userDivisionId: null, contentDivisionId: "division_a" }),
    true
  );
  assert.equal(
    isDivisionVisibleToUser({ divisionsEnabled: true, userDivisionId: null, contentDivisionId: null }),
    true
  );
  assert.equal(
    isDivisionVisibleToUser({ divisionsEnabled: true, userDivisionId: "division_a", contentDivisionId: "division_a" }),
    true
  );
  assert.equal(
    isDivisionVisibleToUser({ divisionsEnabled: true, userDivisionId: "division_a", contentDivisionId: "division_b" }),
    false
  );
});

test("clearDivisionAssignmentsForDeletedDivision clears live assignments and preserves unrelated records", () => {
  const db = createDb({
    users: [
      createUser({ id: "user_a", divisionId: "division_a" }),
      createUser({ id: "user_b", divisionId: "division_b" }),
    ],
    orgTrainings: [
      createTraining({ id: "training_a", divisionId: "division_a" }),
      createTraining({ id: "training_b", divisionId: "division_b" }),
    ],
    orgDivisions: [createDivision({ id: "division_a" }), createDivision({ id: "division_b", name: "Division B" })],
    orgStandardScenarioDivisionAssignments: [
      createAssignment({ id: "assignment_a", scenarioId: "scenario_a", divisionId: "division_a" }),
      createAssignment({ id: "assignment_b", scenarioId: "scenario_b", divisionId: "division_b" }),
    ],
  });

  const result = clearDivisionAssignmentsForDeletedDivision({
    db,
    orgId: "org_1",
    divisionId: "division_a",
  });

  assert.deepEqual(result, {
    clearedUserCount: 1,
    clearedTrainingCount: 1,
    clearedStandardScenarioAssignmentCount: 1,
  });
  assert.equal(db.users[0]?.divisionId, null);
  assert.equal(db.users[1]?.divisionId, "division_b");
  assert.equal(db.orgTrainings[0]?.divisionId, null);
  assert.equal(db.orgTrainings[1]?.divisionId, "division_b");
  assert.deepEqual(
    db.orgStandardScenarioDivisionAssignments.map((entry) => entry.id),
    ["assignment_b"]
  );
});

test("listOrgVisibleStandardScenarios scopes standard scenarios to active company industries", () => {
  const db = createDb({
    config: {
      activeSegmentId: "sales_segment",
      defaultDifficulty: "medium",
      defaultPersonaStyle: "skeptical",
      industries: [
        { id: "solar", label: "Solar", enabled: true },
        { id: "medical", label: "Medical", enabled: true },
      ],
      roleIndustries: [
        { roleId: "sales_segment", industryId: "solar", active: true },
        { roleId: "medical_segment", industryId: "medical", active: true },
      ],
      segments: [
        {
          id: "sales_segment",
          label: "Sales",
          summary: "Sales summary",
          enabled: true,
          scenarios: [
            {
              id: "scenario_sales",
              segmentId: "sales_segment",
              title: "Solar Scenario",
              description: "Solar scenario",
              aiRole: "Buyer",
              enabled: true,
            },
          ],
        },
        {
          id: "medical_segment",
          label: "Medical",
          summary: "Medical summary",
          enabled: true,
          scenarios: [
            {
              id: "scenario_medical",
              segmentId: "medical_segment",
              title: "Medical Scenario",
              description: "Medical scenario",
              aiRole: "Patient",
              enabled: true,
            },
          ],
        },
      ],
      tiers: [],
      enterprise: {
        visibleInApp: true,
        contactEmail: "support@example.com",
        contactUrl: "https://example.com",
        defaultOrgDailySecondsQuota: 0,
        defaultPerUserDailySecondsCap: 0,
        allowManualBonusSeconds: true,
      },
      featureFlags: {
        scoringEnabled: true,
        customScenarioBuilder: true,
      },
      updatedAt: "2026-04-15T00:00:00.000Z",
    },
  });

  const rows = listOrgVisibleStandardScenarios({
    config: db.config,
    org: createOrg({ activeIndustries: ["solar"] }),
  });

  assert.deepEqual(rows.map((row) => row.scenarioId), ["scenario_sales"]);
});
