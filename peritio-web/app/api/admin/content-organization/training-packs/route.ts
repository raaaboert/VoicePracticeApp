import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, reorderDashboardTrainingPacks } from "@/src/lib/auth";
import { handleTrainingPackOrderUpdate } from "@/src/lib/contentOrganizationProxyHandlers";

export async function PUT(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingPackOrderUpdate(request, reorderDashboardTrainingPacks);
}
