import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardTrainingContentFocusTopics } from "@/src/lib/auth";
import { handleTrainingContentFocusTopicsGet } from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentFocusTopicsGet(request, {
    getFocusTopics: getDashboardTrainingContentFocusTopics,
  });
}
