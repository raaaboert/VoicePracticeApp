import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  getDashboardTrainingContentOrder,
  reorderDashboardTrainingContent,
} from "@/src/lib/auth";
import {
  handleTrainingContentOrderGet,
  handleTrainingContentOrderUpdate,
} from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentOrderGet(request, {
    getContentOrder: getDashboardTrainingContentOrder,
  });
}

export async function PUT(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentOrderUpdate(request, {
    reorderContent: reorderDashboardTrainingContent,
  });
}
