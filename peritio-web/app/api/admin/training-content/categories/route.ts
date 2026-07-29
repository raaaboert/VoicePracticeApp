import { NextRequest } from "next/server";

import {
  assertDashboardAuthConfig,
  createDashboardTrainingContentCategory,
  getDashboardTrainingContentCategories,
} from "@/src/lib/auth";
import {
  handleTrainingContentCategoriesGet,
  handleTrainingContentCategoryCreate,
} from "@/src/lib/trainingContentProxyHandlers";

export async function GET(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentCategoriesGet(request, {
    getCategories: getDashboardTrainingContentCategories,
  });
}

export async function POST(request: NextRequest) {
  assertDashboardAuthConfig();
  return handleTrainingContentCategoryCreate(request, {
    createCategory: createDashboardTrainingContentCategory,
  });
}
