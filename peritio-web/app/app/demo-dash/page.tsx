import { redirect } from "next/navigation";

import { DashboardReportingWorkspace } from "@/src/components/DashboardReportingWorkspace";
import { getDashboardViewer } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import {
  buildDashboardDemoOverview,
  buildDashboardDemoTrainingWorkspace,
  buildDashboardDemoUserReport,
  canDashboardViewerAccessDemoAccount,
} from "@/src/lib/demoDashboardData";

export default async function DemoDashPage() {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    redirect(buildDashboardSessionResetPath());
  }

  if (!canDashboardViewerAccessDemoAccount(viewer)) {
    redirect("/app/access-denied?reason=customer-scope");
  }

  const trainingWorkspace = buildDashboardDemoTrainingWorkspace(viewer);
  const userReport = buildDashboardDemoUserReport(viewer);
  const overview = buildDashboardDemoOverview(viewer);

  return (
    <DashboardReportingWorkspace
      trainingWorkspace={trainingWorkspace}
      userReport={userReport}
      overview={overview}
      isDemoData
    />
  );
}
