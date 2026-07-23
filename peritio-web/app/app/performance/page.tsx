import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { PerformanceWorkspace } from "@/src/components/PerformanceWorkspace";
import {
  DashboardSessionInvalidError,
  getDashboardPerformanceWorkspace,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ divisionId?: string; orgId?: string }>;
}) {
  const params = await searchParams;
  const divisionId = params.divisionId?.trim() || null;
  const orgId = params.orgId?.trim() || null;
  let workspace;

  try {
    workspace = await getDashboardPerformanceWorkspace({ divisionId, orgId });
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    throw error;
  }

  if (!workspace) {
    redirect("/app/dashboard");
  }

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title={workspace.scopeMode === "portfolio" ? "Performance portfolio" : "Performance Goals"}
        description={
          workspace.scopeMode === "portfolio"
            ? "Select a customer account before reviewing or managing detailed Performance Goals."
            : `Assign Focus Topic goals, track current progress, and review finalized results${workspace.selectedOrg ? ` for ${workspace.selectedOrg.orgName}` : " across your dashboard scope"}.`
        }
      />

      <PerformanceWorkspace workspace={workspace} divisionId={divisionId} />
    </>
  );
}
