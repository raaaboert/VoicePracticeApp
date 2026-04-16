import { redirect } from "next/navigation";

import { DashboardReportingWorkspace } from "@/src/components/DashboardReportingWorkspace";
import {
  DashboardSessionInvalidError,
  getDashboardOverview,
  getDashboardTrainingWorkspace,
  getDashboardUserReport,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const params = await searchParams;
  const rawDivisionId = params.divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let trainingWorkspace;
  let userReport;
  let overview;

  try {
    [trainingWorkspace, userReport, overview] = await Promise.all([
      getDashboardTrainingWorkspace(divisionId),
      getDashboardUserReport(divisionId),
      getDashboardOverview(divisionId),
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
