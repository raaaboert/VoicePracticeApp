import Link from "next/link";
import type { DashboardUserReportResponse } from "@voicepractice/shared";

import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { buildDashboardScopedUserDetailHref } from "@/src/components/dashboardDivisionFilterState";
import { buildPerformanceIndividualDetailHref } from "@/src/components/performanceViewRoutes";
import { formatDateTime, formatScore } from "@/src/lib/formatters";

function formatOrgRole(orgRole: string): string {
  if (orgRole === "org_admin") return "Org Admin";
  if (orgRole === "user_admin") return "User Admin";
  return "User";
}

export function DashboardUsersView({
  users,
  trainingCountByUser,
  divisionId,
  isSuperUser,
  isDemoData = false,
  primary = false,
}: {
  users: DashboardUserReportResponse["users"];
  trainingCountByUser: ReadonlyMap<string, number>;
  divisionId: string | null;
  isSuperUser: boolean;
  isDemoData?: boolean;
  primary?: boolean;
}) {
  const content = (
      <div className="dashboard-proof-stack">
        <div className="dashboard-proof-block">
          {!primary ? (
            <>
              <h3>User table</h3>
              <p>All users in scope stay visible here, including learners without enough scored history for comparison.</p>
            </>
          ) : null}
          {users.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table dashboard-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Attempts</th>
                    <th>Average score</th>
                    <th>Focus Topics practiced</th>
                    <th>Latest activity</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.userId}>
                      <td>
                        {isDemoData ? (
                          <strong>{user.email}</strong>
                        ) : (
                          <Link
                            className="inline-link subtle"
                            href={primary
                              ? buildPerformanceIndividualDetailHref(user.userId, divisionId)
                              : buildDashboardScopedUserDetailHref(user.userId, divisionId)}
                          >
                            <strong>{user.email}</strong>
                          </Link>
                        )}
                        <div className="table-subcopy">
                          {user.orgName ?? "Unknown company"} - {formatOrgRole(user.orgRole)}
                        </div>
                      </td>
                      <td>{user.simulationsLast30Days}</td>
                      <td>{user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}</td>
                      <td>{trainingCountByUser.get(user.userId) ?? 0}</td>
                      <td>{formatDateTime(user.latestActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state-panel">
              <h3>No user reporting yet</h3>
              <p>
                {isSuperUser
                  ? "User activity will appear here once attempts are recorded across the customer accounts currently in scope."
                  : "User activity will appear here once attempts are recorded in your reporting scope."}
              </p>
            </div>
          )}
        </div>
      </div>
  );
  if (primary) {
    return (
      <section className="section-card" aria-labelledby="people-in-scope-title">
        <div className="section-header">
          <div>
            <h2 id="people-in-scope-title">People in scope</h2>
            <p className="section-copy">Select a person to review their practice activity and performance.</p>
          </div>
        </div>
        {content}
      </section>
    );
  }
  return (
    <DashboardProofSection
      title="User detail"
      description="Open the full user table for attempts, scores, and latest activity."
      preview="Full user table"
    >
      {content}
    </DashboardProofSection>
  );
}
