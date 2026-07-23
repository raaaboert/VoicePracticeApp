import "server-only";

import { cookies } from "next/headers";
import type { DashboardApiErrorCode } from "@/src/lib/dashboardApiErrors";
import {
  DashboardAttemptDetailResponse,
  DashboardOverviewResponse,
  DashboardCustomerDetailResponse,
  DashboardCustomerListResponse,
  DashboardCustomerSummary,
  DashboardPerformancePlanDetailResponse,
  DashboardPerformanceWorkspaceResponse,
  DashboardTrainingPackAssignmentDetailResponse,
  DashboardTrainingPackDetailResponse,
  DashboardTrainingReportResponse,
  DashboardTrainingWorkspaceResponse,
  DashboardUserDetailResponse,
  DashboardUserReportResponse,
  DashboardViewer,
  CancelPerformancePlanRequest,
  CancelPerformancePlanResponse,
  CreatePerformancePlanRequest,
  CreatePerformancePlanResponse,
  PerformancePlanPreviewRequest,
  PerformancePlanPreviewResponse,
  UpdatePerformancePlanRequest,
  UpdatePerformancePlanResponse,
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

function appendPerformanceDashboardQuery(
  pathname: string,
  options?: { divisionId?: string | null; orgId?: string | null }
): string {
  const params = new URLSearchParams();
  if (options?.divisionId?.trim()) {
    params.set("divisionId", options.divisionId.trim());
  }
  if (options?.orgId?.trim()) {
    params.set("orgId", options.orgId.trim());
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function getDashboardPerformanceWorkspace(options?: {
  divisionId?: string | null;
  orgId?: string | null;
}): Promise<DashboardPerformanceWorkspaceResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardPerformanceWorkspaceResponse>(
      appendPerformanceDashboardQuery("/dashboard/performance", options),
      { token }
    );
  } catch (error) {
    if (isProtectedDashboardAuthFailure(error)) {
      throw new DashboardSessionInvalidError(error instanceof DashboardApiError ? error.message : undefined);
    }

    throw error;
  }
}

export async function previewDashboardPerformancePlan(
  input: PerformancePlanPreviewRequest,
  divisionId?: string | null
): Promise<PerformancePlanPreviewResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<PerformancePlanPreviewResponse>(
    appendDivisionQuery("/dashboard/performance/preview", divisionId),
    {
      method: "POST",
      body: JSON.stringify(input),
      token,
    }
  );
}

export async function createDashboardPerformancePlan(
  input: CreatePerformancePlanRequest,
  divisionId?: string | null
): Promise<CreatePerformancePlanResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<CreatePerformancePlanResponse>(
    appendDivisionQuery("/dashboard/performance/plans", divisionId),
    {
      method: "POST",
      body: JSON.stringify(input),
      token,
    }
  );
}

export async function getDashboardPerformancePlanDetail(
  planId: string,
  divisionId?: string | null
): Promise<DashboardPerformancePlanDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardPerformancePlanDetailResponse>(
      appendDivisionQuery(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, divisionId),
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

export async function updateDashboardPerformancePlan(
  planId: string,
  input: UpdatePerformancePlanRequest,
  divisionId?: string | null
): Promise<UpdatePerformancePlanResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<UpdatePerformancePlanResponse>(
    appendDivisionQuery(`/dashboard/performance/plans/${encodeURIComponent(planId)}`, divisionId),
    {
      method: "PATCH",
      body: JSON.stringify(input),
      token,
    }
  );
}

export async function cancelDashboardPerformancePlan(
  planId: string,
  input: CancelPerformancePlanRequest,
  divisionId?: string | null
): Promise<CancelPerformancePlanResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<CancelPerformancePlanResponse>(
    appendDivisionQuery(`/dashboard/performance/plans/${encodeURIComponent(planId)}/cancel`, divisionId),
    {
      method: "POST",
      body: JSON.stringify(input),
      token,
    }
  );
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

export async function getDashboardTrainingPackDetail(
  trainingPackId: string,
  divisionId?: string | null
): Promise<DashboardTrainingPackDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackDetailResponse>(
      appendDivisionQuery(`/dashboard/training/${encodeURIComponent(trainingPackId)}`, divisionId),
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
  assignmentId: string,
  divisionId?: string | null
): Promise<DashboardTrainingPackAssignmentDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackAssignmentDetailResponse>(
      appendDivisionQuery(
        `/dashboard/training/${encodeURIComponent(trainingPackId)}/assignments/${encodeURIComponent(assignmentId)}`,
        divisionId
      ),
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

export async function getDashboardUserDetail(
  userId: string,
  divisionId?: string | null
): Promise<DashboardUserDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardUserDetailResponse>(
      appendDivisionQuery(`/dashboard/users/${encodeURIComponent(userId)}`, divisionId),
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

export async function getDashboardAttemptDetail(
  attemptId: string,
  divisionId?: string | null
): Promise<DashboardAttemptDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardAttemptDetailResponse>(
      appendDivisionQuery(`/dashboard/attempts/${encodeURIComponent(attemptId)}`, divisionId),
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
