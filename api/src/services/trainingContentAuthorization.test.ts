import assert from "node:assert/strict";
import test from "node:test";

import { DashboardViewer, UserProfile } from "@voicepractice/shared";

import { buildDashboardAdminCapabilities } from "./dashboardAuthorization.js";
import {
  canManageTrainingContent,
  canOrganizationMemberReadTrainingContent,
  canValidatedSuperUserReadTrainingContent,
} from "./trainingContentAuthorization.js";
import { requireOrganizationModule } from "./organizationModules.js";

const ENABLED = {
  orgId: "org_1",
  moduleKey: "training_content" as const,
  enabled: true,
  updatedByActorId: "platform_admin",
  updatedAt: "2026-07-28T12:00:00.000Z",
};
const DISABLED = { ...ENABLED, enabled: false };

function buildUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user@example.com",
    firstName: overrides.firstName ?? "Test",
    lastName: overrides.lastName ?? "User",
    employeeId: overrides.employeeId ?? null,
    managerUserId: overrides.managerUserId ?? null,
    emailVerifiedAt: overrides.emailVerifiedAt === undefined ? "2026-07-28T00:00:00.000Z" : overrides.emailVerifiedAt,
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    isSuperUser: overrides.isSuperUser ?? false,
    dashboardAccessEnabled: overrides.dashboardAccessEnabled ?? true,
    mobileProfileReonboardingRequired: overrides.mobileProfileReonboardingRequired ?? false,
    accountType: overrides.accountType ?? "enterprise",
    tier: overrides.tier ?? "enterprise",
    status: overrides.status ?? "active",
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    orgRole: overrides.orgRole === undefined ? "user" : overrides.orgRole,
    divisionId: overrides.divisionId ?? null,
    timezone: overrides.timezone ?? "UTC",
    pendingTimezone: overrides.pendingTimezone ?? null,
    pendingTimezoneEffectiveAt: overrides.pendingTimezoneEffectiveAt ?? null,
    planAnchorAt: overrides.planAnchorAt ?? "2026-07-28T00:00:00.000Z",
    manualBonusSeconds: overrides.manualBonusSeconds ?? 0,
    dailySecondsCapOverride: overrides.dailySecondsCapOverride ?? null,
    allowDailyOverageThisCycle: overrides.allowDailyOverageThisCycle ?? false,
    dailyOverageExpiresAt: overrides.dailyOverageExpiresAt ?? null,
    createdAt: overrides.createdAt ?? "2026-07-28T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-28T00:00:00.000Z",
  };
}

function buildViewer(overrides: Partial<DashboardViewer> = {}): DashboardViewer {
  return {
    accessType: overrides.accessType ?? "customer_dashboard_user",
    userId: overrides.userId ?? "viewer_1",
    email: overrides.email ?? "viewer@example.com",
    isSuperUser: overrides.isSuperUser ?? false,
    orgId: overrides.orgId === undefined ? "org_1" : overrides.orgId,
    orgName: overrides.orgName === undefined ? "Org One" : overrides.orgName,
    orgRole: overrides.orgRole === undefined ? "org_admin" : overrides.orgRole,
    capabilities: overrides.capabilities ?? buildDashboardAdminCapabilities("org_admin"),
  };
}

test("Training Content management requires both the enabled module and server-derived content capability", () => {
  assert.equal(canManageTrainingContent({
    orgId: "org_1",
    capabilities: buildDashboardAdminCapabilities("org_admin"),
  }, ENABLED), true);
  assert.equal(canManageTrainingContent({
    orgId: "org_1",
    capabilities: buildDashboardAdminCapabilities("org_admin"),
  }, DISABLED), false);
  assert.equal(canManageTrainingContent({
    orgId: "org_1",
    capabilities: buildDashboardAdminCapabilities("user_admin"),
  }, ENABLED), false);
  assert.equal(canManageTrainingContent({
    orgId: "org_1",
    capabilities: buildDashboardAdminCapabilities("user"),
  }, ENABLED), false);
  assert.equal(canManageTrainingContent({
    orgId: "org_2",
    capabilities: buildDashboardAdminCapabilities("org_admin"),
  }, ENABLED), false);
});

test("Training Content read foundation requires active verified same-org enterprise membership", () => {
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser(), ENABLED), true);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser({ orgRole: "user_admin" }), ENABLED), true);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser(), DISABLED), false);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser({ orgId: "org_2" }), ENABLED), false);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser({ accountType: "individual", orgId: null }), ENABLED), false);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser({ status: "disabled" }), ENABLED), false);
  assert.equal(canOrganizationMemberReadTrainingContent(buildUser({ emailVerifiedAt: null }), ENABLED), false);
});

test("super-user foundation requires an explicit resolved organization context", () => {
  const superViewer = buildViewer({
    accessType: "super_user",
    isSuperUser: true,
    orgId: null,
    orgName: null,
    orgRole: null,
    capabilities: buildDashboardAdminCapabilities(null),
  });
  assert.equal(canValidatedSuperUserReadTrainingContent(superViewer, null, ENABLED), false);
  assert.equal(canValidatedSuperUserReadTrainingContent(superViewer, "org_2", ENABLED), false);
  assert.equal(canValidatedSuperUserReadTrainingContent(superViewer, "org_1", ENABLED), true);
  assert.equal(canValidatedSuperUserReadTrainingContent(buildViewer(), "org_1", ENABLED), false);

  assert.equal(canManageTrainingContent({
    orgId: "org_1",
    capabilities: buildDashboardAdminCapabilities(null, { superUserOrgContext: true }),
  }, ENABLED), true);
});

test("module-disabled denial is structured and fail closed", () => {
  assert.deepEqual(requireOrganizationModule(undefined, "training_content"), {
    allowed: false,
    error: {
      error: "Training Content is not enabled for this organization.",
      code: "module_disabled",
      moduleKey: "training_content",
    },
  });
  assert.deepEqual(requireOrganizationModule(DISABLED, "training_content"), {
    allowed: false,
    error: {
      error: "Training Content is not enabled for this organization.",
      code: "module_disabled",
      moduleKey: "training_content",
    },
  });
  assert.deepEqual(requireOrganizationModule(ENABLED, "training_content"), {
    allowed: true,
    error: null,
  });
});
