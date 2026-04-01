import { ApiDatabase, DashboardViewer, EnterpriseOrg, UserProfile } from "@voicepractice/shared";

export type DashboardAccessEligibilityReason =
  | "inactive_user"
  | "super_user"
  | "not_enterprise_user"
  | "dashboard_access_disabled"
  | "missing_org"
  | "inactive_org"
  | "customer_dashboard_user";

export interface DashboardAccessEligibility {
  eligible: boolean;
  reason: DashboardAccessEligibilityReason;
  org: EnterpriseOrg | null;
}

// Durable dashboard authorization projection. Keep this even after authn is replaced.
export function canDashboardViewerAccessOrg(viewer: DashboardViewer, orgId: string): boolean {
  if (viewer.accessType === "super_user") {
    return true;
  }

  return viewer.orgId === orgId;
}

export function canDashboardViewerAccessCustomerDirectory(viewer: DashboardViewer): boolean {
  return viewer.accessType === "super_user";
}

export function resolveDashboardAccessEligibility(db: ApiDatabase, user: UserProfile): DashboardAccessEligibility {
  if (user.status !== "active") {
    return {
      eligible: false,
      reason: "inactive_user",
      org: null,
    };
  }

  if (user.isSuperUser === true) {
    return {
      eligible: true,
      reason: "super_user",
      org: null,
    };
  }

  if (user.accountType !== "enterprise" || !user.orgId) {
    return {
      eligible: false,
      reason: "not_enterprise_user",
      org: null,
    };
  }

  if (user.dashboardAccessEnabled !== true) {
    return {
      eligible: false,
      reason: "dashboard_access_disabled",
      org: null,
    };
  }

  const org = db.orgs.find((entry) => entry.id === user.orgId);
  if (!org) {
    return {
      eligible: false,
      reason: "missing_org",
      org: null,
    };
  }
  if (org.status !== "active") {
    return {
      eligible: false,
      reason: "inactive_org",
      org,
    };
  }

  return {
    eligible: true,
    reason: "customer_dashboard_user",
    org,
  };
}

export function resolveDashboardViewer(db: ApiDatabase, user: UserProfile): DashboardViewer | null {
  if (!user.emailVerifiedAt) {
    return null;
  }

  const eligibility = resolveDashboardAccessEligibility(db, user);
  if (!eligibility.eligible) {
    return null;
  }

  return {
    accessType: user.isSuperUser === true ? "super_user" : "customer_dashboard_user",
    userId: user.id,
    email: user.email,
    isSuperUser: user.isSuperUser === true,
    orgId: eligibility.org?.id ?? null,
    orgName: eligibility.org?.name ?? null,
  };
}
