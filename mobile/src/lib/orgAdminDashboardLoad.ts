import { MobileApiError } from "./apiError";

export interface OrgAdminDashboardLoadResult<Dashboard, Analytics> {
  dashboard: Dashboard;
  analytics: Analytics | null;
  analyticsError: unknown | null;
}

export async function loadOrgAdminDashboardData<Dashboard, Analytics>(
  loadDashboard: () => Promise<Dashboard>,
  loadAnalytics: () => Promise<Analytics>,
): Promise<OrgAdminDashboardLoadResult<Dashboard, Analytics>> {
  const [dashboardResult, analyticsResult] = await Promise.allSettled([
    loadDashboard(),
    loadAnalytics(),
  ]);

  if (dashboardResult.status === "rejected") {
    throw dashboardResult.reason;
  }

  if (analyticsResult.status === "fulfilled") {
    return {
      dashboard: dashboardResult.value,
      analytics: analyticsResult.value,
      analyticsError: null,
    };
  }

  if (analyticsResult.reason instanceof MobileApiError && analyticsResult.reason.status === 403) {
    return {
      dashboard: dashboardResult.value,
      analytics: null,
      analyticsError: null,
    };
  }

  return {
    dashboard: dashboardResult.value,
    analytics: null,
    analyticsError: analyticsResult.reason,
  };
}
