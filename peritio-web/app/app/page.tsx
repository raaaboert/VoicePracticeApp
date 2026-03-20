import Link from "next/link";

import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { getDashboardOverview, getDashboardViewer } from "@/src/lib/auth";
import { formatScore, formatUsageMinutes } from "@/src/lib/formatters";

export default async function WorkspacePage() {
  const viewer = await getDashboardViewer();
  const overview = await getDashboardOverview();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Peritio dashboard"
        description={
          viewer?.accessType === "platform_admin"
            ? "The shell is now backed by real customer usage, protected scenario data, forward-only training-pack attribution, and live secondary reporting routes."
            : "Your workspace is now grounded in your actual customer account, with live overview metrics and customer-scoped reporting."
        }
      />

      <section className="metric-grid">
        <MetricCard
          label={viewer?.accessType === "platform_admin" ? "Active customers" : "Customer accounts"}
          value={`${overview?.summary.activeCustomers ?? 0}`}
          meta={viewer?.accessType === "platform_admin" ? "Accounts currently in your scope" : "Your allowed account scope"}
        />
        <MetricCard label="Active users" value={`${overview?.summary.activeUsers ?? 0}`} meta={`${overview?.summary.dashboardUsers ?? 0} dashboard-enabled`} tone="accent" />
        <MetricCard
          label="Monthly usage"
          value={formatUsageMinutes(overview?.summary.monthlyUsageMinutes ?? 0)}
          meta="Live org usage totals from the current backend"
        />
        <MetricCard
          label="Average score"
          value={overview?.summary.averageScoreThisPeriod !== null && overview?.summary.averageScoreThisPeriod !== undefined ? formatScore(overview.summary.averageScoreThisPeriod) : "-"}
          meta={`${overview?.summary.activeTrainingPackCount ?? 0} active packs`}
          tone="positive"
        />
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Routes</p>
            <h2>What is ready now</h2>
            <p className="section-copy">
              Overview and customer routes now use real protected data. Training and users remain lighter scaffolds while those views wait for the next round of live wiring.
            </p>
          </div>
        </div>

        <div className="route-grid">
          <Link className="route-card" href="/app/dashboard">
            <strong>Dashboard</strong>
            <span>Real overview metrics and top scenario activity across the current viewer scope.</span>
          </Link>
          <Link className="route-card" href="/app/customers">
            <strong>Customers</strong>
            <span>Real account list, customer detail, user performance, and scenario drilldown.</span>
          </Link>
          <Link className="route-card" href="/app/training">
            <strong>Training</strong>
            <span>Real pack reporting, including scoped learner activity and pack-linked score trends.</span>
          </Link>
          <Link className="route-card" href="/app/users">
            <strong>Users</strong>
            <span>Real user reporting, including activity, score trends, and latest pack-linked work.</span>
          </Link>
          <Link className="route-card" href="/app/settings">
            <strong>Settings</strong>
            <span>Theme control and the future home for dashboard/user preferences.</span>
          </Link>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Customers in view</p>
            <h2>{viewer?.accessType === "platform_admin" ? "Portfolio in scope" : "Your account in scope"}</h2>
            <p className="section-copy">These customer cards are now coming from the same protected overview response used by the dashboard page.</p>
          </div>
        </div>

        <div className="info-grid">
          {(overview?.customers ?? []).map((customer) => (
            <article key={customer.orgId} className="detail-card">
              <div className="pill-row">
                <span className="pill">{customer.industryLabels[0] ?? "General"}</span>
                <span className="pill accent">{customer.simulationsLast30Days} simulations</span>
              </div>
              <h3>{customer.orgName}</h3>
              <p>
                {customer.activeUserCount} active users · {customer.activeTrainingPackCount}/{customer.trainingPackCount} active packs
              </p>
              <p className="small-copy">
                {customer.customScenarioCount} custom scenarios · avg score{" "}
                {customer.averageScoreThisPeriod !== null ? formatScore(customer.averageScoreThisPeriod) : "-"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
