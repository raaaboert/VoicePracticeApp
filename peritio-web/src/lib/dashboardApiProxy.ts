import { NextRequest, NextResponse } from "next/server";

import {
  DashboardAccessDeniedError,
  DashboardApiError,
  DashboardSessionInvalidError,
} from "@/src/lib/dashboardApiErrorTypes";
import { classifyRequestHost } from "@/src/lib/domain";

export function rejectNonAppDashboardApiHost(request: NextRequest): NextResponse | null {
  const hostKind = classifyRequestHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind === "app" || hostKind === "local" || hostKind === "preview") {
    return null;
  }
  return NextResponse.json({ error: "Unknown host." }, { status: 404 });
}

export function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function readDashboardJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DashboardApiError(400, "Request body must be valid JSON.");
  }
}

export function dashboardApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof DashboardSessionInvalidError) {
    return noStore(NextResponse.json({ error: error.message }, { status: 401 }));
  }
  if (error instanceof DashboardAccessDeniedError) {
    return noStore(NextResponse.json({ error: error.message }, { status: 403 }));
  }
  if (error instanceof DashboardApiError) {
    return noStore(NextResponse.json({ error: error.message, code: error.code }, { status: error.status }));
  }
  console.error("[dashboard-api-proxy] request failed", error);
  return noStore(NextResponse.json({ error: "Dashboard request failed. Please retry." }, { status: 500 }));
}
