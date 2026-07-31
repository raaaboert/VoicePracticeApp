import { NextRequest, NextResponse } from "next/server";
import type {
  DashboardAdminAccessRequestsResponse,
  DashboardAdminDecideAccessRequest,
  DashboardAdminDecideAccessRequestResponse,
  DashboardAdminUpdateUserRequest,
  DashboardAdminUpdateUserResponse,
  DashboardAdminUsersExportResponse,
  DashboardAdminUsersResponse,
} from "@voicepractice/shared";

import { buildAdminUsersCsvFilename, buildDashboardAdminUsersCsv } from "./adminUsersCsv";
import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "./dashboardApiProxy";

export interface DashboardAdminProxyServices {
  getUsers: (orgId?: string | null) => Promise<DashboardAdminUsersResponse>;
  getUsersExport: (orgId?: string | null) => Promise<DashboardAdminUsersExportResponse>;
  updateUser: (
    userId: string,
    input: DashboardAdminUpdateUserRequest,
    orgId?: string | null
  ) => Promise<DashboardAdminUpdateUserResponse>;
  getAccessRequests: (orgId?: string | null) => Promise<DashboardAdminAccessRequestsResponse>;
  decideAccessRequest: (
    requestId: string,
    input: DashboardAdminDecideAccessRequest,
    orgId?: string | null
  ) => Promise<DashboardAdminDecideAccessRequestResponse>;
}

function requestedOrgId(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("orgId");
}

export function buildDashboardAdminUsersCsvResponse(
  payload: DashboardAdminUsersExportResponse
): NextResponse {
  const filename = buildAdminUsersCsvFilename(payload.org.name);
  return noStore(
    new NextResponse(buildDashboardAdminUsersCsv(payload), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}

export async function handleDashboardAdminUsersGet(
  request: NextRequest,
  services: Pick<DashboardAdminProxyServices, "getUsers" | "getUsersExport">
): Promise<NextResponse> {
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    if (request.nextUrl.searchParams.get("export") === "csv") {
      return buildDashboardAdminUsersCsvResponse(await services.getUsersExport(requestedOrgId(request)));
    }

    return noStore(NextResponse.json(await services.getUsers(requestedOrgId(request))));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleDashboardAdminUserPatch(
  request: NextRequest,
  userId: string,
  services: Pick<DashboardAdminProxyServices, "updateUser">
): Promise<NextResponse> {
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const payload = (await readDashboardJsonBody(request)) as DashboardAdminUpdateUserRequest;
    const response = await services.updateUser(userId, payload, requestedOrgId(request));
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleDashboardAdminAccessRequestsGet(
  request: NextRequest,
  services: Pick<DashboardAdminProxyServices, "getAccessRequests">
): Promise<NextResponse> {
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    return noStore(NextResponse.json(await services.getAccessRequests(requestedOrgId(request))));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}

export async function handleDashboardAdminAccessRequestPatch(
  request: NextRequest,
  requestId: string,
  services: Pick<DashboardAdminProxyServices, "decideAccessRequest">
): Promise<NextResponse> {
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const payload = (await readDashboardJsonBody(request)) as DashboardAdminDecideAccessRequest;
    const response = await services.decideAccessRequest(requestId, payload, requestedOrgId(request));
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
