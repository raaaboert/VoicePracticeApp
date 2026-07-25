import { NextRequest, NextResponse } from "next/server";
import type { DashboardAdminUpdateUserRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, updateDashboardAdminUser } from "@/src/lib/auth";
import {
  dashboardApiErrorResponse,
  noStore,
  readDashboardJsonBody,
  rejectNonAppDashboardApiHost,
} from "@/src/lib/dashboardApiProxy";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const { userId } = await context.params;
    const payload = (await readDashboardJsonBody(request)) as DashboardAdminUpdateUserRequest;
    const response = await updateDashboardAdminUser(userId, payload, request.nextUrl.searchParams.get("orgId"));
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
