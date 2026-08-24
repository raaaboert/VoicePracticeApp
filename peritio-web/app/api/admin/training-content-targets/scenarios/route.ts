import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  getDashboardTrainingContentScenarioOptions,
} from "@/src/lib/auth";
import { handleTrainingContentScenarioOptionsGet } from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentScenarioOptionsGet(request, {
    getScenarioOptions: getDashboardTrainingContentScenarioOptions,
  });
}
