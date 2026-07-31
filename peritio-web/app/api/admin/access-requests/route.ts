import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardAdminAccessRequests } from "@/src/lib/auth";
import { handleDashboardAdminAccessRequestsGet } from "@/src/lib/adminDashboardProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleDashboardAdminAccessRequestsGet(request, { getAccessRequests: getDashboardAdminAccessRequests });
}
