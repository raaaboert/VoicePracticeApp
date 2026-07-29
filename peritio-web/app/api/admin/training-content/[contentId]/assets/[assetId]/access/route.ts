import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardTrainingContentAssetAccess } from "@/src/lib/auth";
import { handleTrainingContentAssetAccess } from "@/src/lib/trainingContentProxyHandlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; assetId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId, assetId } = await context.params;
  return handleTrainingContentAssetAccess(request, contentId, assetId, {
    getAssetAccess: getDashboardTrainingContentAssetAccess,
  });
}
