import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  createDashboardTrainingContent,
  getDashboardTrainingContent,
} from "@/src/lib/auth";
import {
  handleTrainingContentCreate,
  handleTrainingContentListGet,
} from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentListGet(request, {
    listContent: getDashboardTrainingContent,
  });
}

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentCreate(request, {
    createContent: createDashboardTrainingContent,
  });
}
