import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardUsersView } from "@/src/components/DashboardUsersView";
import { PageHeader } from "@/src/components/PageHeader";
import { PerformanceNavigation } from "@/src/components/PerformanceNavigation";
import {
  DashboardSessionInvalidError,
  getDashboardTrainingWorkspace,
  getDashboardUserReport,
  getDashboardViewer,
  listAccessibleCustomers,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function PerformanceIndividualsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; divisionId?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getDashboardViewer();
  if (!viewer) redirect(buildDashboardSessionResetPath());

  const orgId = viewer.accessType === "super_user" ? params.orgId?.trim() || null : viewer.orgId;
  const divisionId = params.divisionId?.trim() || null;
  if (viewer.performanceAccess === "none" && viewer.accessType !== "super_user") {
    return (
      <>
        <PageHeader eyebrow="Performance" title="Individuals" description="Review authorized person-level performance." />
        <section className="section-card">
          <div className="empty-state-panel">
            <h2>You don’t have performance dashboard access.</h2>
            <p>This dashboard does not include individual performance results for your account.</p>
          </div>
        </section>
      </>
    );
  }
  if (viewer.accessType === "super_user" && !orgId) {
    return (
      <>
        <PageHeader eyebrow="Performance" title="Individuals" description="Review authorized person-level performance." />
        <PerformanceNavigation activeView="individuals" />
        <section className="section-card">
          <div className="empty-state-panel">
            <h2>Select a customer organization</h2>
            <p>Choose an organization before opening its individual performance view.</p>
            <Link className="primary-button" href="/app/customers">Open Customers</Link>
          </div>
        </section>
      </>
    );
  }

  let report;
  let trainingWorkspace;
  try {
    if (viewer.accessType === "super_user") {
      const customers = await listAccessibleCustomers();
      if (!customers.some((customer) => customer.orgId === orgId)) notFound();
    }
    [report, trainingWorkspace] = await Promise.all([
      getDashboardUserReport(divisionId),
      getDashboardTrainingWorkspace(divisionId),
    ]);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) redirect(buildDashboardSessionResetPath());
    throw error;
  }

  const users = (report?.users ?? []).filter((user) => user.orgId === orgId);
  const appliedDivisionId = report?.divisionScope?.appliedDivisionId ?? null;
  const trainingCountByUser = new Map<string, number>();
  for (const training of trainingWorkspace?.trainings ?? []) {
    if (training.orgId !== orgId) continue;
    for (const user of training.users) {
      trainingCountByUser.set(user.userId, (trainingCountByUser.get(user.userId) ?? 0) + 1);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Performance"
        title="Individuals"
        description="Review authorized people, their practice activity, and scored attempt history."
      />
      <PerformanceNavigation activeView="individuals" orgId={orgId} divisionId={appliedDivisionId} />
      <DashboardDivisionFilter divisionScope={report?.divisionScope} />
      <DashboardUsersView
        users={users}
        trainingCountByUser={trainingCountByUser}
        divisionId={appliedDivisionId}
        isSuperUser={viewer.accessType === "super_user"}
        defaultOpen
      />
    </>
  );
}
