import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, transitionDashboardTrainingContent } from "@/src/lib/auth";
import { handleTrainingContentTransition } from "@/src/lib/trainingContentProxyHandlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId } = await context.params;
  return handleTrainingContentTransition(request, contentId, "archive", {
    transitionContent: transitionDashboardTrainingContent,
  });
}
