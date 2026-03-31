import assert from "node:assert/strict";
import test from "node:test";

import { ApiDatabase, UserProfile } from "@voicepractice/shared";

import {
  canDashboardViewerAccessCustomerDirectory,
  canDashboardViewerAccessOrg,
  resolveDashboardAccessEligibility,
  resolveDashboardViewer,
} from "./dashboardAuthorization.js";

function createDb(params?: {
  users?: UserProfile[];
  orgs?: Array<{ id: string; name: string; status: "active" | "disabled" }>;
}): ApiDatabase {
  return {
    users: params?.users ?? [],
    orgs: (params?.orgs ?? []).map((org) => ({
      id: org.id,
      name: org.name,
      status: org.status,
    })),
  } as ApiDatabase;
}

function createUser(overrides?: Partial<UserProfile>): UserProfile {
  return {
    id: "user_1",
    email: "user@example.com",
    emailVerifiedAt: "2026-03-30T00:00:00.000Z",
    isPlatformAdmin: false,
    isSuperUser: false,
    dashboardAccessEnabled: true,
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_a",
    orgRole: "org_admin",
    timezone: "America/Denver",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-03-01T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    ...overrides,
  };
}

test("tenant dashboard viewer remains scoped to its own org", () => {
  const user = createUser();
  const db = createDb({
    users: [user],
    orgs: [
      { id: "org_a", name: "Org A", status: "active" },
      { id: "org_b", name: "Org B", status: "active" },
    ],
  });

  const viewer = resolveDashboardViewer(db, user);

  assert.ok(viewer);
  assert.equal(viewer.accessType, "customer_dashboard_user");
  assert.equal(canDashboardViewerAccessCustomerDirectory(viewer), false);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_a"), true);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_b"), false);
});

test("mixed platform_admin plus tenant-valid user keeps tenant-scoped dashboard access only", () => {
  const user = createUser({
    id: "user_mixed",
    email: "mixed@example.com",
    isPlatformAdmin: true,
  });
  const db = createDb({
    users: [user],
    orgs: [
      { id: "org_a", name: "Org A", status: "active" },
      { id: "org_b", name: "Org B", status: "active" },
    ],
  });

  const eligibility = resolveDashboardAccessEligibility(db, user);
  const viewer = resolveDashboardViewer(db, user);

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "customer_dashboard_user");
  assert.ok(viewer);
  assert.equal(viewer.accessType, "customer_dashboard_user");
  assert.equal(canDashboardViewerAccessCustomerDirectory(viewer), false);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_a"), true);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_b"), false);
});

test("super users retain cross-account dashboard access", () => {
  const user = createUser({
    id: "user_super",
    email: "super@example.com",
    isSuperUser: true,
    dashboardAccessEnabled: false,
    accountType: "individual",
    tier: "pro_plus",
    orgId: null,
    orgRole: "user",
  });
  const db = createDb({
    users: [user],
    orgs: [
      { id: "org_a", name: "Org A", status: "active" },
      { id: "org_b", name: "Org B", status: "active" },
    ],
  });

  const viewer = resolveDashboardViewer(db, user);

  assert.ok(viewer);
  assert.equal(viewer.accessType, "super_user");
  assert.equal(canDashboardViewerAccessCustomerDirectory(viewer), true);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_a"), true);
  assert.equal(canDashboardViewerAccessOrg(viewer, "org_b"), true);
});

test("legacy platform_admin alone no longer resolves to a dashboard viewer", () => {
  const user = createUser({
    id: "user_platform_admin",
    email: "platform-admin@example.com",
    isPlatformAdmin: true,
    dashboardAccessEnabled: false,
    accountType: "individual",
    tier: "pro_plus",
    orgId: null,
    orgRole: "user",
  });
  const db = createDb({
    users: [user],
    orgs: [{ id: "org_a", name: "Org A", status: "active" }],
  });

  const eligibility = resolveDashboardAccessEligibility(db, user);
  const viewer = resolveDashboardViewer(db, user);

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "not_enterprise_user");
  assert.equal(viewer, null);
});

test("dashboard-ineligible enterprise user does not resolve a dashboard viewer", () => {
  const user = createUser({
    id: "user_disabled_org",
    email: "disabled-org@example.com",
    orgId: "org_disabled",
  });
  const db = createDb({
    users: [user],
    orgs: [{ id: "org_disabled", name: "Disabled Org", status: "disabled" }],
  });

  const eligibility = resolveDashboardAccessEligibility(db, user);
  const viewer = resolveDashboardViewer(db, user);

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "inactive_org");
  assert.equal(viewer, null);
});

test("enterprise user without dashboard access does not resolve a dashboard viewer", () => {
  const user = createUser({
    id: "user_dashboard_disabled",
    email: "no-dashboard@example.com",
    dashboardAccessEnabled: false,
  });
  const db = createDb({
    users: [user],
    orgs: [{ id: "org_a", name: "Org A", status: "active" }],
  });

  const eligibility = resolveDashboardAccessEligibility(db, user);
  const viewer = resolveDashboardViewer(db, user);

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "dashboard_access_disabled");
  assert.equal(viewer, null);
});

test("disabled enterprise user does not resolve a dashboard viewer", () => {
  const user = createUser({
    id: "user_disabled",
    email: "disabled@example.com",
    status: "disabled",
  });
  const db = createDb({
    users: [user],
    orgs: [{ id: "org_a", name: "Org A", status: "active" }],
  });

  const eligibility = resolveDashboardAccessEligibility(db, user);
  const viewer = resolveDashboardViewer(db, user);

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "inactive_user");
  assert.equal(viewer, null);
});
