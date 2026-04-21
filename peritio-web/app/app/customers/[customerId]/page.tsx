import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { CustomerDetailTabs } from "@/src/components/CustomerDetailTabs";
import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getAccessibleCustomerDetail, getDashboardViewer } from "@/src/lib/auth";
import { buildCustomerNarrative } from "@/src/lib/dashboardNarratives";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDate, formatDateTime, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Customer",
  };
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ divisionId?: string }>;
}) {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    redirect(buildDashboardSessionResetPath());
  }

  if (viewer.accessType !== "super_user") {
    redirect("/app/dashboard");
  }

  const { customerId } = await params;
  const rawDivisionId = (await searchParams).divisionId?.trim();
  const divisionId = rawDivisionId ? rawDivisionId : null;
  let payload;
  try {
    payload = await getAccessibleCustomerDetail(customerId, divisionId);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=customer-scope");
    }

    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { customer, insights } = payload;
  const narrative = buildCustomerNarrative(payload);
  const activeTrainingRows = insights.trainingPacks.filter((trainingPack) => trainingPack.attemptsLast30Days > 0);
  const topTraining =
    activeTrainingRows
      .slice()
      .sort((left, right) => right.attemptsLast30Days - left.attemptsLast30Days)[0] ?? null;
  const underusedActiveTrainings = insights.trainingPacks.filter(
    (trainingPack) => trainingPack.active && trainingPack.attemptsLast30Days === 0
  ).length;
  const topScenario =
    insights.scenarios
      .slice()
      .sort((left, right) => right.attemptsLast30Days - left.attemptsLast30Days)[0] ?? null;
  const totalScoredAttemptsLast30Days =
    insights.trainingPackAttribution.attributedScoresLast30Days + insights.trainingPackAttribution.unattributedScoresLast30Days;

  return (
    <>
      <PageHeader
        eyebrow="Customer detail"
        title={customer.orgName}
        description="Review current account usage, learner performance, scenario activity, and coaching signals for this customer."
        actions={
          <div className="pill-row">
            <span className="pill">{customer.industryLabels.join(", ") || "General"}</span>
            <span className="pill accent">{customer.orgStatus}</span>
          </div>
        }
      />

      <DashboardDivisionFilter divisionScope={payload.divisionScope} />

      <DashboardNarrativePanel
        eyebrow="Quick read"
        title="What this account is doing now"
        narrative={narrative}
        badges={[
          `${customer.activeUserCount} active users`,
          `${customer.simulationsLast30Days} simulations`,
        ]}
      />

      <section className="metric-grid metric-grid-primary">
        <MetricCard
          label="Active users"
          value={`${customer.activeUserCount}`}
          meta={`${customer.totalUserCount} total users | ${customer.dashboardUserCount} dashboard-enabled`}
        />
        <MetricCard
          label="Usage this period"
          value={formatUsageMinutes(insights.usage.usedMinutesThisPeriod)}
          meta={`${insights.usage.usagePercentThisPeriod}% of ${insights.usage.allottedMinutesThisPeriod} min allotted`}
          tone="accent"
        />
        <MetricCard
          label="Average score this period"
          value={customer.averageScoreThisPeriod !== null ? formatScore(customer.averageScoreThisPeriod) : "-"}
          meta={
            customer.scoreDeltaLast30Days !== null
              ? `${formatSignedPercent(customer.scoreDeltaLast30Days)} vs prior 30 days | conclusive scored attempts only`
              : "Current billing period average from conclusive scored attempts"
          }
          tone="positive"
        />
        <MetricCard
          label="Program surface"
          value={`${customer.activeTrainingPackCount} packs`}
          meta={`${customer.customScenarioCount} custom scenarios available`}
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Movement and focus</p>
            <h2>Where leadership should look next</h2>
            <p className="section-copy">
              These signals separate rollout breadth, score evidence, and underused training areas before you open the detailed account tabs.
            </p>
          </div>
        </div>

        <div className="info-grid">
          <article className="detail-card">
            <p className="metric-label">Lead training</p>
            <strong className="metric-value dashboard-insight-value">{topTraining?.title ?? "No active training yet"}</strong>
            <p className="metric-meta">
              {topTraining
                ? `${topTraining.attemptsLast30Days} attempts | ${topTraining.learnerCountLast30Days} learners in the last 30 days`
                : "A lead training will appear here once recent usage is recorded."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Rollout gap</p>
            <strong className="metric-value dashboard-insight-value">
              {underusedActiveTrainings === 0 ? "None" : `${underusedActiveTrainings}`}
            </strong>
            <p className="metric-meta">
              {underusedActiveTrainings === 0
                ? "Every active training pack has at least some recent engagement."
                : "Active training packs with no recent attempts in the current window."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Score signal</p>
            <strong className="metric-value dashboard-insight-value">
              {totalScoredAttemptsLast30Days >= 3
                ? customer.scoreDeltaLast30Days !== null
                  ? customer.scoreDeltaLast30Days > 0
                    ? "Positive"
                    : customer.scoreDeltaLast30Days < 0
                      ? "Softening"
                      : "Flat"
                  : "Mixed"
                : "Sparse"}
            </strong>
            <p className="metric-meta">
              {totalScoredAttemptsLast30Days >= 3
                ? customer.scoreDeltaLast30Days !== null
                  ? `${formatSignedPercent(customer.scoreDeltaLast30Days)} vs prior 30 days`
                  : "Enough scoring exists to read current averages, but not trend direction."
                : "More completed scored attempts are needed before trend direction is reliable."}
            </p>
          </article>
          <article className="detail-card">
            <p className="metric-label">Most active scenario</p>
            <strong className="metric-value dashboard-insight-value">
              {topScenario?.title ?? insights.coachingInsights.repeatedFocusArea ?? "No recent scenario signal"}
            </strong>
            <p className="metric-meta">
              {topScenario
                ? `${topScenario.attemptsLast30Days} attempts in the current window`
                : insights.coachingInsights.repeatedFocusArea
                  ? "Repeated coaching theme from artifact-backed scoring"
                  : "This fills in once scenario traffic or coaching coverage becomes meaningful."}
            </p>
          </article>
        </div>
      </section>

      <CoachingInsightsSection
        eyebrow="Coaching themes"
        title="What this customer most needs coaching on"
        description="These account-level coaching aggregates come only from persisted coaching artifacts inside this customer scope. They are useful for spotting repeated focus areas without retaining transcripts."
        insights={insights.coachingInsights}
        emptyMessage="This customer does not yet have enough new artifact-backed score records to produce coaching-theme aggregates."
      />

      <CustomerDetailTabs customerName={customer.orgName} insights={insights} />

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Reporting notes</p>
            <h2>What these metrics mean</h2>
            <p className="section-copy">
              These notes keep the underlying data contracts visible without crowding the top of the account page.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>Primary contact: {customer.contactName} ({customer.contactEmail}).</li>
          <li>Renewal window ends {formatDate(customer.nextRenewalAt)}. Latest recorded activity was {formatDateTime(customer.latestActivityAt)}.</li>
          <li>{customer.simulationsLast30Days} simulations were recorded in the last 30 days, with {insights.scenarios.length} scenario rows returning activity in the current reporting window.</li>
          <li>Average score metrics use conclusive scored attempts only. A completed scored attempt can still miss the desired outcome, so score reporting should not be read as a success-rate metric.</li>
          <li>
            {insights.trainingPackAttribution.attributedScoresLast30Days} scored attempts in the current 30-day window were linked to a training pack.{" "}
            {insights.trainingPackAttribution.unattributedScoresLast30Days > 0
              ? `${insights.trainingPackAttribution.unattributedScoresLast30Days} older score records in that window remain unattributed.`
              : "No unattributed score records remain in the current 30-day window."}
          </li>
        </ul>
      </section>
    </>
  );
}
