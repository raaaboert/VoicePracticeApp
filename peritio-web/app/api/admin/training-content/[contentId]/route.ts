import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  getDashboardTrainingContentDetail,
  updateDashboardTrainingContent,
} from "@/src/lib/auth";
import {
  handleTrainingContentDetailGet,
  handleTrainingContentUpdate,
} from "@/src/lib/trainingContentProxyHandlers";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId } = await context.params;
  return handleTrainingContentDetailGet(request, contentId, {
    getContent: getDashboardTrainingContentDetail,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId } = await context.params;
  return handleTrainingContentUpdate(request, contentId, {
    updateContent: updateDashboardTrainingContent,
  });
}
