import { NextRequest, NextResponse } from "next/server";

import { assertDashboardAuthConfig, getDashboardAttemptDetail } from "@/src/lib/auth";
import {
  dashboardPerformanceApiErrorResponse,
  noStore,
  rejectNonAppPerformanceApiHost,
} from "@/src/lib/performanceApiProxy";

export async function GET(request: NextRequest, context: { params: Promise<{ attemptId: string }> }) {
  assertDashboardAuthConfig();
  const hostResponse = rejectNonAppPerformanceApiHost(request);
  if (hostResponse) return hostResponse;

  const { attemptId } = await context.params;
  try {
    const response = await getDashboardAttemptDetail(
      attemptId,
      request.nextUrl.searchParams.get("divisionId"),
    );
    if (!response) return noStore(NextResponse.json({ error: "Attempt detail not found." }, { status: 404 }));
    return noStore(NextResponse.json(response));
  } catch (error) {
    return dashboardPerformanceApiErrorResponse(error);
  }
}
