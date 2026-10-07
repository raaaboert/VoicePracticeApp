import assert from "node:assert/strict";
import test from "node:test";
import type { UserProfile } from "@voicepractice/shared";
import {
  canAdministerOrganizationUsers,
  canDecideCustomerAccessRequests,
  canEditCustomerUserField,
  canChangeCustomerUserStatus,
  canManageCustomerRegularUser,
  canViewCustomerOrganizationUser,
} from "./customerUserAdministrationPolicy.js";

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    employeeId: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    accountType: "enterprise",
    tier: "enterprise",
    status: "active",
    orgId: "org_1",
    orgRole: "user",
    timezone: "UTC",
    pendingTimezone: null,
    pendingTimezoneEffectiveAt: null,
    planAnchorAt: "2026-01-01T00:00:00.000Z",
    manualBonusSeconds: 0,
    dailySecondsCapOverride: null,
    allowDailyOverageThisCycle: false,
    dailyOverageExpiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("User Admin sees all same-organization users while privileged targets remain read-only", () => {
  const actor = user("user_admin", { orgRole: "user_admin" });
  const unassigned = user("unassigned");
  const regularManager = user("regular_manager");
  const peerAdmin = user("peer_admin", { orgRole: "user_admin" });
  const orgAdmin = user("org_admin", { orgRole: "org_admin" });
  for (const target of [unassigned, regularManager, peerAdmin, orgAdmin]) {
    assert.equal(canViewCustomerOrganizationUser({ actor }, target), true);
  }
  assert.equal(canManageCustomerRegularUser({ actor }, unassigned), true);
  assert.equal(canManageCustomerRegularUser({ actor }, peerAdmin), false);
  assert.equal(canManageCustomerRegularUser({ actor }, orgAdmin), false);
  assert.equal(canViewCustomerOrganizationUser({ actor }, user("other", { orgId: "org_2" })), false);
});

test("User Admin basic field allowlist excludes privileged and organization controls", () => {
  const actor = user("user_admin", { orgRole: "user_admin" });
  const target = user("target");
  for (const field of ["firstName", "lastName", "employeeId", "status", "managerUserId"] as const) {
    assert.equal(canEditCustomerUserField({ context: { actor }, target, field }), true, field);
  }
  for (const field of ["orgRole", "performanceAccess", "dashboardAccessEnabled", "usageControls"] as const) {
    assert.equal(canEditCustomerUserField({ context: { actor }, target, field }), false, field);
  }
  assert.equal(canEditCustomerUserField({ context: { actor }, target: user("privileged", { orgRole: "user_admin" }), field: "status" }), false);
  assert.equal(canAdministerOrganizationUsers(actor), true);
  assert.equal(canDecideCustomerAccessRequests(actor), true);
});

test("Org Admin retains guarded status authority while User Admin cannot change privileged users", () => {
  const orgAdmin = user("org_admin", { orgRole: "org_admin" });
  const secondOrgAdmin = user("second_org_admin", { orgRole: "org_admin" });
  const userAdmin = user("user_admin", { orgRole: "user_admin" });
  assert.equal(canChangeCustomerUserStatus({
    context: { actor: orgAdmin }, target: secondOrgAdmin, nextStatus: "disabled",
    orgUsers: [orgAdmin, secondOrgAdmin, userAdmin],
  }), true);
  assert.equal(canChangeCustomerUserStatus({
    context: { actor: orgAdmin }, target: secondOrgAdmin, nextStatus: "disabled",
    orgUsers: [secondOrgAdmin, userAdmin],
  }), false);
  assert.equal(canChangeCustomerUserStatus({
    context: { actor: userAdmin }, target: orgAdmin, nextStatus: "disabled",
    orgUsers: [orgAdmin, secondOrgAdmin, userAdmin],
  }), false);
});
