import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardOrganizationPerformance } from "@/src/lib/auth";
import type { OrganizationPerformanceDimension } from "@/src/lib/organizationPerformance";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const response = await getDashboardOrganizationPerformance({
      orgId: request.nextUrl.searchParams.get("orgId") ?? "",
      year: Number(request.nextUrl.searchParams.get("year")),
      month: Number(request.nextUrl.searchParams.get("month")),
      dimension: request.nextUrl.searchParams.get("dimension") as OrganizationPerformanceDimension | null,
      dimensionId: request.nextUrl.searchParams.get("dimensionId"),
    });
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
