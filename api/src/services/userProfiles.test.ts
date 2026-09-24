import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFORMANCE_ACCESS_LEVELS,
  isPerformanceAccessLevel,
  type UserProfile,
} from "@voicepractice/shared";

import {
  canBeAssignedAsManager,
  isContentManagerSubject,
  normalizePerformanceAccess,
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

test("performance access contract accepts only the canonical levels", () => {
  assert.deepEqual(PERFORMANCE_ACCESS_LEVELS, ["none", "team", "organization"]);
  for (const level of PERFORMANCE_ACCESS_LEVELS) {
    assert.equal(isPerformanceAccessLevel(level), true);
  }
  assert.equal(isPerformanceAccessLevel("org_admin"), false);
  assert.equal(isPerformanceAccessLevel(""), false);
});

test("performance access normalization preserves valid explicit enterprise values", () => {
  assert.equal(normalizePerformanceAccess(user("org_admin_none", {
    orgRole: "org_admin",
    performanceAccess: "none",
  })), "none");
  assert.equal(normalizePerformanceAccess(user("regular_team", {
    orgRole: "user",
    performanceAccess: "team",
  })), "team");
  assert.equal(normalizePerformanceAccess(user("regular_organization", {
    orgRole: "user",
    performanceAccess: "organization",
  })), "organization");
});

test("performance access normalization fails closed for missing and malformed values regardless of org role", () => {
  assert.equal(normalizePerformanceAccess(user("org_admin", { orgRole: "org_admin" })), "none");
  assert.equal(normalizePerformanceAccess(user("user_admin", { orgRole: "user_admin" })), "none");
  assert.equal(normalizePerformanceAccess(user("regular_user", { orgRole: "user" })), "none");
  assert.equal(normalizePerformanceAccess({
    ...user("invalid_user_admin", { orgRole: "user_admin" }),
    performanceAccess: "invalid",
  }), "none");
  assert.equal(normalizePerformanceAccess({
    ...user("uppercase_user_admin", { orgRole: "user_admin" }),
    performanceAccess: "TEAM",
  }), "none");
});

test("performance access normalization forces non-enterprise and no-org users to none", () => {
  assert.equal(normalizePerformanceAccess(user("individual", {
    accountType: "individual",
    tier: "free",
    orgId: null,
    orgRole: "org_admin",
    performanceAccess: "organization",
  })), "none");
  assert.equal(normalizePerformanceAccess(user("missing_org", {
    orgId: null,
    orgRole: "org_admin",
    performanceAccess: "organization",
  })), "none");
  assert.equal(normalizePerformanceAccess(user("unknown_org", {
    orgId: "org_unknown",
    orgRole: "org_admin",
    performanceAccess: "organization",
  }), new Set(["org_1"])), "none");
});

test("canBeAssignedAsManager accepts every active same-org enterprise role independently from permissions", () => {
  assert.equal(canBeAssignedAsManager(user("user_admin", { orgRole: "user_admin" }), "org_1"), true);
  assert.equal(canBeAssignedAsManager(user("org_admin", { orgRole: "org_admin" }), "org_1"), true);
  for (const performanceAccess of PERFORMANCE_ACCESS_LEVELS) {
    const regularManager = user(`regular_${performanceAccess}`, {
      performanceAccess,
      dashboardAccessEnabled: performanceAccess !== "none",
      managerUserId: "another_manager",
    });
    assert.equal(canBeAssignedAsManager(regularManager, "org_1"), true, performanceAccess);
    assert.equal(isContentManagerSubject(regularManager, "org_1"), false, performanceAccess);
  }
  assert.equal(
    canBeAssignedAsManager(user("user_admin_none", { orgRole: "user_admin", performanceAccess: "none" }), "org_1"),
    true
  );
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

test("manager assignment validation accepts every eligible role and rejects invalid candidates", () => {
  const target = user("report");
  const validManagers = [
    user("regular_manager", { performanceAccess: "none", managerUserId: "regular_manager_manager" }),
    user("user_admin_manager", { orgRole: "user_admin", performanceAccess: "none" }),
    user("org_admin_manager", { orgRole: "org_admin" }),
  ];
  const invalidManagers = [
    user("cross_org_manager", { orgRole: "user_admin", orgId: "org_2" }),
    user("inactive_manager", { orgRole: "user_admin", status: "disabled" }),
    user("individual_manager", { accountType: "individual", tier: "free", orgId: null }),
  ];

  for (const manager of validManagers) {
    const valid = validateManagerAssignment({
      orgUsers: [target, ...validManagers, ...invalidManagers],
      target,
      managerUserId: manager.id,
    });
    assert.equal(valid.ok, true, manager.id);
    if (valid.ok) {
      assert.equal(valid.manager?.id, manager.id);
    }
  }

  for (const manager of invalidManagers) {
    const result = validateManagerAssignment({
      orgUsers: [target, ...validManagers, ...invalidManagers],
      target,
      managerUserId: manager.id,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "manager_invalid");
    }
  }

  const missingManager = validateManagerAssignment({
    orgUsers: [target, ...validManagers],
    target,
    managerUserId: "missing_manager",
  });
  assert.equal(missingManager.ok, false);

  const selfAssignment = validateManagerAssignment({
    orgUsers: [target, ...validManagers],
    target,
    managerUserId: target.id,
  });
  assert.equal(selfAssignment.ok, false);
  if (!selfAssignment.ok) {
    assert.equal(selfAssignment.code, "manager_invalid");
  }
});

test("repairInvalidManagerAssignments preserves every eligible manager role and clears stale relationships", () => {
  const regularManager = user("regular_manager");
  const userAdminManager = user("user_admin_manager", { orgRole: "user_admin" });
  const orgAdminManager = user("org_admin_manager", { orgRole: "org_admin" });
  const inactiveManager = user("inactive_manager", { status: "disabled" });
  const crossOrgManager = user("cross_org_manager", { orgId: "org_2" });
  const individualManager = user("individual_manager", { accountType: "individual", tier: "free", orgId: null });
  const reportWithRegularManager = user("regular_report", { managerUserId: regularManager.id });
  const reportWithUserAdminManager = user("user_admin_report", { managerUserId: userAdminManager.id });
  const reportWithOrgAdminManager = user("org_admin_report", { managerUserId: orgAdminManager.id });
  const reportWithInactiveManager = user("inactive_report", { managerUserId: inactiveManager.id });
  const reportWithCrossOrgManager = user("cross_org_report", { managerUserId: crossOrgManager.id });
  const reportWithIndividualManager = user("individual_report", { managerUserId: individualManager.id });
  const reportWithMissingManager = user("missing_report", { managerUserId: "missing_manager" });
  const selfManagedReport = user("self_report", { managerUserId: "self_report" });
  const users = [
    regularManager,
    userAdminManager,
    orgAdminManager,
    inactiveManager,
    crossOrgManager,
    individualManager,
    reportWithRegularManager,
    reportWithUserAdminManager,
    reportWithOrgAdminManager,
    reportWithInactiveManager,
    reportWithCrossOrgManager,
    reportWithIndividualManager,
    reportWithMissingManager,
    selfManagedReport,
  ];

  assert.deepEqual(repairInvalidManagerAssignments(users, "2026-09-22T13:00:00.000Z"), [
    reportWithInactiveManager.id,
    reportWithCrossOrgManager.id,
    reportWithIndividualManager.id,
    reportWithMissingManager.id,
    selfManagedReport.id,
  ]);
  assert.equal(reportWithRegularManager.managerUserId, regularManager.id);
  assert.equal(reportWithUserAdminManager.managerUserId, userAdminManager.id);
  assert.equal(reportWithOrgAdminManager.managerUserId, orgAdminManager.id);
  assert.equal(reportWithInactiveManager.managerUserId, null);
  assert.equal(reportWithCrossOrgManager.managerUserId, null);
  assert.equal(reportWithIndividualManager.managerUserId, null);
  assert.equal(reportWithMissingManager.managerUserId, null);
  assert.equal(selfManagedReport.managerUserId, null);
});

test("manager repair is independent from performance access changes", () => {
  const manager = user("manager", { performanceAccess: "none" });
  const report = user("report", { managerUserId: manager.id });

  for (const performanceAccess of PERFORMANCE_ACCESS_LEVELS) {
    manager.performanceAccess = performanceAccess;
    assert.deepEqual(repairInvalidManagerAssignments([manager, report], NOW), []);
    assert.equal(report.managerUserId, manager.id);
    assert.equal(manager.managerUserId, null);
  }
});
