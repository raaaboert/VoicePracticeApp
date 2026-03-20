import Link from "next/link";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { CoachingNormalizationDiagnosticsSection } from "@/src/components/CoachingNormalizationDiagnosticsSection";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { getDashboardOverview, getDashboardViewer, listAccessibleCustomers } from "@/src/lib/auth";
import { formatDate, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";

export default async function DashboardPage() {
  const viewer = await getDashboardViewer();
  const overview = await getDashboardOverview();
  const customers = overview?.customers ?? (await listAccessibleCustomers());

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Training insights"
        description={
          viewer?.accessType === "platform_admin"
            ? "Portfolio-wide usage, customer momentum, and top scenario activity are now coming from real protected backend data."
            : "Your company dashboard now reflects real usage, score, and scenario activity for your own customer account."
        }
      />

      <section className="metric-grid">
        <MetricCard
          label={viewer?.accessType === "platform_admin" ? "Active customers" : "Customer accounts"}
          value={`${overview?.summary.activeCustomers ?? customers.length}`}
          meta={viewer?.accessType === "platform_admin" ? "Organizations in your reporting view" : "Accounts in your reporting scope"}
        />
        <MetricCard
          label="Active users"
          value={`${overview?.summary.activeUsers ?? customers.reduce((total, customer) => total + customer.activeUserCount, 0)}`}
          meta={`${overview?.summary.dashboardUsers ?? customers.reduce((total, customer) => total + customer.dashboardUserCount, 0)} dashboard-enabled`}
        />
        <MetricCard
          label="Usage this month"
          value={formatUsageMinutes(overview?.summary.monthlyUsageMinutes ?? customers.reduce((total, customer) => total + customer.usedMinutesThisPeriod, 0))}
          meta={`${overview?.summary.simulationsLast30Days ?? customers.reduce((total, customer) => total + customer.simulationsLast30Days, 0)} simulations recorded`}
          tone="accent"
        />
        <MetricCard
          label="Average score"
          value={overview?.summary.averageScoreThisPeriod !== null && overview?.summary.averageScoreThisPeriod !== undefined ? formatScore(overview.summary.averageScoreThisPeriod) : "-"}
          meta={`${overview?.summary.activeTrainingPackCount ?? customers.reduce((total, customer) => total + customer.activeTrainingPackCount, 0)} active packs · ${overview?.summary.customScenarioCount ?? customers.reduce((total, customer) => total + customer.customScenarioCount, 0)} custom scenarios`}
          tone="positive"
        />
      </section>

      {overview?.coachingInsights ? (
        <CoachingInsightsSection
          eyebrow="Coaching themes"
          title="Most common coaching signals in your current scope"
          description="These aggregate coaching themes use persisted coaching artifacts only, so the counts reflect newer score records with saved strengths, improvement areas, and coaching priorities."
          insights={overview.coachingInsights}
          emptyMessage="New scored attempts with persisted coaching artifacts need to be recorded before aggregate coaching themes can appear here."
        />
      ) : null}

      {viewer?.accessType === "platform_admin" && overview?.coachingInsights.normalizationDiagnostics ? (
        <CoachingNormalizationDiagnosticsSection diagnostics={overview.coachingInsights.normalizationDiagnostics} />
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Customer momentum</p>
            <h2>How accounts are performing now</h2>
            <p className="section-copy">
              These cards are now driven by protected customer summaries rather than seeded placeholder momentum data.
            </p>
          </div>
        </div>

        <div className="info-grid">
          {customers.map((customer) => (
            <article key={customer.orgId} className="detail-card">
              <div className="pill-row">
                <span className="pill">{customer.industryLabels[0] ?? "General"}</span>
                {customer.scoreDeltaLast30Days !== null ? (
                  <span className="pill accent">{formatSignedPercent(customer.scoreDeltaLast30Days)}</span>
                ) : (
                  <span className="pill">No prior window</span>
                )}
              </div>
              <h3>{customer.orgName}</h3>
              <p>
                {customer.activeTrainingPackCount}/{customer.trainingPackCount} active training packs · {customer.customScenarioCount} custom scenarios
              </p>
              <dl className="inline-stats">
                <div>
                  <dt>Usage</dt>
                  <dd>{formatUsageMinutes(customer.usedMinutesThisPeriod)}</dd>
                </div>
                <div>
                  <dt>Avg score</dt>
                  <dd>{customer.averageScoreThisPeriod !== null ? formatScore(customer.averageScoreThisPeriod) : "-"}</dd>
                </div>
                <div>
                  <dt>Last activity</dt>
                  <dd>{formatDate(customer.latestActivityAt)}</dd>
                </div>
              </dl>
              <Link className="inline-link" href={`/app/customers/${customer.orgId}`}>
                Open customer view
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Scenario pulse</p>
            <h2>Highest-volume recent scenarios</h2>
            <p className="section-copy">
              This table is now populated from real scenario usage and score records inside the current viewer scope.
            </p>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Customer</th>
                <th>Attempts</th>
                <th>Learners</th>
                <th>Average score</th>
                <th>Trend</th>
                <th>Latest activity</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.topScenarios ?? []).map((scenario) => (
                <tr key={`${scenario.orgId}:${scenario.scenarioId}`}>
                  <td>
                    <strong>{scenario.title}</strong>
                    <div className="table-subcopy">
                      {scenario.segmentLabel} · {scenario.source === "custom" ? "Custom" : "Standard"}
                    </div>
                  </td>
                  <td>{scenario.orgName}</td>
                  <td>{scenario.attemptsLast30Days}</td>
                  <td>{scenario.learnerCountLast30Days}</td>
                  <td>{scenario.averageScoreLast30Days !== null ? formatScore(scenario.averageScoreLast30Days) : "-"}</td>
                  <td>{scenario.scoreDeltaLast30Days !== null ? formatSignedPercent(scenario.scoreDeltaLast30Days) : "No prior window"}</td>
                  <td>{formatDate(scenario.latestActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(overview?.trainingPackAttribution.unattributedUsageSessionsLast30Days ?? 0) > 0 ||
        (overview?.trainingPackAttribution.unattributedScoresLast30Days ?? 0) > 0 ? (
          <p className="small-copy" style={{ marginTop: "1rem" }}>
            Training-pack attribution is now live for newly linked activity. In the current 30-day window,{" "}
            {overview?.trainingPackAttribution.attributedScoresLast30Days ?? 0} score records are pack-linked and{" "}
            {overview?.trainingPackAttribution.unattributedScoresLast30Days ?? 0} older score records remain unattributed.
          </p>
        ) : null}
      </section>
    </>
  );
}
