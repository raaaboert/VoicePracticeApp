import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, reorderDashboardFocusTopics } from "@/src/lib/auth";
import { handleFocusTopicOrderUpdate } from "@/src/lib/contentOrganizationProxyHandlers";

export async function PUT(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleFocusTopicOrderUpdate(request, reorderDashboardFocusTopics);
}
