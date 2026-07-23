import { NextRequest, NextResponse } from "next/server";
import type { CreatePerformancePlanUpdateRequest } from "@voicepractice/shared";

import {
  assertDashboardAuthConfig,
  createDashboardPerformancePlanUpdate,
  getDashboardPerformancePlanUpdates
} from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  readPerformanceJsonBody,
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
    const response = await getDashboardPerformancePlanUpdates(
      planId,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}

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
    const payload = (await readPerformanceJsonBody(request)) as CreatePerformancePlanUpdateRequest;
    const response = await createDashboardPerformancePlanUpdate(
      planId,
      payload,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response, { status: 201 }));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
