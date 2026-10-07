import type { OrganizationProductSettings, OrgUserRole } from "@voicepractice/shared";

export function canCustomerCreateScenario(settings: OrganizationProductSettings): boolean {
  return settings.allowCustomerScenarioCreation;
}

export function requiresOrgAdminScenarioApproval(settings: OrganizationProductSettings): boolean {
  return settings.requireOrgAdminScenarioApproval;
}

export function resolveFutureCustomerScenarioSwitchSemantics(settings: OrganizationProductSettings): {
  switchAllowsCreationOrGeneration: boolean;
  switchAllowsNewPublication: boolean;
  existingPublishedScenariosRemainLive: true;
  existingUnpublishedItemsRemainVisible: true;
  safeArchiveOrDeleteAllowed: true;
  masterRecoveryAllowed: true;
} {
  return {
    switchAllowsCreationOrGeneration: settings.allowCustomerScenarioCreation,
    switchAllowsNewPublication: settings.allowCustomerScenarioCreation,
    existingPublishedScenariosRemainLive: true,
    existingUnpublishedItemsRemainVisible: true,
    safeArchiveOrDeleteAllowed: true,
    masterRecoveryAllowed: true,
  };
}

export function canManageFocusTopicsWithFutureGrant(params: {
  role: OrgUserRole;
  isCurrentManager: boolean;
  hasExplicitManagementTargetGrant: boolean;
  settings: OrganizationProductSettings;
}): boolean {
  if (params.role === "org_admin") {
    return true;
  }
  if (!params.hasExplicitManagementTargetGrant) {
    return false;
  }
  return (params.role === "user_admin" && params.settings.allowUserAdminFocusTopicManagement)
    || (params.isCurrentManager && params.settings.allowManagerFocusTopicManagement);
}
