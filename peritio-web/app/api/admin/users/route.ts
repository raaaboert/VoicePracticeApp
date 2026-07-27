import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardAdminUsers, getDashboardAdminUsersExport } from "@/src/lib/auth";
import { handleDashboardAdminUsersGet } from "@/src/lib/adminDashboardProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleDashboardAdminUsersGet(request, {
    getUsers: getDashboardAdminUsers,
    getUsersExport: getDashboardAdminUsersExport,
  });
}
