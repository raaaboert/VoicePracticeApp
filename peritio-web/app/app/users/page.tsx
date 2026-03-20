import Link from "next/link";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { getDashboardUserReport, getDashboardViewer } from "@/src/lib/auth";
import { formatDateTime, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";

function formatOrgRole(orgRole: string): string {
  if (orgRole === "org_admin") {
    return "Org Admin";
  }
  if (orgRole === "user_admin") {
    return "User Admin";
  }
  return "User";
}

export default async function UsersPage() {
  const viewer = await getDashboardViewer();
  const report = await getDashboardUserReport();
  const users = report?.users ?? [];
  const summary = report?.summary;

  return (
    <>
      <PageHeader
        eyebrow="Users"
        title="User reporting"
        description={
          viewer?.accessType === "platform_admin"
            ? "This user table now uses real protected usage and score records across the customers in your scope."
            : "This user table now reflects real usage and score activity inside your customer account."
        }
      />

      <section className="metric-grid">
        <MetricCard label="Users in scope" value={`${summary?.userCount ?? users.length}`} meta={`${summary?.activeUserCount ?? 0} active`} />
        <MetricCard label="Dashboard-enabled" value={`${summary?.dashboardUserCount ?? users.filter((user) => user.dashboardAccessEnabled).length}`} meta="Customer-side dashboard access enabled" />
        <MetricCard
          label="Simulations"
          value={`${summary?.simulationsLast30Days ?? users.reduce((total, user) => total + user.simulationsLast30Days, 0)}`}
          meta="Recorded in the last 30 days"
          tone="accent"
        />
        <MetricCard
          label="Average score"
          value={summary?.averageScoreLast30Days !== null && summary?.averageScoreLast30Days !== undefined ? formatScore(summary.averageScoreLast30Days) : "-"}
          meta="Across scored attempts in the last 30 days"
          tone="positive"
        />
      </section>

      <section className="section-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Company</th>
                <th>Role</th>
                <th>Simulations</th>
                <th>Usage</th>
                <th>Average score</th>
                <th>Trend</th>
                <th>Recent activity</th>
                <th>Latest training pack</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>
                    <Link className="inline-link subtle" href={`/app/users/${user.userId}`}>
                      <strong>{user.email}</strong>
                    </Link>
                    <div className="table-subcopy">
                      {user.dashboardAccessEnabled ? "Dashboard access enabled" : "Dashboard access disabled"}
                    </div>
                  </td>
                  <td>
                    {user.orgId ? (
                      <Link className="inline-link subtle" href={`/app/customers/${user.orgId}`}>
                        {user.orgName ?? user.orgId}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{formatOrgRole(user.orgRole)}</td>
                  <td>
                    {user.simulationsLast30Days}
                    <div className="table-subcopy">{user.uniqueScenariosLast30Days} scenarios</div>
                  </td>
                  <td>{formatUsageMinutes(user.usedMinutesLast30Days)}</td>
                  <td>{user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}</td>
                  <td>{user.scoreDeltaLast30Days !== null ? formatSignedPercent(user.scoreDeltaLast30Days) : "No prior window"}</td>
                  <td>
                    <div>{formatDateTime(user.latestActivityAt)}</div>
                    <div className="table-subcopy">{user.latestScenarioTitle ?? "No recent scenario"}</div>
                  </td>
                  <td>
                    <div>{user.latestTrainingPackTitle ?? "No recent pack linkage"}</div>
                    <div className="table-subcopy">
                      {user.trainingPackAttemptsLast30Days} pack-linked attempts · {user.scoredAttemptsLast30Days} scored attempts
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
