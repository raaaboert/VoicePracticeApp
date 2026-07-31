import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, finalizeDashboardTrainingContentUpload } from "@/src/lib/auth";
import { handleTrainingContentUploadFinalize } from "@/src/lib/trainingContentProxyHandlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; assetId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId, assetId } = await context.params;
  return handleTrainingContentUploadFinalize(request, contentId, assetId, {
    finalizeUpload: finalizeDashboardTrainingContentUpload,
  });
}
