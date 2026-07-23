import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { PerformanceWorkspace } from "@/src/components/PerformanceWorkspace";
import {
  DashboardSessionInvalidError,
  getDashboardPerformanceWorkspace,
  getDashboardViewer,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function CustomerPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    redirect(buildDashboardSessionResetPath());
  }
  if (viewer.accessType !== "super_user") {
    redirect("/app/dashboard");
  }

  const { customerId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let workspace;
  try {
    workspace = await getDashboardPerformanceWorkspace({ orgId: customerId, divisionId });
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    throw error;
  }

  if (!workspace || workspace.scopeMode !== "organization" || !workspace.selectedOrg) {
    notFound();
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer Performance"
        title={`${workspace.selectedOrg.orgName} Performance`}
        description={`Viewing ${workspace.selectedOrg.orgName} as a Peritio administrator.`}
        actions={<span className="pill accent">Peritio administrator company context</span>}
      />

      <PerformanceWorkspace workspace={workspace} divisionId={divisionId} />
    </>
  );
}
