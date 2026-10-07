import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardNotifications, markDashboardNotificationRead } from "@/src/lib/auth";
import { handleNotificationList } from "@/src/lib/notificationProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleNotificationList(request, {
    list: getDashboardNotifications,
    markRead: markDashboardNotificationRead,
  });
}
