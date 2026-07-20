import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardPerformancePlanDetail } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const { planId } = await context.params;
    const response = await getDashboardPerformancePlanDetail(
      planId,
      request.nextUrl.searchParams.get("divisionId")
    );
    if (!response) {
      return noStore(NextResponse.json({ error: "Performance plan not found." }, { status: 404 }));
    }
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
