import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import { TrainingContentReorder } from "@/src/components/TrainingContentReorder";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContentOrder,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function ReorderTrainingContentPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const orgId = params.orgId?.trim() || null;
  let payload;
  try {
    payload = await getDashboardTrainingContentOrder(orgId);
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
        title="Reorder Content"
        description={`Set the library order for ${payload.org.name}.`}
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />
      <TrainingContentReorder
        initialGroups={payload.groups}
        initialOrderRevision={payload.orderRevision}
        orgId={orgId}
      />
    </>
  );
}
