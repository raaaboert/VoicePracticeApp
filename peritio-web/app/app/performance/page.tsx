import Link from "next/link";
import { redirect } from "next/navigation";

import { OrganizationPerformanceOverview } from "@/src/components/OrganizationPerformanceOverview";
import { PageHeader } from "@/src/components/PageHeader";
import { buildPerformanceGoalsHref } from "@/src/components/organizationPerformancePresentation";
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
  const teamGoalsHref = buildPerformanceGoalsHref({
    orgId: viewer.orgId,
    divisionId: params.divisionId,
  });

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title="Performance"
        description="Review practice activity and performance results for your available scope."
      />

      {scope.kind === "organization" ? (
        <OrganizationPerformanceOverview orgId={scope.orgId} orgName={scope.orgName} />
      ) : null}

      {scope.kind === "team_pending" ? (
        <section className="section-card">
          <div className="empty-state-panel">
            <p className="eyebrow">Team scope</p>
            <h2>Team performance is not available yet.</h2>
            <p>Your access is limited to team performance. The team aggregate view will appear here when its dedicated data source is available.</p>
            <Link className="primary-button" href={teamGoalsHref}>Open Performance Goals</Link>
          </div>
        </section>
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
