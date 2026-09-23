import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfile } from "@voicepractice/shared";

import {
  canBeAssignedAsManager,
  repairInvalidManagerAssignments,
  validateManagerAssignment,
} from "./userProfiles.js";

const NOW = "2026-09-22T12:00:00.000Z";

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    firstName: id,
    lastName: "User",
    employeeId: null,
    managerUserId: null,
    emailVerifiedAt: NOW,
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: false,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    divisionId: null,
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
    ...overrides,
  };
}

test("canBeAssignedAsManager preserves the current relationship eligibility rule", () => {
  assert.equal(canBeAssignedAsManager(user("user_admin", { orgRole: "user_admin" }), "org_1"), true);
  assert.equal(canBeAssignedAsManager(user("regular_user"), "org_1"), false);
  assert.equal(canBeAssignedAsManager(user("org_admin", { orgRole: "org_admin" }), "org_1"), false);
  assert.equal(
    canBeAssignedAsManager(user("inactive_admin", { orgRole: "user_admin", status: "disabled" }), "org_1"),
    false
  );
  assert.equal(
    canBeAssignedAsManager(user("cross_org_admin", { orgRole: "user_admin", orgId: "org_2" }), "org_1"),
    false
  );
  assert.equal(
    canBeAssignedAsManager(
      user("individual", { accountType: "individual", tier: "free", orgId: null, orgRole: "user" }),
      "org_1"
    ),
    false
  );
  assert.equal(canBeAssignedAsManager(user("missing_org", { orgRole: "user_admin", orgId: null }), "org_1"), false);
});

test("manager assignment validation preserves current acceptance and rejection rules", () => {
  const target = user("report");
  const validManager = user("valid_manager", { orgRole: "user_admin" });
  const invalidManagers = [
    user("regular_manager"),
    user("cross_org_manager", { orgRole: "user_admin", orgId: "org_2" }),
    user("inactive_manager", { orgRole: "user_admin", status: "disabled" }),
  ];

  const valid = validateManagerAssignment({
    orgUsers: [target, validManager, ...invalidManagers],
    target,
    managerUserId: validManager.id,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.manager?.id, validManager.id);
  }

  for (const manager of invalidManagers) {
    const result = validateManagerAssignment({
      orgUsers: [target, validManager, ...invalidManagers],
      target,
      managerUserId: manager.id,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "manager_invalid");
    }
  }

  const selfAssignment = validateManagerAssignment({
    orgUsers: [target, validManager],
    target,
    managerUserId: target.id,
  });
  assert.equal(selfAssignment.ok, false);
  if (!selfAssignment.ok) {
    assert.equal(selfAssignment.code, "manager_invalid");
  }
});

test("repairInvalidManagerAssignments preserves valid relationships and clears stale ones deterministically", () => {
  const validManager = user("valid_manager", { orgRole: "user_admin" });
  const regularManager = user("regular_manager");
  const reportWithValidManager = user("valid_report", { managerUserId: validManager.id });
  const reportWithRegularManager = user("regular_report", { managerUserId: regularManager.id });
  const reportWithMissingManager = user("missing_report", { managerUserId: "missing_manager" });
  const selfManagedReport = user("self_report", { managerUserId: "self_report" });
  const users = [
    validManager,
    regularManager,
    reportWithValidManager,
    reportWithRegularManager,
    reportWithMissingManager,
    selfManagedReport,
  ];

  assert.deepEqual(repairInvalidManagerAssignments(users, "2026-09-22T13:00:00.000Z"), [
    reportWithRegularManager.id,
    reportWithMissingManager.id,
    selfManagedReport.id,
  ]);
  assert.equal(reportWithValidManager.managerUserId, validManager.id);
  assert.equal(reportWithRegularManager.managerUserId, null);
  assert.equal(reportWithMissingManager.managerUserId, null);
  assert.equal(selfManagedReport.managerUserId, null);
});
