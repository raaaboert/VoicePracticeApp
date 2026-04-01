import { redirect } from "next/navigation";

import { DashboardReportingWorkspace } from "@/src/components/DashboardReportingWorkspace";
import {
  DashboardSessionInvalidError,
  getDashboardOverview,
  getDashboardTrainingWorkspace,
  getDashboardUserReport,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function DashboardPage() {
  let trainingWorkspace;
  let userReport;
  let overview;

  try {
    [trainingWorkspace, userReport, overview] = await Promise.all([
      getDashboardTrainingWorkspace(),
      getDashboardUserReport(),
      getDashboardOverview(),
    ]);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    throw error;
  }

  return (
    <DashboardReportingWorkspace
      trainingWorkspace={trainingWorkspace}
      userReport={userReport}
      overview={overview}
    />
  );
}
