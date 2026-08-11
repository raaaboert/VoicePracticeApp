import type { UserEntitlementsResponse, UserProfile } from "@voicepractice/shared";

export const ORGANIZATION_PLAN_SCREEN = "organization_plan" as const;

type OrganizationPlanUser = Pick<
  UserProfile,
  "accountType" | "orgRole" | "isPlatformAdmin" | "isSuperUser"
>;

export function canAccessOrganizationPlan(user: OrganizationPlanUser | null | undefined): boolean {
  if (!user) {
    return false;
  }

  if (user.isSuperUser === true || user.isPlatformAdmin === true) {
    return true;
  }

  return user.accountType === "enterprise" && user.orgRole === "org_admin";
}

export function resolveOrganizationPlanScreen(
  requestedScreen: string,
  user: OrganizationPlanUser | null | undefined
): string {
  if (requestedScreen !== ORGANIZATION_PLAN_SCREEN) {
    return requestedScreen;
  }

  return canAccessOrganizationPlan(user) ? ORGANIZATION_PLAN_SCREEN : "home";
}

export function canSubmitOrganizationPlanSupport(message: string, isSubmitting: boolean): boolean {
  return !isSubmitting && message.trim().length > 0;
}

export function formatOrganizationPlanDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const totalMinutes = Math.floor(safeSeconds / 60);
  if (safeSeconds > 0 && totalMinutes === 0) {
    return "<1 minute";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  return parts.join(" ");
}

function formatCycleResetDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface OrganizationPlanDetails {
  planName: "Enterprise";
  status: string | null;
  usageThisCycle: string | null;
  organizationAllocation: string | null;
  remainingThisCycle: string | null;
  cycleResets: string | null;
}

export function buildOrganizationPlanDetails(
  entitlements: UserEntitlementsResponse | null | undefined
): OrganizationPlanDetails {
  const usage = entitlements?.usage;
  const hasOrganizationCycle =
    typeof usage?.orgUsedSecondsThisPeriod === "number"
    && typeof usage.orgAllottedSecondsThisPeriod === "number"
    && typeof usage.orgRemainingSecondsThisPeriod === "number";

  return {
    planName: "Enterprise",
    status: entitlements?.status
      ? entitlements.status.charAt(0).toUpperCase() + entitlements.status.slice(1)
      : null,
    usageThisCycle: typeof usage?.orgUsedSecondsThisPeriod === "number"
      ? formatOrganizationPlanDuration(usage.orgUsedSecondsThisPeriod)
      : null,
    organizationAllocation: typeof usage?.orgAllottedSecondsThisPeriod === "number"
      ? formatOrganizationPlanDuration(usage.orgAllottedSecondsThisPeriod)
      : null,
    remainingThisCycle: typeof usage?.orgRemainingSecondsThisPeriod === "number"
      ? formatOrganizationPlanDuration(usage.orgRemainingSecondsThisPeriod)
      : null,
    cycleResets: hasOrganizationCycle ? formatCycleResetDate(usage.nextRenewalAt) : null,
  };
}
