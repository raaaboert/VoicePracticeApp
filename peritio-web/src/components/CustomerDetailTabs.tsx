"use client";

import Link from "next/link";
import { useState } from "react";
import { DashboardCustomerInsights } from "@voicepractice/shared";

import { formatDateTime, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";
import { buildDashboardScopedTrainingPackHref } from "@/src/components/dashboardDivisionFilterState";

type CustomerTab = "overview" | "users" | "scenarios";

function formatOrgRole(orgRole: string): string {
  if (orgRole === "org_admin") {
    return "Org Admin";
  }
  if (orgRole === "user_admin") {
    return "User Admin";
  }
  return "User";
}

export function CustomerDetailTabs({
  customerName,
  insights,
  divisionId,
}: {
  customerName: string;
  insights: DashboardCustomerInsights;
  divisionId: string | null;
}) {
  const [activeTab, setActiveTab] = useState<CustomerTab>("overview");

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Details</p>
          <h2>Account breakdown</h2>
          <p className="section-copy">
            The detailed training, user, and scenario breakdown stays available below the narrative summary for deeper inspection.
          </p>
        </div>
      </div>

      <div className="tab-row" role="tablist" aria-label="Customer detail views">
        <button
          type="button"
          className={`tab-button${activeTab === "overview" ? " active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Company usage
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === "users" ? " active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          User performance
        </button>
        <button
          type="button"
          className={`tab-button${activeTab === "scenarios" ? " active" : ""}`}
          onClick={() => setActiveTab("scenarios")}
        >
          Scenario drilldown
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="tab-panel page-stack">
          <div className="trend-grid">
            {insights.trend.map((point) => (
              <article key={point.label} className="trend-card">
                <div className="trend-label-row">
                  <strong>{point.label}</strong>
                  <span>{formatUsageMinutes(point.usageMinutes)}</span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${Math.min(100, point.usageMinutes / 12)}%` }} />
                </div>
                <p className="small-copy">
                  {point.simulations} simulations | Avg conclusive score {point.averageScore !== null ? formatScore(point.averageScore) : "-"}
                </p>
              </article>
            ))}
          </div>

          {insights.trainingPackAttribution.unattributedUsageSessionsLast30Days > 0 ||
          insights.trainingPackAttribution.unattributedScoresLast30Days > 0 ? (
            <p className="small-copy" style={{ margin: 0 }}>
              Recent linked activity is shown below, while{" "}
              {insights.trainingPackAttribution.unattributedUsageSessionsLast30Days} usage sessions and{" "}
              {insights.trainingPackAttribution.unattributedScoresLast30Days} score records in the 30-day window were recorded before a pack link was available.
            </p>
          ) : null}

          <div className="info-grid">
            {insights.trainingPacks.length > 0 ? (
              insights.trainingPacks.map((trainingPack) => (
                <article key={trainingPack.trainingPackId} className="detail-card">
                  <div className="pill-row">
                    <span className="pill accent">{trainingPack.active ? "Active" : "Inactive"}</span>
                    <span className="pill">{trainingPack.scenarioSelectionLabel}</span>
                  </div>
                  <h3>
                    <Link
                      className="inline-link subtle"
                      href={buildDashboardScopedTrainingPackHref(trainingPack.trainingPackId, divisionId)}
                    >
                      {trainingPack.title}
                    </Link>
                  </h3>
                  <p>{trainingPack.trainingTopic || "No training brief recorded."}</p>
                  <dl className="inline-stats">
                    <div>
                      <dt>Assigned</dt>
                      <dd>{trainingPack.assignedLearnerCount}</dd>
                    </div>
                    <div>
                      <dt>In progress</dt>
                      <dd>{trainingPack.inProgressLearnerCount}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{trainingPack.completedLearnerCount}</dd>
                    </div>
                  </dl>
                  <p>
                    <strong>Conclusive scored attempts:</strong> {trainingPack.scoredAttemptsLast30Days} <strong>Avg score:</strong>{" "}
                    {trainingPack.averageScoreLast30Days !== null ? formatScore(trainingPack.averageScoreLast30Days) : "-"}
                  </p>
                  <p>
                    <strong>Trend:</strong>{" "}
                    {trainingPack.scoreDeltaLast30Days !== null ? formatSignedPercent(trainingPack.scoreDeltaLast30Days) : "No prior comparison"}{" "}
                    <strong>Not started:</strong> {trainingPack.notStartedLearnerCount}
                  </p>
                  <p className="small-copy">
                    Latest activity {formatDateTime(trainingPack.latestActivityAt)} | Updated {formatDateTime(trainingPack.updatedAt)}
                  </p>
                </article>
              ))
            ) : (
              <article className="detail-card">
                <h3>No training packs returned</h3>
                <p>{customerName} does not currently have training-pack rows available in this dashboard view.</p>
              </article>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div className="tab-panel">
          <div className="info-grid">
            {insights.users.map((user) => (
              <article key={user.userId} className="detail-card">
                <div className="pill-row">
                  <span className="pill">{formatOrgRole(user.orgRole)}</span>
                  <span className="pill accent">{user.dashboardAccessEnabled ? "Dashboard access" : "No dashboard access"}</span>
                </div>
                <h3>{user.email}</h3>
                <p className="small-copy">Last scenario: {user.lastScenarioTitle ?? "-"}</p>
                <dl className="inline-stats">
                  <div>
                    <dt>Simulations</dt>
                    <dd>{user.simulationsLast30Days}</dd>
                  </div>
                  <div>
                    <dt>Usage</dt>
                    <dd>{formatUsageMinutes(user.usedMinutesLast30Days)}</dd>
                  </div>
                  <div>
                    <dt>Average score</dt>
                    <dd>{user.averageScoreLast30Days !== null ? formatScore(user.averageScoreLast30Days) : "-"}</dd>
                  </div>
                </dl>
                <p className="small-copy">Latest activity: {formatDateTime(user.latestActivityAt)}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "scenarios" ? (
        <div className="tab-panel">
          <div className="info-grid">
            {insights.scenarios.length > 0 ? (
              insights.scenarios.map((scenario) => (
                <article key={scenario.scenarioId} className="detail-card">
                  <div className="pill-row">
                    <span className="pill">{scenario.segmentLabel}</span>
                    <span className="pill accent">{scenario.source === "custom" ? "Custom" : "Standard"}</span>
                  </div>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.summary ?? "No summary recorded for this scenario yet."}</p>
                  <dl className="inline-stats">
                    <div>
                      <dt>Attempts</dt>
                      <dd>{scenario.attemptsLast30Days}</dd>
                    </div>
                    <div>
                      <dt>Learners</dt>
                      <dd>{scenario.learnerCountLast30Days}</dd>
                    </div>
                    <div>
                      <dt>Avg conclusive score</dt>
                      <dd>{scenario.averageScoreLast30Days !== null ? formatScore(scenario.averageScoreLast30Days) : "-"}</dd>
                    </div>
                  </dl>
                  <p>
                    <strong>Score trend:</strong>{" "}
                    {scenario.scoreDeltaLast30Days !== null ? formatSignedPercent(scenario.scoreDeltaLast30Days) : "No prior comparison"}
                  </p>
                  <p>
                    <strong>Top learner:</strong>{" "}
                    {scenario.topUserEmail
                      ? `${scenario.topUserEmail}${scenario.topUserAverageScore !== null ? ` (${formatScore(scenario.topUserAverageScore)})` : ""}`
                      : "Not enough conclusive scored attempts yet"}
                  </p>
                  <p className="small-copy">Latest activity: {formatDateTime(scenario.latestActivityAt)}</p>
                </article>
              ))
            ) : (
              <article className="detail-card">
                <h3>No recent scenario activity</h3>
                <p>No recent simulation usage or scored attempts were found for this customer in the current 30-day reporting window.</p>
              </article>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
