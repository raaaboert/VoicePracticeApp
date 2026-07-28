import {
  DashboardAdminCapabilities,
  DashboardViewer,
  UserProfile,
} from "@voicepractice/shared";

import { StoredOrgModuleEntitlement } from "../storage/orgModuleEntitlementStore.js";
import { isOrganizationModuleEnabled } from "./organizationModules.js";

export interface ValidatedTrainingContentManagementContext {
  orgId: string;
  capabilities: DashboardAdminCapabilities;
}

export function canManageTrainingContent(
  context: ValidatedTrainingContentManagementContext | null | undefined,
  entitlement: StoredOrgModuleEntitlement | null | undefined
): boolean {
  if (!context || !entitlement) {
    return false;
  }

  return context.orgId === entitlement.orgId
    && context.capabilities.manageOrganizationContent === true
    && isOrganizationModuleEnabled(entitlement, "training_content");
}

export function canOrganizationMemberReadTrainingContent(
  user: UserProfile | null | undefined,
  entitlement: StoredOrgModuleEntitlement | null | undefined
): boolean {
  if (!user || !entitlement) {
    return false;
  }

  return user.status === "active"
    && Boolean(user.emailVerifiedAt)
    && user.accountType === "enterprise"
    && user.orgId === entitlement.orgId
    && isOrganizationModuleEnabled(entitlement, "training_content");
}

export function canValidatedSuperUserReadTrainingContent(
  viewer: DashboardViewer | null | undefined,
  resolvedOrgId: string | null | undefined,
  entitlement: StoredOrgModuleEntitlement | null | undefined
): boolean {
  if (!viewer || !resolvedOrgId || !entitlement) {
    return false;
  }

  return viewer.accessType === "super_user"
    && viewer.isSuperUser === true
    && resolvedOrgId === entitlement.orgId
    && isOrganizationModuleEnabled(entitlement, "training_content");
}
