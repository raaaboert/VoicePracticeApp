import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CoachingInsightsSection } from "@/src/components/CoachingInsightsSection";
import { CustomerDetailTabs } from "@/src/components/CustomerDetailTabs";
import { DashboardDivisionFilter } from "@/src/components/DashboardDivisionFilter";
import { DashboardNarrativePanel } from "@/src/components/DashboardNarrativePanel";
import { DashboardProofSection } from "@/src/components/DashboardProofSection";
import { DashboardSupportSignals } from "@/src/components/DashboardSupportSignals";
import { DashboardWhatMattersSection } from "@/src/components/DashboardWhatMattersSection";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getAccessibleCustomerDetail, getDashboardViewer } from "@/src/lib/auth";
import { buildCustomerNarrative } from "@/src/lib/dashboardNarratives";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDate, formatDateTime } from "@/src/lib/formatters";

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

      <DashboardNarrativePanel eyebrow="Story" title="What this account is doing now" narrative={narrative} />

      <DashboardSupportSignals title="Account support signals" signals={narrative.signals} />

      <DashboardWhatMattersSection items={narrative.priorities} />

      <DashboardProofSection
        title="Account detail"
        description="Open coaching, account tabs, and reporting notes."
        preview="Coaching, account tabs, and reporting notes"
      >
        <div className="dashboard-proof-stack">
          <div className="dashboard-proof-block">
            <CoachingInsightsSection
              eyebrow="Coaching themes"
              title="What this customer most needs coaching on"
              description="These themes come from scored attempts in this customer scope that saved coaching detail."
              insights={insights.coachingInsights}
              emptyMessage="This customer does not yet have enough recent scored attempts with coaching detail to show coaching themes."
              embedded
            />
          </div>

          <div className="dashboard-proof-block">
            <CustomerDetailTabs customerName={customer.orgName} insights={insights} />
          </div>

          <div className="dashboard-proof-block">
            <h3>Reporting notes</h3>
            <p>These notes clarify the reporting contract for this account.</p>
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
          </div>
        </div>
      </DashboardProofSection>
    </>
  );
}
