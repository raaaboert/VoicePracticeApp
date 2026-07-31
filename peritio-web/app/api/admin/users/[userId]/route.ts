import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, updateDashboardAdminUser } from "@/src/lib/auth";
import { handleDashboardAdminUserPatch } from "@/src/lib/adminDashboardProxyHandlers";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  assertDashboardAuthConfig();
  const { userId } = await context.params;
  return handleDashboardAdminUserPatch(request, userId, { updateUser: updateDashboardAdminUser });
}
