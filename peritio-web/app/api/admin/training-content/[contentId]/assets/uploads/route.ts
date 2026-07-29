import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, initiateDashboardTrainingContentUpload } from "@/src/lib/auth";
import { handleTrainingContentUploadInitiate } from "@/src/lib/trainingContentProxyHandlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId } = await context.params;
  return handleTrainingContentUploadInitiate(request, contentId, {
    initiateUpload: initiateDashboardTrainingContentUpload,
  });
}
