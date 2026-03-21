import { ApiDatabase, DashboardViewer, UserProfile } from "@voicepractice/shared";

// Durable dashboard authorization projection. Keep this even after authn is replaced.
export function canDashboardViewerAccessOrg(viewer: DashboardViewer, orgId: string): boolean {
  if (viewer.accessType === "platform_admin" || viewer.accessType === "super_user") {
    return true;
  }

  return viewer.orgId === orgId;
}

export function resolveDashboardViewer(db: ApiDatabase, user: UserProfile): DashboardViewer | null {
  if (user.status !== "active" || !user.emailVerifiedAt) {
    return null;
  }

  if (user.isPlatformAdmin === true) {
    return {
      accessType: "platform_admin",
      userId: user.id,
      email: user.email,
      isPlatformAdmin: true,
      isSuperUser: false,
      orgId: null,
      orgName: null
    };
  }

  if (user.isSuperUser === true) {
    return {
      accessType: "super_user",
      userId: user.id,
      email: user.email,
      isPlatformAdmin: false,
      isSuperUser: true,
      orgId: null,
      orgName: null
    };
  }

  if (user.accountType !== "enterprise" || !user.orgId || user.dashboardAccessEnabled !== true) {
    return null;
  }

  const org = db.orgs.find((entry) => entry.id === user.orgId);
  if (!org || org.status !== "active") {
    return null;
  }

  return {
    accessType: "customer_dashboard_user",
    userId: user.id,
    email: user.email,
    isPlatformAdmin: false,
    isSuperUser: false,
    orgId: org.id,
    orgName: org.name
  };
}
