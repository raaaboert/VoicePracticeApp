import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardTeamPerformance } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) return hostResponse;

  try {
    const response = await getDashboardTeamPerformance({
      orgId: request.nextUrl.searchParams.get("orgId") ?? "",
      year: Number(request.nextUrl.searchParams.get("year")),
      month: Number(request.nextUrl.searchParams.get("month")),
    });
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
