import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardNotifications, markDashboardNotificationRead } from "@/src/lib/auth";
import { handleNotificationMarkRead } from "@/src/lib/notificationProxyHandlers";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
) {
  assertDashboardAuthConfig();
  const { notificationId } = await context.params;
  return handleNotificationMarkRead(request, notificationId, {
    list: getDashboardNotifications,
    markRead: markDashboardNotificationRead,
  });
}
