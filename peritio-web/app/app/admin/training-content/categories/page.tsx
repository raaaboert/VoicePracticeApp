import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentCategoryManager } from "@/src/components/TrainingContentCategoryManager";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentCategories,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function TrainingContentCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const orgId = params.orgId?.trim() || null;
  let payload;
  try {
    payload = await getDashboardTrainingContentCategories(orgId, true);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    if (
      error instanceof DashboardApiError
      && ["module_disabled", "dashboard_scope_denied"].includes(error.code ?? "")
    ) {
      redirect("/app/access-denied");
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="Learning Resources"
        title="Manage Categories"
        description={`Organize the Learning Resources library for ${payload.org.name}.`}
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentCategoryManager
        initialCategories={payload.categories}
        initialOrderRevision={payload.orderRevision}
        orgId={orgId}
      />
    </>
  );
}
