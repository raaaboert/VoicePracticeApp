export type DashboardApiErrorCode = "dashboard_scope_denied" | "dashboard_session_invalid" | "web_auth_invalid";

export function isDashboardSessionInvalidStatus(status: number, code?: string | null): boolean {
  return status === 401 || code === "dashboard_session_invalid";
}

export function isDashboardScopeDeniedStatus(status: number, code?: string | null): boolean {
  return status === 403 && code === "dashboard_scope_denied";
}
