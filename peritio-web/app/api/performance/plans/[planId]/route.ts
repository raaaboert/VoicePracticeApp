import { NextRequest, NextResponse } from "next/server";
import type { UpdatePerformancePlanRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, getDashboardPerformancePlanDetail, updateDashboardPerformancePlan } from "@/src/lib/auth";
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

export async function PATCH(
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
    const payload = (await readPerformanceJsonBody(request)) as UpdatePerformancePlanRequest;
    const response = await updateDashboardPerformancePlan(
      planId,
      payload,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
