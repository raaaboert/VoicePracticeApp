import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationProductSettings } from "@voicepractice/shared";
import {
  canCustomerCreateScenario,
  canManageFocusTopicsWithFutureGrant,
  requiresOrgAdminScenarioApproval,
  resolveFutureCustomerScenarioSwitchSemantics,
} from "./organizationProductPolicy.js";

const settings: OrganizationProductSettings = {
  allowCustomerScenarioCreation: false,
  requireOrgAdminScenarioApproval: true,
  allowUserAdminFocusTopicManagement: true,
  allowManagerFocusTopicManagement: true,
  updatedAt: null,
};

test("future customer scenario semantics remain explicit without creating lifecycle state", () => {
  assert.equal(canCustomerCreateScenario(settings), false);
  assert.equal(requiresOrgAdminScenarioApproval(settings), true);
  assert.deepEqual(resolveFutureCustomerScenarioSwitchSemantics(settings), {
    switchAllowsCreationOrGeneration: false,
    switchAllowsNewPublication: false,
    existingPublishedScenariosRemainLive: true,
    existingUnpublishedItemsRemainVisible: true,
    safeArchiveOrDeleteAllowed: true,
    masterRecoveryAllowed: true,
  });
});

test("future Focus Topic management requires switch and explicit grant except for Org Admin", () => {
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "org_admin", isCurrentManager: false, hasExplicitManagementTargetGrant: false, settings,
  }), true);
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "user_admin", isCurrentManager: false, hasExplicitManagementTargetGrant: false, settings,
  }), false);
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "user_admin", isCurrentManager: false, hasExplicitManagementTargetGrant: true, settings,
  }), true);
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "user", isCurrentManager: false, hasExplicitManagementTargetGrant: true, settings,
  }), false);
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "user", isCurrentManager: true, hasExplicitManagementTargetGrant: true, settings,
  }), true);
  assert.equal(canManageFocusTopicsWithFutureGrant({
    role: "user_admin", isCurrentManager: true, hasExplicitManagementTargetGrant: true,
    settings: { ...settings, allowUserAdminFocusTopicManagement: false },
  }), true);
});
