import {
  ORGANIZATION_MODULE_DISABLED_CODE,
  ORG_MODULE_KEYS,
  OrganizationModuleDisabledErrorResponse,
  OrgModuleEntitlementsResponse,
  OrgModuleKey,
} from "@voicepractice/shared";

import {
  OrgModuleEntitlementStore,
  StoredOrgModuleEntitlement,
} from "../storage/orgModuleEntitlementStore.js";

export interface OrganizationModuleAccessDecision {
  allowed: boolean;
  error: OrganizationModuleDisabledErrorResponse | null;
}

export async function buildOrgModuleEntitlementsResponse(
  store: OrgModuleEntitlementStore,
  orgId: string
): Promise<OrgModuleEntitlementsResponse> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) {
    throw new Error("Organization id is required.");
  }

  const entries = await Promise.all(
    ORG_MODULE_KEYS.map(async (moduleKey) => {
      const entitlement = await store.getOrgModuleEntitlement(normalizedOrgId, moduleKey);
      return [moduleKey, toEntitlementState(entitlement)] as const;
    })
  );

  return {
    orgId: normalizedOrgId,
    modules: Object.fromEntries(entries) as OrgModuleEntitlementsResponse["modules"],
  };
}

export function isOrganizationModuleEnabled(
  entitlement: StoredOrgModuleEntitlement | null | undefined,
  moduleKey: OrgModuleKey
): boolean {
  return entitlement?.moduleKey === moduleKey && entitlement.enabled === true;
}

export function requireOrganizationModule(
  entitlement: StoredOrgModuleEntitlement | null | undefined,
  moduleKey: OrgModuleKey
): OrganizationModuleAccessDecision {
  if (isOrganizationModuleEnabled(entitlement, moduleKey)) {
    return { allowed: true, error: null };
  }

  return {
    allowed: false,
    error: {
      error: "Training Content is not enabled for this organization.",
      code: ORGANIZATION_MODULE_DISABLED_CODE,
      moduleKey,
    },
  };
}

function toEntitlementState(entitlement: StoredOrgModuleEntitlement) {
  return {
    moduleKey: entitlement.moduleKey,
    enabled: entitlement.enabled,
    updatedByActorId: entitlement.updatedByActorId,
    updatedAt: entitlement.updatedAt,
  };
}
