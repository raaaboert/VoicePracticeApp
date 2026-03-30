import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { CustomerDetailTabs } from "@/src/components/CustomerDetailTabs";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, getAccessibleCustomerDetail, getDashboardViewer } from "@/src/lib/auth";
import { formatDate, formatDateTime, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Customer",
  };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const viewer = await getDashboardViewer();
  if (viewer?.accessType !== "super_user") {
    redirect("/app/dashboard");
  }

  const { customerId } = await params;
  let payload;
  try {
    payload = await getAccessibleCustomerDetail(customerId);
  } catch (error) {
    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/access-denied?reason=customer-scope");
    }

    throw error;
  }

  if (!payload) {
    notFound();
  }

  const { customer, insights } = payload;

  return (
    <>
      <PageHeader
        eyebrow="Customer detail"
        title={customer.orgName}
        description="This account page now uses live protected org usage, user performance, scenario activity, and forward-only training-pack attribution."
        actions={
          <div className="pill-row">
            <span className="pill">{customer.industryLabels.join(", ") || "General"}</span>
            <span className="pill accent">{customer.orgStatus}</span>
          </div>
        }
      />

      <section className="metric-grid">
        <MetricCard
          label="Active users"
          value={`${customer.activeUserCount}`}
          meta={`${customer.totalUserCount} total users · ${customer.dashboardUserCount} dashboard-enabled`}
        />
        <MetricCard
          label="Usage this period"
          value={formatUsageMinutes(insights.usage.usedMinutesThisPeriod)}
          meta={`${insights.usage.usagePercentThisPeriod}% of ${insights.usage.allottedMinutesThisPeriod} min allotted`}
          tone="accent"
        />
        <MetricCard
          label="Average score"
          value={customer.averageScoreThisPeriod !== null ? formatScore(customer.averageScoreThisPeriod) : "-"}
          meta={
            customer.scoreDeltaLast30Days !== null
              ? `${formatSignedPercent(customer.scoreDeltaLast30Days)} vs prior 30 days`
              : "No prior 30-day comparison"
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
            <p className="eyebrow">Account notes</p>
            <h2>Current account state</h2>
            <p className="section-copy">
              These notes are derived from the current protected account record rather than seeded placeholder content.
            </p>
          </div>
        </div>
        <ul className="bullet-list">
          <li>
            Primary contact is {customer.contactName} ({customer.contactEmail}).
          </li>
          <li>
            Renewal window ends {formatDate(customer.nextRenewalAt)}. Latest recorded activity was {formatDateTime(customer.latestActivityAt)}.
          </li>
          <li>
            {customer.simulationsLast30Days} simulations were recorded in the last 30 days, with {insights.scenarios.length} scenario rows returning live activity.
          </li>
          <li>
            {insights.trainingPackAttribution.attributedScoresLast30Days} scored attempts in the current 30-day window were linked to a training pack.{" "}
            {insights.trainingPackAttribution.unattributedScoresLast30Days > 0
              ? `${insights.trainingPackAttribution.unattributedScoresLast30Days} older score records in that window remain unattributed.`
              : "No unattributed score records remain in the current 30-day window."}
          </li>
        </ul>
      </section>

      <CoachingInsightsSection
        eyebrow="Coaching themes"
        title="What this customer most needs coaching on"
        description="These account-level coaching aggregates come only from persisted coaching artifacts inside this customer scope. They are useful for spotting repeated focus areas without retaining transcripts."
        insights={insights.coachingInsights}
        emptyMessage="This customer does not yet have enough new artifact-backed score records to produce coaching-theme aggregates."
      />

      <CustomerDetailTabs customerName={customer.orgName} insights={insights} />
    </>
  );
}
