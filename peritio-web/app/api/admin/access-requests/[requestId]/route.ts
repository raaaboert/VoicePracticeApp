import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, decideDashboardAdminAccessRequest } from "@/src/lib/auth";
import { handleDashboardAdminAccessRequestPatch } from "@/src/lib/adminDashboardProxyHandlers";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  assertDashboardAuthConfig();
  const { requestId } = await context.params;
  return handleDashboardAdminAccessRequestPatch(request, requestId, {
    decideAccessRequest: decideDashboardAdminAccessRequest,
  });
}
