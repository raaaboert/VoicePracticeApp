import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  reorderDashboardTrainingContentCategories,
} from "@/src/lib/auth";
import { handleTrainingContentCategoriesReorder } from "@/src/lib/trainingContentProxyHandlers";

export async function PUT(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentCategoriesReorder(request, {
    reorderCategories: reorderDashboardTrainingContentCategories,
  });
}
