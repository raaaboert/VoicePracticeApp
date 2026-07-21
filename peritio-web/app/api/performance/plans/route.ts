import { NextRequest, NextResponse } from "next/server";
import type { CreatePerformancePlanRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, createDashboardPerformancePlan } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  readPerformanceJsonBody,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) {
    return hostResponse;
  }

  try {
    const payload = (await readPerformanceJsonBody(request)) as CreatePerformancePlanRequest;
    const response = await createDashboardPerformancePlan(
      payload,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response, { status: 201 }));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
