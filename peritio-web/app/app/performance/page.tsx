import Link from "next/link";
import { redirect } from "next/navigation";

import { PerformanceGroupSummary } from "@/src/components/OrganizationPerformanceOverview";
import { PageHeader } from "@/src/components/PageHeader";
import { PerformanceNavigation } from "@/src/components/PerformanceNavigation";
import { getDashboardViewer } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { resolvePerformanceOverviewScope } from "@/src/lib/organizationPerformance";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; divisionId?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getDashboardViewer();
  if (!viewer) {
    redirect(buildDashboardSessionResetPath());
  }
  const scope = resolvePerformanceOverviewScope(viewer, params.orgId);
  const navigationOrgId = viewer.accessType === "super_user" ? params.orgId : viewer.orgId;

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title="Performance"
        description="Review practice activity and performance results for your available scope."
      />

      {scope.kind !== "no_access" ? (
        <PerformanceNavigation activeView="group" orgId={navigationOrgId} divisionId={params.divisionId} />
      ) : null}

      {scope.kind === "organization" ? (
        <PerformanceGroupSummary scope="organization" orgId={scope.orgId} orgName={scope.orgName} />
      ) : null}

      {scope.kind === "team" ? (
        <PerformanceGroupSummary scope="team" orgId={scope.orgId} orgName={scope.orgName} />
      ) : null}

      {scope.kind === "no_access" ? (
        <section className="section-card">
          <div className="empty-state-panel">
            <h2>You don’t have performance dashboard access.</h2>
            <p>This dashboard does not include organization or team performance results for your account.</p>
          </div>
        </section>
      ) : null}

      {scope.kind === "select_organization" ? (
        <section className="section-card">
          <div className="empty-state-panel">
            <h2>Select a customer organization</h2>
            <p>Choose an organization before opening its performance overview.</p>
            <Link className="primary-button" href="/app/customers">Open Customers</Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
