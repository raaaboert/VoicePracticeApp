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

import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { buildDashboardAggregateScopeContext } from "@/src/components/dashboardReportingScope";
import { canRenderDashboardWorkspaceDivisionFilter } from "@/src/components/dashboardDivisionFilterState";
import { MetricCard } from "@/src/components/MetricCard";
import {
  buildAggregateCompanyNarrative,
  buildAggregateTrainingNarrative,
  buildAggregateUsersNarrative,
  buildUserHighlights,
} from "@/src/lib/dashboardNarratives";
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
  const viewer = overview?.viewer ?? userReport?.viewer ?? trainingWorkspace?.viewer ?? null;
  const isSuperUser = viewer?.accessType === "super_user";
  const aggregateScopeContext = isSuperUser ? buildDashboardAggregateScopeContext(overview?.customers ?? []) : null;
  const multipleOrgsInScope = new Set(trainings.map((training) => training.orgId)).size > 1;
  const [activeTab, setActiveTab] = useState<DashboardReportTab>(() => normalizeDashboardTab(searchParams.get("tab")));
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

  const selectedTraining = trainings.find((training) => training.id === selectedTrainingId) ?? trainings[0] ?? null;
  const selectedTrainingScoredScenarioCount =
    selectedTraining?.scenarios.filter((scenario) => scenario.averageScoreLast30Days !== null).length ?? 0;
  const selectedTrainingUnderusedScenarioCount =
    selectedTraining?.scenarios.filter((scenario) => scenario.attemptsLast30Days === 0).length ?? 0;

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
  const userHighlights = buildUserHighlights(users);
  const trainingNarrative = buildAggregateTrainingNarrative(selectedTraining);
  const usersNarrative = buildAggregateUsersNarrative(userReport);
  const companyNarrative = buildAggregateCompanyNarrative({
    overview,
    trainings,
    userReport,
  });
  const leadTraining = topTrainings[0] ?? null;
  const activeTrainingCount = trainings.filter((training) => training.summary.totalAttemptsLast30Days > 0).length;
  const underusedActiveTrainingCount = trainings.filter(
    (training) => training.status === "active" && training.summary.totalAttemptsLast30Days === 0
  ).length;
  const comparisonCoverageCount = userHighlights.comparisonUsers.length;
  const positiveMovementUsers = userHighlights.comparisonUsers.filter((user) => (user.scoreDeltaLast30Days ?? 0) > 0).length;
  const negativeMovementUsers = userHighlights.comparisonUsers.filter((user) => (user.scoreDeltaLast30Days ?? 0) < 0).length;
  const topScenario = overview?.topScenarios[0] ?? null;
  const companyMovementLabel =
    comparisonCoverageCount < 2
      ? "Too early"
      : positiveMovementUsers > negativeMovementUsers
        ? "Net positive"
        : negativeMovementUsers > positiveMovementUsers
          ? "Needs review"
          : "Mixed";
  const companyMovementMeta =
    comparisonCoverageCount < 2
      ? "Fewer than 2 users have enough score history for comparison"
      : `${comparisonCoverageCount} users have enough score history for comparison`;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Training performance</h1>
          <p className="page-description">
            {isSuperUser
              ? "Review aggregate performance across the customer accounts currently in scope. Use Customers for account-specific drilldown."
              : "Review performance by training, user, and company."}
          </p>
        </div>
      </header>

      {canRenderDashboardWorkspaceDivisionFilter({
        viewer,
        divisionScope: overview?.divisionScope ?? trainingWorkspace?.divisionScope ?? userReport?.divisionScope,
      }) ? (
        <DashboardDivisionFilter
          divisionScope={overview?.divisionScope ?? trainingWorkspace?.divisionScope ?? userReport?.divisionScope}
          title="Company and division view"
          description="Company Total keeps the default company-wide dashboard. Division filters narrow this page to historically attributed activity only."
        />
      ) : null}

      {aggregateScopeContext ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Reporting scope</p>
              <h2>Aggregate customer view</h2>
              <p className="section-copy">{aggregateScopeContext.description}</p>
            </div>
          </div>

          <div className="pill-row">
            <span className="pill accent">{aggregateScopeContext.customerCount} customer accounts</span>
            <span className="pill">{aggregateScopeContext.activeCustomerCount} active</span>
            {aggregateScopeContext.inactiveCustomerCount > 0 ? (
              <span className="pill">{aggregateScopeContext.inactiveCustomerCount} inactive</span>
            ) : null}
          </div>

          <div className="dashboard-scope-copy">
            <p>{aggregateScopeContext.detail}</p>
            {aggregateScopeContext.activityNote ? <p>{aggregateScopeContext.activityNote}</p> : null}
            <p>Use Customers when you need to inspect one account&apos;s dashboard and activity in detail.</p>
          </div>
        </section>
      ) : null}

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
        <div className="tab-panel page-stack">
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
                    {selectedTraining.attachedTrainingPackCount} attached packs and {selectedTraining.attachedCustomScenarioCount} attached custom scenarios.
                  </p>
                </div>
              ) : (
                <div className="empty-state-panel">
                  <h3>No trainings available</h3>
                  <p>
                    {isSuperUser
                      ? "No trainings are available across the customer accounts currently in scope yet."
                      : "No trainings are available for your current reporting scope yet."}
                  </p>
                </div>
              )}
            </div>
          </section>

          {selectedTraining ? (
            <>
              <DashboardNarrativePanel
                eyebrow="Quick read"
                title="What this training is doing now"
                narrative={trainingNarrative}
                badges={[
                  `${selectedTraining.summary.totalAttemptsLast30Days} attempts`,
                  `${selectedTraining.summary.activeLearnerCountLast30Days} active learners`,
                ]}
              />

              <section className="metric-grid metric-grid-primary">
                <MetricCard
                  label="Total attempts"
                  value={`${selectedTraining.summary.totalAttemptsLast30Days}`}
                  meta="All recorded attempts in the last 30 days"
                />
                <MetricCard
                  label="Average score"
                  value={
                    selectedTraining.summary.averageScoreLast30Days !== null
                      ? formatScore(selectedTraining.summary.averageScoreLast30Days)
                      : "-"
                  }
                  meta="30-day average from conclusive scored attempts only"
                  tone="positive"
                />
                <MetricCard
                  label="Active learners"
                  value={`${selectedTraining.summary.activeLearnerCountLast30Days}`}
                  meta="Last 30 days"
                  tone="accent"
                />
                <MetricCard
                  label="Scored scenario coverage"
                  value={`${selectedTrainingScoredScenarioCount}/${selectedTraining.summary.totalScenarioCount}`}
                  meta="Scenarios with conclusive scored activity"
                  tone="warm"
                />
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Movement and focus</p>
                    <h2>Where to look next</h2>
                    <p className="section-copy">
                      Use these signals to separate activity, evidence strength, and scenario coverage before opening the detail tables.
                    </p>
                  </div>
                </div>

                <div className="info-grid">
                  <article className="detail-card">
                    <p className="metric-label">Most-used scenario</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.mostUsedScenario?.title ?? "No recent activity"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTraining.insights.mostUsedScenario
                        ? `${selectedTraining.insights.mostUsedScenario.attemptsLast30Days ?? 0} attempts in the last 30 days`
                        : "Scenario traction will appear here as learners practice."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Score signal</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTraining.insights.weakestArea?.label ?? "Too early to call"}
                    </strong>
                    <p className="metric-meta">
                      {selectedTrainingScoredScenarioCount >= 2
                        ? "The weakest legacy scoring area on current scored activity."
                        : "More scored scenario coverage is needed before the weakest area is reliable."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Coverage gap</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTrainingUnderusedScenarioCount === 0 ? "All active" : `${selectedTrainingUnderusedScenarioCount} quiet`}
                    </strong>
                    <p className="metric-meta">
                      {selectedTrainingUnderusedScenarioCount === 0
                        ? "Every scenario in this training shows at least some recent activity."
                        : "Scenarios with no recent activity in the current window."}
                    </p>
                  </article>
                  <article className="detail-card">
                    <p className="metric-label">Evidence caution</p>
                    <strong className="metric-value dashboard-insight-value">
                      {selectedTrainingScoredScenarioCount >= 2 ? "Usable" : "Sparse"}
                    </strong>
                    <p className="metric-meta">
                      This aggregate view is best for current activity and focus. Reliable time-based score movement needs more scored evidence.
                    </p>
                  </article>
                </div>
              </section>

              <section className="section-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Details</p>
                    <h2>User activity inside this training</h2>
                    <p className="section-copy">
                      Raw detail stays available below the story layer. Attempt counts reflect usage activity; score averages reflect only completed scored attempts.
                    </p>
                  </div>
                </div>

                {selectedTraining.users.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table dashboard-table">
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
                            <td>{user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}</td>
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
                    <p className="eyebrow">Details</p>
                    <h2>Scenario performance</h2>
                    <p className="section-copy">
                      Scenario-level detail is still available below the fold so you can inspect exactly where activity and scores are showing up.
                    </p>
                  </div>
                </div>

                {selectedTraining.scenarios.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table dashboard-table">
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
                            <td>{scenario.averageScoreLast30Days !== null ? formatScore(scenario.averageScoreLast30Days) : "-"}</td>
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
        <div className="tab-panel page-stack">
          <DashboardNarrativePanel
            eyebrow="Quick read"
            title="What learner effort looks like"
            narrative={usersNarrative}
            badges={[
              `${userSummary?.userCount ?? users.length} users in scope`,
              `${userSummary?.simulationsLast30Days ?? 0} attempts`,
            ]}
          />

          <section className="metric-grid metric-grid-primary">
            <MetricCard label="Users in scope" value={`${userSummary?.userCount ?? users.length}`} meta="Reporting scope" />
            <MetricCard label="Active users" value={`${userSummary?.activeUserCount ?? 0}`} meta="Current account status" />
            <MetricCard
              label="Total attempts"
              value={`${userSummary?.simulationsLast30Days ?? users.reduce((total, user) => total + user.simulationsLast30Days, 0)}`}
              meta="All recorded attempts in the last 30 days"
              tone="accent"
            />
            <MetricCard
              label="Average score (30 days)"
              value={
                userSummary?.averageScoreLast30Days !== null && userSummary?.averageScoreLast30Days !== undefined
                  ? formatScore(userSummary.averageScoreLast30Days)
                  : "-"
              }
              meta="Weighted average from conclusive scored attempts only"
              tone="positive"
            />
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Movement and focus</p>
                <h2>Who stands out right now</h2>
                <p className="section-copy">
                  These cards surface current effort, positive movement, and evidence strength without ranking users who do not yet have enough score history.
                </p>
              </div>
            </div>

            <div className="info-grid">
              <article className="detail-card">
                <p className="metric-label">Most engaged</p>
                <strong className="metric-value dashboard-insight-value">
                  {userHighlights.mostEngaged?.email ?? "No recent activity"}
                </strong>
                <p className="metric-meta">
                  {userHighlights.mostEngaged
                    ? `${userHighlights.mostEngaged.simulationsLast30Days} simulations in the last 30 days`
                    : "Recent learner effort will appear here when activity is recorded."}
                </p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Positive movement</p>
                <strong className="metric-value dashboard-insight-value">
                  {userHighlights.improvingUser?.email ?? "Too early to call"}
                </strong>
                <p className="metric-meta">
                  {userHighlights.improvingUser?.scoreDeltaLast30Days !== null &&
                  userHighlights.improvingUser?.scoreDeltaLast30Days !== undefined
                    ? `${formatScore(userHighlights.improvingUser.averageScoreLast30Days ?? 0)} avg | ${userHighlights.improvingUser.scoreDeltaLast30Days > 0 ? "+" : ""}${userHighlights.improvingUser.scoreDeltaLast30Days} vs prior 30 days`
                    : "No user currently has enough positive score history to call out confidently."}
                </p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Needs review</p>
                <strong className="metric-value dashboard-insight-value">
                  {userHighlights.needsAttention?.email ?? "Too early to compare"}
                </strong>
                <p className="metric-meta">
                  {userHighlights.needsAttention
                    ? userHighlights.needsAttention.scoreDeltaLast30Days !== null && userHighlights.needsAttention.scoreDeltaLast30Days < 0
                      ? `${userHighlights.needsAttention.scoreDeltaLast30Days} vs prior 30 days`
                      : `${formatScore(userHighlights.needsAttention.averageScoreLast30Days ?? 0)} avg in the comparison set`
                    : "More conclusive scored attempts are needed before score-based coaching attention is reliable."}
                </p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Comparison coverage</p>
                <strong className="metric-value dashboard-insight-value">{comparisonCoverageCount}</strong>
                <p className="metric-meta">Users with at least 2 conclusive scored attempts in the last 30 days.</p>
              </article>
            </div>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Details</p>
                <h2>User performance table</h2>
                <p className="section-copy">
                  Raw user-level detail remains accessible below the interpretation layer. Users with little or no scored activity still appear in the table.
                </p>
              </div>
            </div>

            {users.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table dashboard-table">
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
                <p>
                  {isSuperUser
                    ? "User activity will appear here once attempts are recorded across the customer accounts currently in scope."
                    : "User activity will appear here once attempts are recorded in your reporting scope."}
                </p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "company" ? (
        <div className="tab-panel page-stack">
          <DashboardNarrativePanel
            eyebrow="Quick read"
            title="What is happening across the company"
            narrative={companyNarrative}
            badges={[
              `${companySummary?.activeUsers ?? 0} active users`,
              `${activeTrainingCount} active trainings with recent usage`,
            ]}
          />

          <section className="metric-grid metric-grid-primary">
            <MetricCard
              label="Usage this period"
              value={formatUsageMinutes(companySummary?.monthlyUsageMinutes ?? 0)}
              meta="Current billing period"
            />
            <MetricCard
              label="Total attempts"
              value={`${companySummary?.simulationsLast30Days ?? 0}`}
              meta="All recorded attempts in the last 30 days"
              tone="accent"
            />
            <MetricCard label="Active users" value={`${companySummary?.activeUsers ?? 0}`} meta="Current reporting scope" />
            <MetricCard
              label="Average score (30 days)"
              value={
                userSummary?.averageScoreLast30Days !== null && userSummary?.averageScoreLast30Days !== undefined
                  ? formatScore(userSummary.averageScoreLast30Days)
                  : "-"
              }
              meta="Weighted average from conclusive scored attempts only"
              tone="positive"
            />
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Movement and focus</p>
                <h2>Where leadership should look next</h2>
                <p className="section-copy">
                  These signals separate current usage breadth, score evidence, and rollout gaps before you open the raw training table.
                </p>
              </div>
            </div>

            <div className="info-grid">
              <article className="detail-card">
                <p className="metric-label">Lead training</p>
                <strong className="metric-value dashboard-insight-value">{leadTraining?.name ?? "No recent activity"}</strong>
                <p className="metric-meta">
                  {leadTraining
                    ? `${leadTraining.summary.totalAttemptsLast30Days} attempts | ${leadTraining.summary.activeLearnerCountLast30Days} active learners`
                    : "A lead training will appear here as activity is recorded."}
                </p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Activity breadth</p>
                <strong className="metric-value dashboard-insight-value">{activeTrainingCount}</strong>
                <p className="metric-meta">Trainings with recorded attempts in the last 30 days.</p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Score movement</p>
                <strong className="metric-value dashboard-insight-value">{companyMovementLabel}</strong>
                <p className="metric-meta">{companyMovementMeta}</p>
              </article>
              <article className="detail-card">
                <p className="metric-label">Underused active training</p>
                <strong className="metric-value dashboard-insight-value">
                  {underusedActiveTrainingCount === 0 ? "None" : `${underusedActiveTrainingCount}`}
                </strong>
                <p className="metric-meta">
                  {underusedActiveTrainingCount === 0
                    ? "Every active training has at least some recent usage."
                    : "Active trainings with no recent attempts in the current window."}
                </p>
              </article>
            </div>

            {topScenario ? (
              <p className="small-copy" style={{ marginBottom: 0 }}>
                The most active scenario right now is {topScenario.title}, with {topScenario.attemptsLast30Days} attempts recorded in the current 30-day window.
              </p>
            ) : null}
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Details</p>
                <h2>Top trainings by activity</h2>
                <p className="section-copy">
                  Raw training-level detail stays accessible below the interpretation layer. Attempt totals reflect usage activity; score averages reflect only completed scored attempts.
                </p>
              </div>
            </div>

            {topTrainings.length > 0 ? (
              <div className="table-scroll">
                <table className="data-table dashboard-table">
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
                        <td>{training.summary.averageScoreLast30Days !== null ? formatScore(training.summary.averageScoreLast30Days) : "-"}</td>
                        <td>{formatDateTime(training.summary.latestActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state-panel">
                <h3>No training activity yet</h3>
                <p>
                  {isSuperUser
                    ? "Training-level aggregate reporting will appear here as activity is recorded across customer accounts in scope."
                    : "Training-level company reporting will appear here as activity is recorded."}
                </p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
