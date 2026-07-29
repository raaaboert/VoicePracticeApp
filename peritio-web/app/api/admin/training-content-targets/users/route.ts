import { NextRequest } from "next/server";

import { assertDashboardAuthConfig, getDashboardTrainingContentUserTargets } from "@/src/lib/auth";
import { handleTrainingContentTargetsGet } from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentTargetsGet(request, "users", {
    getUserTargets: getDashboardTrainingContentUserTargets,
    getManagerTargets: async () => {
      throw new Error("Manager targets are not handled by the user-target route.");
    },
  });
}
