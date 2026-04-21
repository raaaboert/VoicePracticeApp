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
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { buildDashboardAggregateScopeContext } from "@/src/components/dashboardReportingScope";
import { canRenderDashboardWorkspaceDivisionFilter } from "@/src/components/dashboardDivisionFilterState";
import {
  buildAggregateCompanyNarrative,
  buildAggregateTrainingNarrative,
  buildAggregateUsersNarrative,
} from "@/src/lib/dashboardNarratives";
import { formatDateTime, formatScore } from "@/src/lib/formatters";

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
  const trainingNarrative = buildAggregateTrainingNarrative(selectedTraining);
  const usersNarrative = buildAggregateUsersNarrative(userReport);
  const companyNarrative = buildAggregateCompanyNarrative({
    overview,
    trainings,
    userReport,
  });

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
                eyebrow="Story"
                title="What this training is doing now"
                narrative={trainingNarrative}
              />

              <DashboardSupportSignals signals={trainingNarrative.signals} />

              <DashboardWhatMattersSection
                title="What matters most right now"
                description="This is the shortest useful read before opening the supporting detail."
                items={trainingNarrative.priorities}
              />

              <DashboardProofSection
                title="Proof behind this training view"
                description="Open the supporting tables when you need the exact user and scenario evidence."
              >
                <div className="dashboard-proof-stack">
                  <div className="dashboard-proof-block">
                    <h3>User activity inside this training</h3>
                    <p>
                      Attempt counts reflect usage activity. Score averages reflect only completed conclusive scored attempts.
                    </p>

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
                  </div>

                  <div className="dashboard-proof-block">
                    <h3>Scenario performance</h3>
                    <p>Scenario-level detail remains available for exact usage, scoring, and latest-activity review.</p>

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
                  </div>
                </div>
              </DashboardProofSection>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div className="tab-panel page-stack">
          <DashboardNarrativePanel eyebrow="Story" title="What learner effort looks like" narrative={usersNarrative} />

          <DashboardSupportSignals signals={usersNarrative.signals} />

          <DashboardWhatMattersSection
            title="What matters most right now"
            description="These are the only learner-level implications worth carrying forward before inspecting the full table."
            items={usersNarrative.priorities}
          />

          <DashboardProofSection
            title="Proof behind this user view"
            description="Open the table when you need the full user list and the underlying attempt and score detail."
          >
            <div className="dashboard-proof-stack">
              <div className="dashboard-proof-block">
                <h3>User performance table</h3>
                <p>Users with little or no scored activity still remain visible here. The story layer simply keeps them out of overconfident comparison language.</p>

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
              </div>
            </div>
          </DashboardProofSection>
        </div>
      ) : null}

      {activeTab === "company" ? (
        <div className="tab-panel page-stack">
          <DashboardNarrativePanel
            eyebrow="Story"
            title="What is happening across the company"
            narrative={companyNarrative}
          />

          <DashboardSupportSignals signals={companyNarrative.signals} />

          <DashboardWhatMattersSection
            title="What matters most right now"
            description="This view stays focused on the highest-value implications for leadership before the training table comes into play."
            items={companyNarrative.priorities}
          />

          <DashboardProofSection
            title="Proof behind this company view"
            description="Open the training table when you need the supporting evidence for usage breadth, score signals, and latest activity."
          >
            <div className="dashboard-proof-stack">
              <div className="dashboard-proof-block">
                <h3>Top trainings by activity</h3>
                <p>Attempt totals reflect usage activity. Score averages reflect only completed conclusive scored attempts.</p>

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
              </div>
            </div>
          </DashboardProofSection>
        </div>
      ) : null}
    </div>
  );
}
