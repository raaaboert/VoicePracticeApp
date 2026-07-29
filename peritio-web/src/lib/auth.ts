import "server-only";

import { cookies } from "next/headers";
import type { DashboardApiErrorCode } from "@/src/lib/dashboardApiErrors";
import {
  DashboardAccessDeniedError,
  DashboardApiError,
  DashboardSessionInvalidError,
} from "@/src/lib/dashboardApiErrorTypes";
import {
  DashboardAttemptDetailResponse,
  DashboardAdminAccessRequestsResponse,
  DashboardAdminDecideAccessRequest,
  DashboardAdminDecideAccessRequestResponse,
  DashboardAdminUpdateUserRequest,
  DashboardAdminUpdateUserResponse,
  DashboardAdminUsersExportResponse,
  DashboardAdminUsersResponse,
  ArchiveDashboardTrainingContentCategoryRequest,
  CreateDashboardTrainingContentCategoryRequest,
  CreateDashboardTrainingContentRequest,
  DashboardTrainingContentAssetAccessResponse,
  DashboardTrainingContentAssetFinalizationResponse,
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentCategoriesResponse,
  DashboardTrainingContentCategoryMutationResponse,
  DashboardTrainingContentFocusTopicsResponse,
  DashboardTrainingContentLifecycleRequest,
  DashboardTrainingContentListResponse,
  DashboardTrainingContentOrderResponse,
  DashboardTrainingContentTargetsResponse,
  DashboardTrainingContentUploadInitiationRequest,
  DashboardTrainingContentUploadInitiationResponse,
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
  CreatePerformancePlanUpdateRequest,
  CreatePerformancePlanUpdateResponse,
  CreatePerformancePlanResponse,
  PerformancePlanUpdatesResponse,
  PerformancePlanPreviewRequest,
  PerformancePlanPreviewResponse,
  ReorderDashboardTrainingContentCategoriesRequest,
  ReorderDashboardTrainingContentRequest,
  UpdatePerformancePlanRequest,
  UpdatePerformancePlanResponse,
  UpdateDashboardTrainingContentAssignmentsRequest,
  UpdateDashboardTrainingContentCategoryRequest,
  UpdateDashboardTrainingContentRequest,
  WebAuthRequestCodeResponse,
  WebAuthSessionResponse,
  WebAuthVerifyCodeResponse,
} from "@voicepractice/shared";
import { WEB_AUTH_SESSION_COOKIE_NAME } from "@/src/lib/authConstants";
import {
  isDashboardScopeDeniedStatus,
  isDashboardSessionInvalidStatus,
} from "@/src/lib/dashboardApiErrors";

export { DashboardAccessDeniedError, DashboardApiError, DashboardSessionInvalidError };

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
): Promise<{
  message: string;
  code: DashboardApiErrorCode | null;
  details: Record<string, unknown> | null;
}> {
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  const code = typeof payload?.code === "string" ? payload.code : null;
  const normalizedCode =
    code === "dashboard_scope_denied" ||
    code === "dashboard_session_invalid" ||
    code === "web_auth_invalid" ||
    code === "employee_id_conflict" ||
    code === "employee_id_invalid" ||
    code === "module_disabled" ||
    code?.startsWith("training_content_")
      ? code as DashboardApiErrorCode
      : null;
  const details = payload ? { ...payload } : null;
  if (details) {
    delete details.error;
    delete details.code;
  }

  return {
    message: typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : `Dashboard API request failed (${response.status}).`,
    code: normalizedCode,
    details: details && Object.keys(details).length > 0 ? details : null,
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

function appendOrgQuery(pathname: string, orgId?: string | null): string {
  if (!orgId || !orgId.trim()) {
    return pathname;
  }

  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}orgId=${encodeURIComponent(orgId.trim())}`;
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
    throw new DashboardApiError(response.status, payload.message, payload.code, payload.details);
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

export async function getDashboardPerformancePlanUpdates(
  planId: string,
  divisionId?: string | null
): Promise<PerformancePlanUpdatesResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<PerformancePlanUpdatesResponse>(
    appendDivisionQuery(`/dashboard/performance/plans/${encodeURIComponent(planId)}/updates`, divisionId),
    { token }
  );
}

export async function createDashboardPerformancePlanUpdate(
  planId: string,
  input: CreatePerformancePlanUpdateRequest,
  divisionId?: string | null
): Promise<CreatePerformancePlanUpdateResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<CreatePerformancePlanUpdateResponse>(
    appendDivisionQuery(`/dashboard/performance/plans/${encodeURIComponent(planId)}/updates`, divisionId),
    {
      method: "POST",
      body: JSON.stringify(input),
      token,
    }
  );
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
  divisionId?: string | null,
  orgId?: string | null
): Promise<DashboardTrainingPackDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackDetailResponse>(
      appendOrgQuery(appendDivisionQuery(`/dashboard/training/${encodeURIComponent(trainingPackId)}`, divisionId), orgId),
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
  divisionId?: string | null,
  orgId?: string | null
): Promise<DashboardTrainingPackAssignmentDetailResponse | null> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());

  try {
    return await fetchDashboardApi<DashboardTrainingPackAssignmentDetailResponse>(
      appendOrgQuery(
        appendDivisionQuery(
          `/dashboard/training/${encodeURIComponent(trainingPackId)}/assignments/${encodeURIComponent(assignmentId)}`,
          divisionId
        ),
        orgId
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

export async function getDashboardAdminUsers(orgId?: string | null): Promise<DashboardAdminUsersResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<DashboardAdminUsersResponse>(appendOrgQuery("/dashboard/admin/users", orgId), { token });
}

export async function getDashboardAdminUsersExport(orgId?: string | null): Promise<DashboardAdminUsersExportResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<DashboardAdminUsersExportResponse>(
    appendOrgQuery("/dashboard/admin/users/export", orgId),
    { token }
  );
}

export async function updateDashboardAdminUser(
  userId: string,
  input: DashboardAdminUpdateUserRequest,
  orgId?: string | null
): Promise<DashboardAdminUpdateUserResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<DashboardAdminUpdateUserResponse>(
    appendOrgQuery(`/dashboard/admin/users/${encodeURIComponent(userId)}`, orgId),
    {
      method: "PATCH",
      body: JSON.stringify(input),
      token,
    }
  );
}

export async function getDashboardAdminAccessRequests(
  orgId?: string | null
): Promise<DashboardAdminAccessRequestsResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<DashboardAdminAccessRequestsResponse>(
    appendOrgQuery("/dashboard/admin/access-requests", orgId),
    { token }
  );
}

export async function decideDashboardAdminAccessRequest(
  requestId: string,
  input: DashboardAdminDecideAccessRequest,
  orgId?: string | null
): Promise<DashboardAdminDecideAccessRequestResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return await fetchDashboardApi<DashboardAdminDecideAccessRequestResponse>(
    appendOrgQuery(`/dashboard/admin/access-requests/${encodeURIComponent(requestId)}`, orgId),
    {
      method: "PATCH",
      body: JSON.stringify(input),
      token,
    }
  );
}

function appendTrainingContentQuery(
  pathname: string,
  options?: {
    orgId?: string | null;
    q?: string | null;
    categoryId?: string | null;
    includeArchived?: string | null;
    focusTopicId?: string | null;
    contentType?: string | null;
    status?: string | null;
    sort?: string | null;
    page?: number | string | null;
    pageSize?: number | string | null;
  }
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export async function getDashboardTrainingContent(
  options?: Parameters<typeof appendTrainingContentQuery>[1]
): Promise<DashboardTrainingContentListResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentListResponse>(
    appendTrainingContentQuery("/dashboard/admin/training-content", options),
    { token }
  );
}

export async function getDashboardTrainingContentDetail(
  contentId: string,
  orgId?: string | null
): Promise<DashboardTrainingContentDetailResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentDetailResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}`,
      orgId
    ),
    { token }
  );
}

export async function createDashboardTrainingContent(
  input: CreateDashboardTrainingContentRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentDetailResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentDetailResponse>(
    appendOrgQuery("/dashboard/admin/training-content", orgId),
    { method: "POST", body: JSON.stringify(input), token }
  );
}

export async function updateDashboardTrainingContent(
  contentId: string,
  input: UpdateDashboardTrainingContentRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentDetailResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentDetailResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}`,
      orgId
    ),
    { method: "PATCH", body: JSON.stringify(input), token }
  );
}

export async function updateDashboardTrainingContentAssignments(
  contentId: string,
  input: UpdateDashboardTrainingContentAssignmentsRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentDetailResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentDetailResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}/assignments`,
      orgId
    ),
    { method: "PUT", body: JSON.stringify(input), token }
  );
}

export async function transitionDashboardTrainingContent(
  contentId: string,
  action: "publish" | "unpublish" | "archive",
  input: DashboardTrainingContentLifecycleRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentDetailResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentDetailResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}/${action}`,
      orgId
    ),
    { method: "POST", body: JSON.stringify(input), token }
  );
}

export async function getDashboardTrainingContentUserTargets(
  q: string,
  orgId?: string | null
): Promise<DashboardTrainingContentTargetsResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentTargetsResponse>(
    appendTrainingContentQuery("/dashboard/admin/training-content-targets/users", {
      orgId,
      q,
    }),
    { token }
  );
}

export async function getDashboardTrainingContentManagerTargets(
  q: string,
  orgId?: string | null
): Promise<DashboardTrainingContentTargetsResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentTargetsResponse>(
    appendTrainingContentQuery("/dashboard/admin/training-content-targets/managers", {
      orgId,
      q,
    }),
    { token }
  );
}

export async function getDashboardTrainingContentFocusTopics(
  orgId?: string | null
): Promise<DashboardTrainingContentFocusTopicsResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentFocusTopicsResponse>(
    appendOrgQuery("/dashboard/admin/training-content-targets/focus-topics", orgId),
    { token }
  );
}

export async function getDashboardTrainingContentCategories(
  orgId?: string | null,
  includeArchived = false
): Promise<DashboardTrainingContentCategoriesResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentCategoriesResponse>(
    appendTrainingContentQuery("/dashboard/admin/training-content/categories", {
      orgId,
      ...(includeArchived ? { includeArchived: "true" } : {}),
    }),
    { token }
  );
}

export async function createDashboardTrainingContentCategory(
  input: CreateDashboardTrainingContentCategoryRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentCategoryMutationResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentCategoryMutationResponse>(
    appendOrgQuery("/dashboard/admin/training-content/categories", orgId),
    { method: "POST", body: JSON.stringify(input), token }
  );
}

export async function updateDashboardTrainingContentCategory(
  categoryId: string,
  input: UpdateDashboardTrainingContentCategoryRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentCategoryMutationResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentCategoryMutationResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/categories/${encodeURIComponent(categoryId)}`,
      orgId
    ),
    { method: "PATCH", body: JSON.stringify(input), token }
  );
}

export async function reorderDashboardTrainingContentCategories(
  input: ReorderDashboardTrainingContentCategoriesRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentCategoriesResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentCategoriesResponse>(
    appendOrgQuery("/dashboard/admin/training-content/categories/reorder", orgId),
    { method: "PUT", body: JSON.stringify(input), token }
  );
}

export async function archiveDashboardTrainingContentCategory(
  categoryId: string,
  input: ArchiveDashboardTrainingContentCategoryRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentCategoryMutationResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentCategoryMutationResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/categories/${encodeURIComponent(categoryId)}/archive`,
      orgId
    ),
    { method: "POST", body: JSON.stringify(input), token }
  );
}

export async function getDashboardTrainingContentOrder(
  orgId?: string | null
): Promise<DashboardTrainingContentOrderResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentOrderResponse>(
    appendOrgQuery("/dashboard/admin/training-content/reorder", orgId),
    { token }
  );
}

export async function reorderDashboardTrainingContent(
  input: ReorderDashboardTrainingContentRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentOrderResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentOrderResponse>(
    appendOrgQuery("/dashboard/admin/training-content/reorder", orgId),
    { method: "PUT", body: JSON.stringify(input), token }
  );
}

export async function initiateDashboardTrainingContentUpload(
  contentId: string,
  input: DashboardTrainingContentUploadInitiationRequest,
  orgId?: string | null
): Promise<DashboardTrainingContentUploadInitiationResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentUploadInitiationResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}/assets/uploads`,
      orgId
    ),
    { method: "POST", body: JSON.stringify(input), token }
  );
}

export async function finalizeDashboardTrainingContentUpload(
  contentId: string,
  assetId: string,
  orgId?: string | null
): Promise<DashboardTrainingContentAssetFinalizationResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentAssetFinalizationResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}/assets/${encodeURIComponent(assetId)}/finalize`,
      orgId
    ),
    { method: "POST", body: "{}", token }
  );
}

export async function getDashboardTrainingContentAssetAccess(
  contentId: string,
  assetId: string,
  orgId?: string | null
): Promise<DashboardTrainingContentAssetAccessResponse> {
  const token = requireDashboardApiToken(await getWebAuthBearerToken());
  return fetchDashboardApi<DashboardTrainingContentAssetAccessResponse>(
    appendOrgQuery(
      `/dashboard/admin/training-content/${encodeURIComponent(contentId)}/assets/${encodeURIComponent(assetId)}/access`,
      orgId
    ),
    { method: "POST", body: "{}", token }
  );
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
