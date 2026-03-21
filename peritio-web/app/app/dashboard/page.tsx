import { DashboardReportingWorkspace } from "@/src/components/DashboardReportingWorkspace";
import {
  getDashboardOverview,
  getDashboardTrainingWorkspace,
  getDashboardUserReport,
} from "@/src/lib/auth";

export default async function DashboardPage() {
  const [trainingWorkspace, userReport, overview] = await Promise.all([
    getDashboardTrainingWorkspace(),
    getDashboardUserReport(),
    getDashboardOverview(),
  ]);

  return (
    <DashboardReportingWorkspace
      trainingWorkspace={trainingWorkspace}
      userReport={userReport}
      overview={overview}
    />
  );
}
