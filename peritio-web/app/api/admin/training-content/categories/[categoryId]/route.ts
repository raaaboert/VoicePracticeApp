import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  updateDashboardTrainingContentCategory,
} from "@/src/lib/auth";
import { handleTrainingContentCategoryUpdate } from "@/src/lib/trainingContentProxyHandlers";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ categoryId: string }> }
) {
  assertDashboardAuthConfig();
  const { categoryId } = await context.params;
  return handleTrainingContentCategoryUpdate(request, categoryId, {
    updateCategory: updateDashboardTrainingContentCategory,
  });
}
