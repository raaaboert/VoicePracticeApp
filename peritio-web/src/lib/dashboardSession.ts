export type DashboardLoginReason = "no-dashboard-access" | "session-expired";

export const DEFAULT_DASHBOARD_LOGIN_REASON: DashboardLoginReason = "session-expired";

export function parseDashboardLoginReason(value: string | null | undefined): DashboardLoginReason | null {
  return value === "no-dashboard-access" || value === "session-expired" ? value : null;
}

export function buildDashboardLoginPath(reason: DashboardLoginReason = DEFAULT_DASHBOARD_LOGIN_REASON): string {
  return `/login?reason=${encodeURIComponent(reason)}`;
}

export function buildDashboardSessionResetPath(
  reason: DashboardLoginReason = DEFAULT_DASHBOARD_LOGIN_REASON
): string {
  return `/api/auth/logout?reason=${encodeURIComponent(reason)}`;
}
