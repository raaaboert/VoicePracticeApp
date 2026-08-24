import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentEditor } from "@/src/components/TrainingContentEditor";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentCategories,
  getDashboardTrainingContentDetail,
  getDashboardTrainingContentFocusTopics,
  getDashboardTrainingContentScenarioOptions,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { trainingContentTypeLabel } from "@/src/lib/trainingContentPresentation";

export default async function TrainingContentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<{ orgId?: string }>;
}) {
  const [{ contentId }, query] = await Promise.all([params, searchParams]);
  const orgId = query.orgId?.trim() || null;
  let detail;
  let topics;
  let categories;
  let scenarioOptions;
  try {
    [detail, topics, categories, scenarioOptions] = await Promise.all([
      getDashboardTrainingContentDetail(contentId, orgId),
      getDashboardTrainingContentFocusTopics(orgId),
      getDashboardTrainingContentCategories(orgId),
      getDashboardTrainingContentScenarioOptions(orgId),
    ]);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    if (error instanceof DashboardApiError && error.status === 404) {
      notFound();
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
        eyebrow={`${trainingContentTypeLabel(detail.item.contentType)} | Version ${detail.item.contentVersion}`}
        title={detail.item.title}
        description={detail.item.description || `Learning Resource for ${detail.org.name}.`}
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentEditor
        initialItem={detail.item}
        categories={categories.categories}
        focusTopics={topics.focusTopics}
        scenarioOptions={scenarioOptions.scenarios}
        fileLimits={detail.fileLimitsBytes}
        orgId={orgId}
      />
    </>
  );
}
