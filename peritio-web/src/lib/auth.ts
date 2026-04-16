import "server-only";

import { cookies } from "next/headers";
import type { DashboardApiErrorCode } from "@/src/lib/dashboardApiErrors";
import {
  DashboardAttemptDetailResponse,
  DashboardOverviewResponse,
  DashboardCustomerDetailResponse,
  DashboardCustomerListResponse,
  DashboardCustomerSummary,
  DashboardTrainingPackAssignmentDetailResponse,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingReportResponse,
  DashboardTrainingWorkspaceResponse,
  DashboardUserDetailResponse,
  DashboardUserReportResponse,
  DashboardViewer,
  WebAuthRequestCodeResponse,
  WebAuthSessionResponse,
  WebAuthVerifyCodeResponse,
} from "@voicepractice/shared";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";
import {
  isDashboardScopeDeniedStatus,
  isDashboardSessionInvalidStatus,
} from "@/src/lib/dashboardApiErrors";

export class DashboardAccessDeniedError extends Error {
  constructor(message = "Access denied.") {
    super(message);
    this.name = "DashboardAccessDeniedError";
  }
}

export class DashboardApiError extends Error {
  status: number;
  code: DashboardApiErrorCode | null;

  constructor(status: number, message: string, code: DashboardApiErrorCode | null = null) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

export class DashboardSessionInvalidError extends Error {
  constructor(message = "Dashboard session is no longer valid.") {
    super(message);
    this.name = "DashboardSessionInvalidError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getApiBaseUrl(): string {
  return requireEnv("PERITIO_API_BASE_URL").replace(/\/+$/, "");
}

export function assertDashboardAuthConfig(): void {
  void getApiBaseUrl();
}

async function parseErrorPayload(
  response: Response
): Promise<{ message: string; code: DashboardApiErrorCode | null }> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; code?: string }
    | null;

  const code = payload?.code;
  const normalizedCode =
    code === "dashboard_scope_denied" || code === "dashboard_session_invalid" || code === "web_auth_invalid"
      ? code
      : null;

  return {
    message: payload?.error || `Dashboard API request failed (${response.status}).`,
    code: normalizedCode,
  };
}

function requireDashboardApiToken(token: string | null): string {
  if (!token) {
    throw new DashboardSessionInvalidError();
  }

  return token;
}

function isInvalidDashboardSessionError(error: unknown): boolean {
  return error instanceof DashboardApiError && isDashboardSessionInvalidStatus(error.status, error.code);
}

function isProtectedDashboardAuthFailure(error: unknown): boolean {
  return error instanceof DashboardApiError && (error.status === 401 || error.status === 403);
}

function appendDivisionQuery(pathname: string, divisionId?: string | null): string {
  if (!divisionId || !divisionId.trim()) {
    return pathname;
  }

  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}divisionId=${encodeURIComponent(divisionId.trim())}`;
}

async function fetchDashboardApi<T>(
  pathname: string,
  init?: RequestInit & { token?: string | null }
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (init?.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    throw new DashboardApiError(response.status, payload.message, payload.code);
  }

  return (await response.json()) as T;
}

export async function requestWebAuthCode(email: string): Promise<WebAuthRequestCodeResponse> {
  return fetchDashboardApi<WebAuthRequestCodeResponse>("/web/auth/request-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyWebAuthCode(email: string, code: string): Promise<WebAuthVerifyCodeResponse> {
  return fetchDashboardApi<WebAuthVerifyCodeResponse>("/web/auth/verify-code", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function revokeWebAuthSession(token: string): Promise<void> {
  try {
    await fetchDashboardApi<{ ok: true }>("/web/auth/logout", {
      method: "POST",
      token,
    });
  } catch (error) {
    if (error instanceof DashboardApiError && (error.status === 401 || error.status === 403)) {
      return;
    }

    throw error;
  }
}

export async function getWebAuthBearerToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(WEB_AUTH_SESSION_COOKIE_NAME)?.value ?? null;
}

export function getWebAuthSessionCookieOptions(expiresAt: string) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
    priority: "high" as const,
  };
}

export function getExpiredWebAuthSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    priority: "high" as const,
  };
}

export async function getWebAuthSession(): Promise<WebAuthSessionResponse | null> {
  const token = await getWebAuthBearerToken();
  if (!token) {
    return null;
  }

  try {
    return await fetchDashboardApi<WebAuthSessionResponse>("/web/auth/session", { token });
  } catch (error) {
    if (error instanceof DashboardApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }

    throw error;
  }
}

export async function getDashboardViewer(): Promise<DashboardViewer | null> {
  const session = await getWebAuthSession();
  return session?.dashboardViewer ?? null;
}

export async function listAccessibleCustomers(): Promise<DashboardCustomerSummary[]> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    const payload = await fetchDashboardApi<DashboardCustomerListResponse>("/dashboard/customers", { token });
    return payload.customers;
  } catch (error) {
    if (isInvalidDashboardSessionError(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    if (error instanceof DashboardApiError && isDashboardScopeDeniedStatus(error.status, error.code)) {
      throw new DashboardAccessDeniedError(error.message);
    }

    throw error;
  }
}

export async function getAccessibleCustomerDetail(
  customerId: string,
  divisionId?: string | null
): Promise<DashboardCustomerDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardCustomerDetailResponse>(
      appendDivisionQuery(`/dashboard/customers/${customerId}`, divisionId),
      {
      token,
      }
    );
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.status === 404) {
        return null;
      }

      if (isInvalidDashboardSessionError(error)) {
        throw new DashboardSessionInvalidError(error.message);
      }

      if (error.status === 403) {
        throw new DashboardAccessDeniedError(error.message);
      }
    }

    throw error;
  }
}

export async function getDashboardOverview(divisionId?: string | null): Promise<DashboardOverviewResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardOverviewResponse>(appendDivisionQuery("/dashboard/overview", divisionId), { token });
  } catch (error) {
    if (isProtectedDashboardAuthFailure(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    throw error;
  }
}

export async function getDashboardTrainingReport(): Promise<DashboardTrainingReportResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingReportResponse>("/dashboard/training", { token });
  } catch (error) {
    if (isProtectedDashboardAuthFailure(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    throw error;
  }
}

export async function getDashboardTrainingWorkspace(
  divisionId?: string | null
): Promise<DashboardTrainingWorkspaceResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingWorkspaceResponse>(
      appendDivisionQuery("/dashboard/reporting/trainings", divisionId),
      { token }
    );
  } catch (error) {
    if (isProtectedDashboardAuthFailure(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    throw error;
  }
}

export async function getDashboardTrainingPackDetail(trainingPackId: string): Promise<DashboardTrainingPackDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackDetailResponse>(
      `/dashboard/training/${encodeURIComponent(trainingPackId)}`,
      { token }
    );
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.status === 404) {
        return null;
      }

      if (isInvalidDashboardSessionError(error)) {
        throw new DashboardSessionInvalidError(error.message);
      }

      if (error.status === 403) {
        throw new DashboardAccessDeniedError(error.message);
      }
    }

    throw error;
  }
}

export async function getDashboardTrainingPackAssignmentDetail(
  trainingPackId: string,
  assignmentId: string
): Promise<DashboardTrainingPackAssignmentDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackAssignmentDetailResponse>(
      `/dashboard/training/${encodeURIComponent(trainingPackId)}/assignments/${encodeURIComponent(assignmentId)}`,
      { token }
    );
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.status === 404) {
        return null;
      }

      if (isInvalidDashboardSessionError(error)) {
        throw new DashboardSessionInvalidError(error.message);
      }

      if (error.status === 403) {
        throw new DashboardAccessDeniedError(error.message);
      }
    }

    throw error;
  }
}

export async function getDashboardUserReport(divisionId?: string | null): Promise<DashboardUserReportResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardUserReportResponse>(appendDivisionQuery("/dashboard/users", divisionId), { token });
  } catch (error) {
    if (isProtectedDashboardAuthFailure(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    throw error;
  }
}

export async function getDashboardUserDetail(userId: string): Promise<DashboardUserDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardUserDetailResponse>(`/dashboard/users/${encodeURIComponent(userId)}`, { token });
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.status === 404) {
        return null;
      }

      if (isInvalidDashboardSessionError(error)) {
        throw new DashboardSessionInvalidError(error.message);
      }

      if (error.status === 403) {
        throw new DashboardAccessDeniedError(error.message);
      }
    }

    throw error;
  }
}

export async function getDashboardAttemptDetail(attemptId: string): Promise<DashboardAttemptDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardAttemptDetailResponse>(`/dashboard/attempts/${encodeURIComponent(attemptId)}`, { token });
  } catch (error) {
    if (error instanceof DashboardApiError) {
      if (error.status === 404) {
        return null;
      }

      if (isInvalidDashboardSessionError(error)) {
        throw new DashboardSessionInvalidError(error.message);
      }

      if (error.status === 403) {
        throw new DashboardAccessDeniedError(error.message);
      }
    }

    throw error;
  }
}
