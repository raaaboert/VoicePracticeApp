import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentCreateForm } from "@/src/components/TrainingContentCreateForm";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentCategories,
  getDashboardTrainingContentFocusTopics,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function NewTrainingContentPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const orgId = params.orgId?.trim() || null;
  let topics;
  let categories;
  try {
    [topics, categories] = await Promise.all([
      getDashboardTrainingContentFocusTopics(orgId),
      getDashboardTrainingContentCategories(orgId),
    ]);
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
        eyebrow="Training Content"
        title="New Training Content"
        description={`Create a draft for ${topics.org.name}.`}
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentCreateForm
        orgId={orgId}
        categories={categories.categories}
        focusTopics={topics.focusTopics}
      />
    </>
  );
}
