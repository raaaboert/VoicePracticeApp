import assert from "node:assert/strict";
import test from "node:test";

import type { UserEntitlementsResponse, UserProfile } from "@voicepractice/shared";

import {
  buildOrganizationPlanDetails,
  canAccessOrganizationPlan,
  canSubmitOrganizationPlanSupport,
  formatOrganizationPlanDuration,
  ORGANIZATION_PLAN_SCREEN,
  resolveOrganizationPlanScreen,
} from "./organizationPlan";

function buildUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user_1",
    email: "user@example.test",
    employeeId: null,
    emailVerifiedAt: "2026-08-10T00:00:00.000Z",
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-08-01T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function buildEntitlements(): UserEntitlementsResponse {
  return {
    userId: "user_1",
    tier: "enterprise",
    accountType: "enterprise",
    status: "active",
    features: {
      support: true,
      customScenarioBuilder: false,
    },
    limits: {
      dailySecondsLimit: null,
      orgDailySecondsQuota: 3600,
      perUserDailySecondsCap: 1800,
      orgMonthlySecondsAllotted: 864_000,
      maxSimulationMinutes: 20,
      manualBonusSeconds: 0,
      billingIncrementSeconds: 15,
    },
    usage: {
      rawSecondsToday: 0,
      billedSecondsToday: 0,
      rawSecondsThisMonth: 5_460,
      billedSecondsThisMonth: 5_460,
      dailySecondsRemaining: 1800,
      orgBillingPeriodStartAt: "2026-08-01T00:00:00.000Z",
      orgBillingPeriodEndAt: "2026-09-01T00:00:00.000Z",
      orgUsedSecondsThisPeriod: 5_460,
      orgAllottedSecondsThisPeriod: 864_000,
      orgRemainingSecondsThisPeriod: 858_540,
      orgUsagePercentThisPeriod: 1,
      userDailyCapSeconds: 1800,
      userDailyOverageAllowed: false,
      dayKey: "2026-08-10",
      monthKey: "2026-08",
      timezoneUsed: "America/Denver",
      nextDailyResetLabel: "Tomorrow",
      nextRenewalAt: "2026-09-01T00:00:00.000Z",
    },
    canStartSimulation: true,
    lockReason: null,
    lockCode: null,
  };
}

test("regular users and user admins cannot access Organization Plan", () => {
  assert.equal(canAccessOrganizationPlan(buildUser({ orgRole: "user" })), false);
  assert.equal(canAccessOrganizationPlan(buildUser({ orgRole: "user_admin" })), false);
});

test("organization admins can access Organization Plan", () => {
  assert.equal(canAccessOrganizationPlan(buildUser({ orgRole: "org_admin" })), true);
});

test("existing platform-level mobile access remains available", () => {
  assert.equal(canAccessOrganizationPlan(buildUser({ accountType: "individual", orgId: null, isSuperUser: true })), true);
  assert.equal(canAccessOrganizationPlan(buildUser({ accountType: "individual", orgId: null, isPlatformAdmin: true })), true);
});

test("direct unauthorized Organization Plan navigation resolves back to Home", () => {
  assert.equal(resolveOrganizationPlanScreen(ORGANIZATION_PLAN_SCREEN, buildUser({ orgRole: "user" })), "home");
  assert.equal(resolveOrganizationPlanScreen(ORGANIZATION_PLAN_SCREEN, buildUser({ orgRole: "user_admin" })), "home");
  assert.equal(
    resolveOrganizationPlanScreen(ORGANIZATION_PLAN_SCREEN, buildUser({ orgRole: "org_admin" })),
    ORGANIZATION_PLAN_SCREEN
  );
});

test("Organization Plan support requires non-whitespace input and blocks duplicate submission", () => {
  assert.equal(canSubmitOrganizationPlanSupport("", false), false);
  assert.equal(canSubmitOrganizationPlanSupport("   \n  ", false), false);
  assert.equal(canSubmitOrganizationPlanSupport("Please help with our account.", false), true);
  assert.equal(canSubmitOrganizationPlanSupport("Please help with our account.", true), false);
});

test("Organization Plan uses authoritative organization cycle values without price fields", () => {
  const details = buildOrganizationPlanDetails(buildEntitlements());

  assert.equal(details.planName, "Enterprise");
  assert.equal(details.status, "Active");
  assert.equal(details.usageThisCycle, "1 hour 31 minutes");
  assert.equal(details.organizationAllocation, "240 hours");
  assert.equal(details.remainingThisCycle, "238 hours 29 minutes");
  assert.match(details.cycleResets ?? "", /2026/);
  assert.equal("price" in details, false);
  assert.doesNotMatch(JSON.stringify(details), /free|pro|\$|other plans|licensing is available/i);
});

test("duration formatting omits seconds and remains readable", () => {
  assert.equal(formatOrganizationPlanDuration(0), "0 minutes");
  assert.equal(formatOrganizationPlanDuration(30), "<1 minute");
  assert.equal(formatOrganizationPlanDuration(60), "1 minute");
  assert.equal(formatOrganizationPlanDuration(3_661), "1 hour 1 minute");
  assert.equal(formatOrganizationPlanDuration(864_000), "240 hours");
  assert.doesNotMatch(formatOrganizationPlanDuration(3_661), /second|\d+s\b/i);
});

test("cycle reset is omitted when organization-cycle data is unavailable or invalid", () => {
  const noOrgCycle = buildEntitlements();
  noOrgCycle.usage.orgUsedSecondsThisPeriod = null;
  assert.equal(buildOrganizationPlanDetails(noOrgCycle).cycleResets, null);

  const invalidReset = buildEntitlements();
  invalidReset.usage.nextRenewalAt = "not-a-date";
  assert.equal(buildOrganizationPlanDetails(invalidReset).cycleResets, null);
});
