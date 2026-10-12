import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardNotifications, markAllDashboardNotificationsRead, markDashboardNotificationRead, dismissDashboardNotification } from "@/src/lib/auth";
import { handleNotificationList, handleNotificationMarkAllRead } from "@/src/lib/notificationProxyHandlers";

const dependencies = {
  list: getDashboardNotifications,
  markRead: markDashboardNotificationRead,
  dismiss: dismissDashboardNotification,
  markAllRead: markAllDashboardNotificationsRead,
};

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleNotificationList(request, dependencies);
}

export async function PATCH(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleNotificationMarkAllRead(request, dependencies);
}
