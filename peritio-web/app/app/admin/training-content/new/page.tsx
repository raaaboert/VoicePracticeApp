import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentCreateForm } from "@/src/components/TrainingContentCreateForm";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentCategories,
  getDashboardTrainingContentFocusTopics,
  getDashboardTrainingContentScenarioOptions,
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
  let scenarioOptions;
  try {
    [topics, categories, scenarioOptions] = await Promise.all([
      getDashboardTrainingContentFocusTopics(orgId).catch((error) => {
        if (error instanceof DashboardSessionInvalidError || (error instanceof DashboardApiError && error.status < 500)) throw error;
        return null;
      }),
      getDashboardTrainingContentCategories(orgId),
      getDashboardTrainingContentScenarioOptions(orgId),
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
        eyebrow="Learning Resources"
        title="New Learning Resource"
        description={`Create a draft for ${categories.org.name}.`}
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentCreateForm
        key={categories.org.id}
        orgId={orgId}
        categories={categories.categories}
        focusTopics={topics?.focusTopics ?? []}
        topicLoadError={!topics ? "Could not load Focus Topics. Retry to choose Topics, or create an unattached resource." : undefined}
        scenarioOptions={scenarioOptions.scenarios}
      />
    </>
  );
}
