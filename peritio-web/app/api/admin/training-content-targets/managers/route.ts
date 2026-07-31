import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardTrainingContentManagerTargets } from "@/src/lib/auth";
import { handleTrainingContentTargetsGet } from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentTargetsGet(request, "managers", {
    getManagerTargets: getDashboardTrainingContentManagerTargets,
    getUserTargets: async () => {
      throw new Error("User targets are not handled by the manager-target route.");
    },
  });
}
