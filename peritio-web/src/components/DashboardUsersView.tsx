"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
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

export function filterDashboardUsers(
  users: DashboardUserReportResponse["users"],
  query: string,
  isSuperUser: boolean,
): DashboardUserReportResponse["users"] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return users;
  return users.filter((user) => {
    const searchable = [user.displayName, user.email, isSuperUser ? user.orgName : null]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });
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
  trainingCountByUser: Readonly<Record<string, number>>;
  divisionId: string | null;
  isSuperUser: boolean;
  isDemoData?: boolean;
  primary?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredUsers = useMemo(() => filterDashboardUsers(users, query, isSuperUser), [isSuperUser, query, users]);

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
            <div className="dashboard-user-search">
              <label className="field-label" htmlFor={`dashboard-user-search-${primary ? "primary" : "report"}`}>
                Search users
              </label>
              <input
                id={`dashboard-user-search-${primary ? "primary" : "report"}`}
                className="text-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isSuperUser ? "Search by name, email, or organization" : "Search by name or email"}
              />
              <p className="small-copy" aria-live="polite">Showing {filteredUsers.length} of {users.length}</p>
            </div>
          ) : null}
          {users.length > 0 ? (
            filteredUsers.length > 0 ? <div className="table-scroll">
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
                  {filteredUsers.map((user) => (
                    <tr key={user.userId}>
                      <td>
                        {isDemoData ? (
                          <strong>{user.displayName ?? user.email}</strong>
                        ) : (
                          <Link
                            className="inline-link subtle"
                            href={primary
                              ? buildPerformanceIndividualDetailHref(user.userId, divisionId)
                              : buildDashboardScopedUserDetailHref(user.userId, divisionId)}
                          >
                            <strong>{user.displayName ?? user.email}</strong>
                          </Link>
                        )}
                        <div className="table-subcopy">
                          {user.displayName ? `${user.email} · ` : ""}{user.orgName ?? "Unknown company"} - {formatOrgRole(user.orgRole)}
                        </div>
                      </td>
                      <td>{user.simulationsLast30Days}</td>
                      <td>{user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}</td>
                      <td>{trainingCountByUser[user.userId] ?? 0}</td>
                      <td>{formatDateTime(user.latestActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div> : (
              <div className="empty-state-panel" role="status">
                <h3>No users match your search</h3>
                <p>Try a different name or email{isSuperUser ? ", or search by organization" : ""}.</p>
              </div>
            )
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
