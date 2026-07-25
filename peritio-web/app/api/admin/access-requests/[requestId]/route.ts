import { NextRequest, NextResponse } from "next/server";
import type { DashboardAdminDecideAccessRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, decideDashboardAdminAccessRequest } from "@/src/lib/auth";
import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "@/src/lib/dashboardApiProxy";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const { requestId } = await context.params;
    const payload = (await readDashboardJsonBody(request)) as DashboardAdminDecideAccessRequest;
    const response = await decideDashboardAdminAccessRequest(
      requestId,
      payload,
      request.nextUrl.searchParams.get("orgId")
    );
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
