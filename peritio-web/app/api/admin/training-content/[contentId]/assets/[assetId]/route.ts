import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  getDashboardTrainingContentAssetStatus,
} from "@/src/lib/auth";
import { handleTrainingContentAssetStatus } from "@/src/lib/trainingContentProxyHandlers";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; assetId: string }> }
) {
  assertDashboardAuthConfig();
  const { contentId, assetId } = await context.params;
  return handleTrainingContentAssetStatus(request, contentId, assetId, {
    getAssetStatus: getDashboardTrainingContentAssetStatus,
  });
}
