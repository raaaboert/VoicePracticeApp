import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentEditor } from "@/src/components/TrainingContentEditor";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentDetail,
  getDashboardTrainingContentFocusTopics,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import {
  trainingContentOrgQuery,
  trainingContentTypeLabel,
} from "@/src/lib/trainingContentPresentation";

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
  try {
    [detail, topics] = await Promise.all([
      getDashboardTrainingContentDetail(contentId, orgId),
      getDashboardTrainingContentFocusTopics(orgId),
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
        description={detail.item.description || `Training Content for ${detail.org.name}.`}
        actions={
          <Link
            className="ghost-button icon-text-button"
            href={`/app/admin/training-content${trainingContentOrgQuery(orgId)}`}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back to list
          </Link>
        }
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentEditor
        initialItem={detail.item}
        focusTopics={topics.focusTopics}
        fileLimits={detail.fileLimitsBytes}
        orgId={orgId}
      />
    </>
  );
}
