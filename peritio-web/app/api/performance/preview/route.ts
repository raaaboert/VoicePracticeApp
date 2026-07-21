import { NextRequest, NextResponse } from "next/server";
import type { PerformancePlanPreviewRequest } from "@voicepractice/shared";

import { assertDashboardAuthConfig, previewDashboardPerformancePlan } from "@/src/lib/auth";
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
    const payload = (await readPerformanceJsonBody(request)) as PerformancePlanPreviewRequest;
    const response = await previewDashboardPerformancePlan(
      payload,
      request.nextUrl.searchParams.get("divisionId")
    );
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
