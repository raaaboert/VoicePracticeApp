import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  updateDashboardTrainingContentAssignments,
} from "@/src/lib/auth";
import { handleTrainingContentAssignmentsUpdate } from "@/src/lib/trainingContentProxyHandlers";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId } = await context.params;
  return handleTrainingContentAssignmentsUpdate(request, contentId, {
    updateAssignments: updateDashboardTrainingContentAssignments,
  });
}
