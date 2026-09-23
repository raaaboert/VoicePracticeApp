import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardViewer, UserProfile } from "@voicepractice/shared";

import { buildDashboardAdminCapabilities } from "./dashboardAuthorization.js";
import {
  canActorManagePerformanceUser,
  canViewPerformanceTarget,
  canViewOrganizationPerformance,
  getDashboardPermittedUserIds,
  resolvePerformanceAccessLevel,
  resolvePerformanceScope,
} from "./performanceAuthorization.js";
import { canBeAssignedAsManager, isContentManagerSubject } from "./userProfiles.js";

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
    dashboardAccessEnabled: true,
    mobileProfileReonboardingRequired: false,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    performanceAccess: "none",
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

function viewer(actor: UserProfile, accessType: DashboardViewer["accessType"] = "customer_dashboard_user"): DashboardViewer {
  return {
    accessType,
    userId: actor.id,
    email: actor.email,
    isSuperUser: actor.isSuperUser === true,
    orgId: accessType === "super_user" ? null : actor.orgId,
    orgName: accessType === "super_user" ? null : "Org 1",
    orgRole: accessType === "super_user" ? null : actor.orgRole,
    performanceAccess: resolvePerformanceAccessLevel(actor),
    capabilities: buildDashboardAdminCapabilities(accessType === "super_user" ? null : actor.orgRole),
  };
}

function scope(actor: UserProfile, users: UserProfile[], orgIds = new Set(["org_1", "org_2"])): string[] {
  return Array.from(resolvePerformanceScope({ db: { users }, actor, viewer: viewer(actor), orgIds })).sort();
}

test("none grants no dashboard performance or Performance Goal target scope", () => {
  const actor = user("actor", { orgRole: "org_admin", performanceAccess: "none" });
  const target = user("target", { managerUserId: actor.id });

  assert.deepEqual(scope(actor, [actor, target]), []);
  assert.equal(canActorManagePerformanceUser({ actor, viewer: viewer(actor), target }), false);
  assert.equal(canViewOrganizationPerformance({ actor, orgId: "org_1" }), false);
});

test("team includes self and active regular direct reports without recursion or division expansion", () => {
  const actor = user("actor", { performanceAccess: "team", divisionId: "division_a" });
  const direct = user("direct", { managerUserId: actor.id, divisionId: "division_a" });
  const otherDivisionDirect = user("other_division_direct", {
    managerUserId: actor.id,
    divisionId: "division_b",
  });
  const reportOfReport = user("report_of_report", { managerUserId: direct.id });
  const unrelated = user("unrelated", { divisionId: "division_a" });
  const noManager = user("no_manager", { managerUserId: null });
  const inactive = user("inactive", { managerUserId: actor.id, status: "disabled" });
  const crossOrg = user("cross_org", { orgId: "org_2", managerUserId: actor.id });
  const nonRegularDirect = user("non_regular_direct", { managerUserId: actor.id, orgRole: "user_admin" });

  assert.deepEqual(
    scope(actor, [
      actor,
      direct,
      otherDivisionDirect,
      reportOfReport,
      unrelated,
      noManager,
      inactive,
      crossOrg,
      nonRegularDirect,
    ]),
    ["actor", "direct", "other_division_direct"]
  );
  assert.equal(canActorManagePerformanceUser({ actor, viewer: viewer(actor), target: direct }), true);
  assert.equal(canActorManagePerformanceUser({ actor, viewer: viewer(actor), target: unrelated }), false);
});

test("organization includes the current same-org performance population and never crosses tenants", () => {
  const actor = user("actor", { performanceAccess: "organization" });
  const sameOrg = user("same_org");
  const inactiveSameOrg = user("inactive_same_org", { status: "disabled" });
  const sameOrgAdmin = user("same_org_admin", { orgRole: "org_admin" });
  const crossOrg = user("cross_org", { orgId: "org_2" });

  assert.deepEqual(
    scope(actor, [actor, sameOrg, inactiveSameOrg, sameOrgAdmin, crossOrg]),
    ["actor", "inactive_same_org", "same_org", "same_org_admin"]
  );
  assert.equal(canActorManagePerformanceUser({ actor, viewer: viewer(actor), target: sameOrg }), true);
  assert.equal(canActorManagePerformanceUser({ actor, viewer: viewer(actor), target: crossOrg }), false);
  assert.equal(canViewOrganizationPerformance({ actor, orgId: "org_1" }), true);
  assert.equal(canViewOrganizationPerformance({ actor, orgId: "org_2" }), false);
});

test("performance scope follows performanceAccess independently from admin and content eligibility", () => {
  const report = user("report", { managerUserId: "actor" });
  const cases = [
    { orgRole: "user", performanceAccess: "none", expected: [] },
    { orgRole: "user_admin", performanceAccess: "none", expected: [] },
    { orgRole: "user", performanceAccess: "team", expected: ["actor", "report"] },
    { orgRole: "user_admin", performanceAccess: "team", expected: ["actor", "report"] },
    { orgRole: "user", performanceAccess: "organization", expected: ["actor", "report", "unrelated"] },
    { orgRole: "user_admin", performanceAccess: "organization", expected: ["actor", "report", "unrelated"] },
  ] as const;

  for (const testCase of cases) {
    const actor = user("actor", {
      orgRole: testCase.orgRole,
      performanceAccess: testCase.performanceAccess,
    });
    const unrelated = user("unrelated");
    assert.deepEqual(scope(actor, [actor, report, unrelated]), [...testCase.expected], `${testCase.orgRole}/${testCase.performanceAccess}`);
  }

  const orgAdminNone = user("org_admin_none", { orgRole: "org_admin", performanceAccess: "none" });
  assert.equal(buildDashboardAdminCapabilities(orgAdminNone.orgRole).manageUserRoles, true);
  assert.deepEqual(scope(orgAdminNone, [orgAdminNone, report]), []);

  const userOrganization = user("user_organization", { performanceAccess: "organization" });
  assert.equal(buildDashboardAdminCapabilities(userOrganization.orgRole).viewOrganizationUsers, false);
  assert.deepEqual(scope(userOrganization, [userOrganization, report]), ["report", "user_organization"]);

  const userAdminNone = user("user_admin_none", { orgRole: "user_admin", performanceAccess: "none" });
  assert.equal(canBeAssignedAsManager(userAdminNone, "org_1"), true);
  assert.equal(isContentManagerSubject(userAdminNone, "org_1"), true);

  const regularTeam = user("regular_team", { performanceAccess: "team" });
  assert.equal(canBeAssignedAsManager(regularTeam, "org_1"), false);
  assert.equal(isContentManagerSubject(regularTeam, "org_1"), false);
});

test("legacy role-derived states preserve their previous active-user result sets", () => {
  const orgAdmin = user("org_admin", { orgRole: "org_admin", performanceAccess: undefined });
  const userAdmin = user("user_admin", { orgRole: "user_admin", performanceAccess: undefined });
  const direct = user("direct", { managerUserId: userAdmin.id });
  const unrelated = user("unrelated");
  const users = [orgAdmin, userAdmin, direct, unrelated];

  const legacyScope = (actor: UserProfile): string[] => users
    .filter((target) => {
      if (actor.orgRole === "org_admin") {
        return actor.orgId === target.orgId;
      }
      return actor.orgRole === "user_admin" && actor.orgId === target.orgId && (
        target.id === actor.id || (target.orgRole === "user" && target.managerUserId === actor.id)
      );
    })
    .map((target) => target.id)
    .sort();

  assert.deepEqual(scope(orgAdmin, users), legacyScope(orgAdmin));
  assert.deepEqual(scope(userAdmin, users), legacyScope(userAdmin));
  assert.deepEqual(scope(user("regular", { performanceAccess: undefined }), users), []);
});

test("super-user performance scope ignores informational access but stays inside caller-authorized organizations", () => {
  const actor = user("super", {
    accountType: "individual",
    tier: "free",
    orgId: null,
    isSuperUser: true,
    isPlatformAdmin: true,
    performanceAccess: "none",
  });
  const orgOne = user("org_one");
  const orgTwo = user("org_two", { orgId: "org_2" });
  const individual = user("individual", { accountType: "individual", tier: "free", orgId: null });

  assert.deepEqual(
    Array.from(getDashboardPermittedUserIds({
      db: { users: [actor, orgOne, orgTwo, individual] },
      actor,
      viewer: viewer(actor, "super_user"),
      orgIds: new Set(["org_2"]),
    })),
    ["org_two"]
  );

  const enterpriseSuper = user("enterprise_super", {
    orgRole: "org_admin",
    isSuperUser: true,
    performanceAccess: "none",
  });
  assert.equal(canViewOrganizationPerformance({ actor: enterpriseSuper, orgId: "org_1" }), true);
  assert.equal(canViewPerformanceTarget({ actor: enterpriseSuper, target: orgOne }), true);
  assert.equal(
    canActorManagePerformanceUser({ actor: enterpriseSuper, viewer: viewer(enterpriseSuper), target: orgOne }),
    false
  );
});
