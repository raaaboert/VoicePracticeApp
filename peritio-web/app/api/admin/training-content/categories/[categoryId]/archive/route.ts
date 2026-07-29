import { NextRequest } from "next/server";

import {
  archiveDashboardTrainingContentCategory,
  assertDashboardAuthConfig,
} from "@/src/lib/auth";
import { handleTrainingContentCategoryArchive } from "@/src/lib/trainingContentProxyHandlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ categoryId: string }> }
) {
  assertDashboardAuthConfig();
  const { categoryId } = await context.params;
  return handleTrainingContentCategoryArchive(request, categoryId, {
    archiveCategory: archiveDashboardTrainingContentCategory,
  });
}
