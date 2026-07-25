import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardAdminUsers, getDashboardAdminUsersExport } from "@/src/lib/auth";
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
    const payload = request.nextUrl.searchParams.get("export") === "csv"
      ? await getDashboardAdminUsersExport(request.nextUrl.searchParams.get("orgId"))
      : await getDashboardAdminUsers(request.nextUrl.searchParams.get("orgId"));
    return noStore(NextResponse.json(payload));
  } catch (error) {
    return dashboardApiErrorResponse(error);
  }
}
