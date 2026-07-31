export type DashboardApiErrorCode =
  | "dashboard_scope_denied"
  | "dashboard_session_invalid"
  | "web_auth_invalid"
  | "employee_id_conflict"
  | "employee_id_invalid"
  | "module_disabled"
  | "training_content_archived"
  | "training_content_conflict"
  | "training_content_invalid"
  | "training_content_not_found"
  | "training_content_publish_invalid"
  | "training_content_storage_unavailable"
  | "training_content_upload_expired"
  | "training_content_upload_not_found"
  | "training_content_upload_signature_mismatch"
  | "training_content_server_owned_field"
  | `training_content_${string}`;

export function isDashboardSessionInvalidStatus(status: number, code?: string | null): boolean {
  return status === 401 || code === "dashboard_session_invalid";
}

export function isDashboardScopeDeniedStatus(status: number, code?: string | null): boolean {
  return status === 403 && code === "dashboard_scope_denied";
}
