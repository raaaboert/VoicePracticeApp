import { NextRequest, NextResponse } from "next/server";
import type { CancelPerformancePlanRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, cancelDashboardPerformancePlan } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function POST(
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
    const payload = (await request.json().catch(() => ({}))) as CancelPerformancePlanRequest;
    const response = await cancelDashboardPerformancePlan(
      planId,
      payload,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
