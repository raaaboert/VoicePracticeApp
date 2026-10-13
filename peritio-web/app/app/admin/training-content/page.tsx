import {
  FilePlus2,
  FolderCog,
  ListOrdered,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentCategoryList } from "@/src/components/TrainingContentCategoryList";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentCategories,
  getDashboardTrainingContentFocusTopics,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { trainingContentOrgQuery } from "@/src/lib/trainingContentPresentation";

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function TrainingContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const orgId = single(raw.orgId).trim() || null;

  let topicsPayload;
  let categoriesPayload;
  try {
    [topicsPayload, categoriesPayload] = await Promise.all([
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
        eyebrow="Admin"
        title="Learning Resources"
        description={`Manage learning resources for ${categoriesPayload.org.name}.`}
        actions={
          <div className="page-actions training-content-page-actions">
            <Link
              className="ghost-button icon-text-button"
              href={`/app/admin/training-content/categories${trainingContentOrgQuery(orgId)}`}
            >
              <FolderCog size={18} aria-hidden="true" />
              Manage Categories
            </Link>
            <Link
              className="ghost-button icon-text-button"
              href={`/app/admin/training-content/reorder${trainingContentOrgQuery(orgId)}`}
            >
              <ListOrdered size={18} aria-hidden="true" />
              Reorder Content
            </Link>
            <Link
              className="primary-button icon-text-button"
              href={`/app/admin/training-content/new${trainingContentOrgQuery(orgId)}`}
            >
              <FilePlus2 size={18} aria-hidden="true" />
              Add Learning Resource
            </Link>
          </div>
        }
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentCategoryList
        orgId={orgId}
        categories={categoriesPayload.categories}
        focusTopics={topicsPayload.focusTopics}
        initialFilters={{
          q: single(raw.q),
          categoryId: single(raw.categoryId),
          focusTopicId: single(raw.focusTopicId),
          contentType: single(raw.contentType),
          status: single(raw.status),
          sort: single(raw.sort) || "library_order",
        }}
      />
    </>
  );
}
