import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardUserAttemptHistory } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) return hostResponse;

  const { userId } = await context.params;
  try {
    const response = await getDashboardUserAttemptHistory(userId, {
      divisionId: request.nextUrl.searchParams.get("divisionId"),
      focusTopicId: request.nextUrl.searchParams.get("focusTopicId"),
      scenario: request.nextUrl.searchParams.get("scenario"),
      startDate: request.nextUrl.searchParams.get("startDate"),
      endDate: request.nextUrl.searchParams.get("endDate"),
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: Number(request.nextUrl.searchParams.get("limit") ?? "20"),
    });
    if (!response) return noStore(NextResponse.json({ error: "Attempt history not found." }, { status: 404 }));
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
