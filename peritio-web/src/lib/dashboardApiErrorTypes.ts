import type { DashboardApiErrorCode } from "./dashboardApiErrors";

export class DashboardAccessDeniedError extends Error {
  constructor(message = "Access denied.") {
    super(message);
    this.name = "DashboardAccessDeniedError";
  }
}

export class DashboardApiError extends Error {
  status: number;
  code: DashboardApiErrorCode | null;
  details: Record<string, unknown> | null;

  constructor(
    status: number,
    message: string,
    code: DashboardApiErrorCode | null = null,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class DashboardSessionInvalidError extends Error {
  constructor(message = "Dashboard session is no longer valid.") {
    super(message);
    this.name = "DashboardSessionInvalidError";
  }
}
