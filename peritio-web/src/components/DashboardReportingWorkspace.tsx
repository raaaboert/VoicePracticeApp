"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DashboardOverviewResponse,
  DashboardTrainingWorkspaceResponse,
  DashboardTrainingWorkspaceRow,
  DashboardUserReportResponse,
} from "@voicepractice/shared";

import { MetricCard } from "@/src/components/MetricCard";
import { formatDateTime, formatScore, formatUsageMinutes } from "@/src/lib/formatters";

type DashboardReportTab = "training" | "users" | "company";

function normalizeDashboardTab(value: string | null): DashboardReportTab {
  if (value === "users" || value === "company") {
    return value;
  }

  return "training";
}

function formatTrainingStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatOrgRole(orgRole: string): string {
  if (orgRole === "org_admin") {
    return "Org Admin";
  }
  if (orgRole === "user_admin") {
    return "User Admin";
  }
  return "User";
}

function getTrainingOptionLabel(training: DashboardTrainingWorkspaceRow, multipleOrgs: boolean): string {
  return multipleOrgs ? `${training.name} - ${training.orgName}` : training.name;
}

export function DashboardReportingWorkspace({
  trainingWorkspace,
  userReport,
  overview,
}: {
  trainingWorkspace: DashboardTrainingWorkspaceResponse | null;
  userReport: DashboardUserReportResponse | null;
  overview: DashboardOverviewResponse | null;
}) {
  const searchParams = useSearchParams();
  const trainings = trainingWorkspace?.trainings ?? [];
  const multipleOrgsInScope = new Set(trainings.map((training) => training.orgId)).size > 1;
  const [activeTab, setActiveTab] = useState<DashboardReportTab>(() =>
    normalizeDashboardTab(searchParams.get("tab"))
  );
  const [selectedTrainingId, setSelectedTrainingId] = useState<string | null>(trainings[0]?.id ?? null);

  useEffect(() => {
    setActiveTab(normalizeDashboardTab(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    if (trainings.length === 0) {
      setSelectedTrainingId(null);
      return;
    }

    if (!selectedTrainingId || !trainings.some((training) => training.id === selectedTrainingId)) {
      setSelectedTrainingId(trainings[0].id);
    }
  }, [selectedTrainingId, trainings]);

  const selectedTraining =
    trainings.find((training) => training.id === selectedTrainingId) ?? trainings[0] ?? null;

  const trainingCountByUser = new Map<string, number>();
  for (const training of trainings) {
    for (const user of training.users) {
      trainingCountByUser.set(user.userId, (trainingCountByUser.get(user.userId) ?? 0) + 1);
    }
  }

  const topTrainings = trainings
    .slice()
    .sort((left, right) => {
      if (right.summary.totalAttemptsLast30Days !== left.summary.totalAttemptsLast30Days) {
        return right.summary.totalAttemptsLast30Days - left.summary.totalAttemptsLast30Days;
      }
      return (new Date(right.summary.latestActivityAt ?? 0).getTime() || 0) - (new Date(left.summary.latestActivityAt ?? 0).getTime() || 0);
    })
    .slice(0, 8);

  const users = userReport?.users ?? [];
  const userSummary = userReport?.summary;
  const companySummary = overview?.summary;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Training performance</h1>
          <p className="page-description">
            Review training, user, and company performance in one focused workspace.
          </p>
        </div>
      </header>

      <section className="section-card">
        <div className="tab-row" role="tablist" aria-label="Dashboard reporting views">
          <button
            type="button"
            className={`tab-button${activeTab === "training" ? " active" : ""}`}
            onClick={() => setActiveTab("training")}
          >
            Training
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === "users" ? " active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === "company" ? " active" : ""}`}
            onClick={() => setActiveTab("company")}
          >
            Company
          </button>
        </div>
      </section>

      {activeTab === "training" ? (
        <div className="tab-panel">
          <section className="section-card">
            <div className="dashboard-selector-grid">
              <div className="dashboard-selector-field">
                <label className="field-label" htmlFor="training-selector">
                  Training
                </label>
                <select
                  id="training-selector"
                  className="text-input"
                  value={selectedTraining?.id ?? ""}
                  onChange={(event) => setSelectedTrainingId(event.target.value || null)}
                  disabled={trainings.length === 0}
                >
                  {trainings.length === 0 ? <option value="">No trainings available</option> : null}
                  {trainings.map((training) => (
                    <option key={training.id} value={training.id}>
                      {getTrainingOptionLabel(training, multipleOrgsInScope)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTraining ? (
                <div className="dashboard-training-meta">
                  <div className="pill-row">
                    <span className="pill accent">{formatTrainingStatus(selectedTraining.status)}</span>
                    {multipleOrgsInScope ? <span className="pill">{selectedTraining.orgName}</span> : null}
                    <span className="pill">Updated {formatDateTime(selectedTraining.updatedAt)}</span>
                  </div>
                  <p className="small-copy">
                    {selectedTraining.attachedTrainingPackCount} attached packs and{" "}
                    {selectedTraining.attachedCustomScenarioCount} attached custom scenarios.
                  </p>
                </div>
              ) : (
                <div className="empty-state-panel">
                  <h3>No trainings available</h3>
                  <p>No trainings are available for your current reporting scope yet.</p>
                </div>
              )}
            </div>
          </section>

          {selectedTraining ? (
            <>
              <section className="metric-grid">
                <MetricCard
                  label="Total attempts"
                  value={`${selectedTraining.summary.totalAttemptsLast30Days}`}
                  meta="Last 30 days"
                />
                <MetricCard
                  label="Average score"
                  value={
                    selectedTraining.summary.averageScoreLast30Days !== null
                      ? formatScore(selectedTraining.summary.averageScoreLast30Days)
                      : "-"
                  }
                  meta="Last 30 days"
                  tone="positive"
                />
                <MetricCard
                  label="Active learners"
                  value={`${selectedTraining.summary.activeLearnerCountLast30Days}`}
                  meta="Last 30 days"
                  tone="accent"
                />
                <MetricCard
                  label="Scenarios in training"
                  value={`${selectedTraining.summary.totalScenarioCount}`}
                  meta="Attached or in use"
                  tone="warm"
                />
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Key insights</p>
                    <h2>{selectedTraining.name}</h2>
                    <p className="section-copy">
                      Highlights for the currently selected training based on recent real activity.
                    </p>
                  </div>
                </div>

                <div className="dashboard-insight-grid">
                  <article className="detail-card">
                    <p className="metric-label">Strongest area</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.strongestArea?.label ?? "No scored attempts yet"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTraining.insights.strongestArea?.averageScoreLast30Days !== null &&
                      selectedTraining.insights.strongestArea?.averageScoreLast30Days !== undefined
                        ? `Avg ${formatScore(selectedTraining.insights.strongestArea.averageScoreLast30Days)}`
                        : "Scores will appear after learners complete scored attempts."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Weakest area</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.weakestArea?.label ?? "No scored attempts yet"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTraining.insights.weakestArea?.averageScoreLast30Days !== null &&
                      selectedTraining.insights.weakestArea?.averageScoreLast30Days !== undefined
                        ? `Avg ${formatScore(selectedTraining.insights.weakestArea.averageScoreLast30Days)}`
                        : "Scores will appear after learners complete scored attempts."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Most-used scenario</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.mostUsedScenario?.title ?? "No attempts yet"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTraining.insights.mostUsedScenario
                        ? `${selectedTraining.insights.mostUsedScenario.attemptsLast30Days ?? 0} attempts`
                        : "This will populate as attempts are recorded."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Lowest-performing scenario</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.lowestPerformingScenario?.title ?? "No scored attempts yet"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTraining.insights.lowestPerformingScenario?.averageScoreLast30Days !== null &&
                      selectedTraining.insights.lowestPerformingScenario?.averageScoreLast30Days !== undefined
                        ? `Avg ${formatScore(selectedTraining.insights.lowestPerformingScenario.averageScoreLast30Days)}`
                        : "Scores will appear after scenario activity is scored."}
                    </p>
                  </article>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Users</p>
                    <h2>User performance</h2>
                    <p className="section-copy">
                      People with recent activity inside {selectedTraining.name}.
                    </p>
                  </div>
                </div>

                {selectedTraining.users.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Attempts</th>
                          <th>Average score</th>
                          <th>Latest activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTraining.users.map((user) => (
                          <tr key={user.userId}>
                            <td>
                              <Link className="inline-link subtle" href={`/app/users/${user.userId}`}>
                                <strong>{user.email}</strong>
                              </Link>
                              <div className="table-subcopy">
                                {formatOrgRole(user.orgRole)}
                                {user.latestScenarioTitle ? ` - Latest scenario: ${user.latestScenarioTitle}` : ""}
                              </div>
                            </td>
                            <td>{user.attemptsLast30Days}</td>
                            <td>
                              {user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}
                            </td>
                            <td>{formatDateTime(user.latestActivityAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state-panel">
                    <h3>No user activity yet</h3>
                    <p>This training does not have recent learner activity to report yet.</p>
                  </div>
                )}
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Scenarios</p>
                    <h2>Scenario performance</h2>
                    <p className="section-copy">
                      Scenario-level performance for the assets attached to {selectedTraining.name}.
                    </p>
                  </div>
                </div>

                {selectedTraining.scenarios.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Attempts</th>
                          <th>Average score</th>
                          <th>Latest activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTraining.scenarios.map((scenario) => (
                          <tr key={scenario.scenarioId}>
                            <td>
                              <strong>{scenario.title}</strong>
                              <div className="table-subcopy">
                                {scenario.segmentLabel} - {scenario.source === "custom" ? "Custom" : scenario.source === "standard" ? "Standard" : "Unknown"}
                              </div>
                            </td>
                            <td>{scenario.attemptsLast30Days}</td>
                            <td>
                              {scenario.averageScoreLast30Days !== null
                                ? formatScore(scenario.averageScoreLast30Days)
                                : "-"}
                            </td>
                            <td>{formatDateTime(scenario.latestActivityAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state-panel">
                    <h3>No scenario activity yet</h3>
                    <p>This training has not produced scenario-level reporting in the current window yet.</p>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div className="tab-panel">
          <section className="metric-grid">
            <MetricCard label="Users in scope" value={`${userSummary?.userCount ?? users.length}`} meta="Reporting scope" />
            <MetricCard label="Active users" value={`${userSummary?.activeUserCount ?? 0}`} meta="Current account status" />
            <MetricCard
              label="Total attempts"
              value={`${users.reduce((total, user) => total + user.simulationsLast30Days, 0)}`}
              meta="Last 30 days"
              tone="accent"
            />
            <MetricCard
              label="Average score"
              value={
                userSummary?.averageScoreLast30Days !== null && userSummary?.averageScoreLast30Days !== undefined
                  ? formatScore(userSummary.averageScoreLast30Days)
                  : "-"
              }
              meta="Last 30 days"
              tone="positive"
            />
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Users</p>
                <h2>User performance</h2>
                <p className="section-copy">Performance and recent activity across the current reporting scope.</p>
              </div>
            </div>

            {users.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Attempts</th>
                      <th>Average score</th>
                      <th>Trainings engaged</th>
                      <th>Latest activity</th>
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
                <p>User activity will appear here once attempts are recorded in your reporting scope.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "company" ? (
        <div className="tab-panel">
          <section className="metric-grid">
            <MetricCard
              label="Usage this period"
              value={formatUsageMinutes(companySummary?.monthlyUsageMinutes ?? 0)}
              meta="Current billing period"
            />
            <MetricCard
              label="Total attempts"
              value={`${companySummary?.simulationsLast30Days ?? 0}`}
              meta="Last 30 days"
              tone="accent"
            />
            <MetricCard label="Active users" value={`${companySummary?.activeUsers ?? 0}`} meta="Current reporting scope" />
            <MetricCard
              label="Average score"
              value={
                userSummary?.averageScoreLast30Days !== null && userSummary?.averageScoreLast30Days !== undefined
                  ? formatScore(userSummary.averageScoreLast30Days)
                  : "-"
              }
              meta="Last 30 days"
              tone="positive"
            />
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Company</p>
                <h2>Top trainings by activity</h2>
                <p className="section-copy">
                  The most active trainings in your current reporting scope.
                </p>
              </div>
            </div>

            {topTrainings.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Training</th>
                      <th>Company</th>
                      <th>Attempts</th>
                      <th>Active learners</th>
                      <th>Average score</th>
                      <th>Latest activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topTrainings.map((training) => (
                      <tr key={training.id}>
                        <td>
                          <strong>{training.name}</strong>
                          <div className="table-subcopy">{formatTrainingStatus(training.status)}</div>
                        </td>
                        <td>{training.orgName}</td>
                        <td>{training.summary.totalAttemptsLast30Days}</td>
                        <td>{training.summary.activeLearnerCountLast30Days}</td>
                        <td>
                          {training.summary.averageScoreLast30Days !== null
                            ? formatScore(training.summary.averageScoreLast30Days)
                            : "-"}
                        </td>
                        <td>{formatDateTime(training.summary.latestActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-panel">
                <h3>No training activity yet</h3>
                <p>Training-level company reporting will appear here as activity is recorded.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
