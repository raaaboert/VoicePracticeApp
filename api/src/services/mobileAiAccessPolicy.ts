export const ORG_ACCESS_REQUIRED_CODE = "ORG_ACCESS_REQUIRED";
export const ORG_ACCESS_REQUIRED_MESSAGE =
  "Organization access is required to use Peritio AI.";

export interface MobilePaidAiOrganizationAccessInput {
  accountType: "individual" | "enterprise";
  userOrgId: string | null;
  isSuperUser: boolean;
  actingOrg: {
    id: string;
    status: "active" | "disabled";
  } | null | undefined;
}

export interface MobilePaidAiOrganizationAccessDecision {
  allowed: boolean;
  code: typeof ORG_ACCESS_REQUIRED_CODE | null;
  reason: string | null;
}

export function resolveMobilePaidAiOrganizationAccess(
  input: MobilePaidAiOrganizationAccessInput,
): MobilePaidAiOrganizationAccessDecision {
  if (input.isSuperUser) {
    // Intentional internal exception: explicit superuser scope preserves access even when the selected org is inactive.
    return input.actingOrg
      ? { allowed: true, code: null, reason: null }
      : {
          allowed: false,
          code: ORG_ACCESS_REQUIRED_CODE,
          reason: "Select an enterprise account environment.",
        };
  }

  const hasActiveEnterpriseMembership =
    input.accountType === "enterprise"
    && Boolean(input.userOrgId)
    && input.actingOrg?.id === input.userOrgId
    && input.actingOrg.status === "active";

  return hasActiveEnterpriseMembership
    ? { allowed: true, code: null, reason: null }
    : {
        allowed: false,
        code: ORG_ACCESS_REQUIRED_CODE,
        reason: ORG_ACCESS_REQUIRED_MESSAGE,
      };
}
