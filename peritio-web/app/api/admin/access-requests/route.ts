import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardAdminAccessRequests } from "@/src/lib/auth";
import {
  dashboardApiErrorResponse,
  noStore,
  rejectNonAppDashboardApiHost,
} from "@/src/lib/dashboardApiProxy";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppDashboardApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const payload = await getDashboardAdminAccessRequests(request.nextUrl.searchParams.get("orgId"));
    return noStore(NextResponse.json(payload));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
