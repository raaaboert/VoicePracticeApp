import Link from "next/link";
import { redirect } from "next/navigation";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { getDashboardViewer, listAccessibleCustomers } from "@/src/lib/auth";
import { formatDate, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";

export default async function CustomersPage() {
  const viewer = await getDashboardViewer();
  if (!viewer?.isSuperUser) {
    redirect("/app/dashboard");
  }
  const customers = await listAccessibleCustomers();
  const customerCount = customers.length;
  const totalActiveUsers = customers.reduce((total, customer) => total + customer.activeUserCount, 0);
  const activeTrainingPacks = customers.reduce((total, customer) => total + customer.activeTrainingPackCount, 0);
  const customScenarios = customers.reduce((total, customer) => total + customer.customScenarioCount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Customer accounts"
        description={
          "Review customer accounts in scope. These cards use the current protected usage, score, and account data."
        }
      />

      <section className="metric-grid">
        <MetricCard label="Customer accounts" value={`${customerCount}`} meta="Accounts currently in your reporting scope" />
        <MetricCard label="Active learners" value={`${totalActiveUsers}`} meta="Active enterprise users across visible accounts" tone="accent" />
        <MetricCard label="Active training packs" value={`${activeTrainingPacks}`} meta="Live programs returned by the current backend" />
        <MetricCard label="Custom scenarios" value={`${customScenarios}`} meta="Enabled org-specific scenarios currently available" tone="positive" />
      </section>

      <section className="info-grid">
        {customers.map((customer) => (
          <article key={customer.orgId} className="detail-card">
            <div className="pill-row">
              <span className="pill">{customer.industryLabels[0] ?? "General"}</span>
              {customer.scoreDeltaLast30Days !== null ? (
                <span className="pill accent">{formatSignedPercent(customer.scoreDeltaLast30Days)}</span>
              ) : (
                <span className="pill">New score window</span>
              )}
            </div>
            <h2>{customer.orgName}</h2>
            <p>
              Contact: {customer.contactName} · {customer.contactEmail}
            </p>
            <dl className="inline-stats">
              <div>
                <dt>Users</dt>
                <dd>
                  {customer.activeUserCount}/{customer.totalUserCount}
                </dd>
              </div>
              <div>
                <dt>Usage</dt>
                <dd>{formatUsageMinutes(customer.usedMinutesThisPeriod)}</dd>
              </div>
              <div>
                <dt>Avg score</dt>
                <dd>{customer.averageScoreThisPeriod !== null ? formatScore(customer.averageScoreThisPeriod) : "-"}</dd>
              </div>
            </dl>
            <dl className="inline-stats">
              <div>
                <dt>Packs</dt>
                <dd>
                  {customer.activeTrainingPackCount}/{customer.trainingPackCount}
                </dd>
              </div>
              <div>
                <dt>Custom scenarios</dt>
                <dd>{customer.customScenarioCount}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>{formatDate(customer.latestActivityAt)}</dd>
              </div>
            </dl>
            <p className="small-copy">
              {customer.simulationsLast30Days} simulations in the last 30 days. Renewal window ends {formatDate(customer.nextRenewalAt)}.
            </p>
            <Link className="inline-link" href={`/app/customers/${customer.orgId}`}>
              View account dashboard
            </Link>
          </article>
        ))}
      </section>
    </>
  );
}
