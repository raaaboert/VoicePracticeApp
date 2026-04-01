import { redirect } from "next/navigation";

import { CustomersDirectory } from "@/src/components/CustomersDirectory";
import { MetricCard } from "@/src/components/MetricCard";
import { PageHeader } from "@/src/components/PageHeader";
import { DashboardAccessDeniedError, DashboardSessionInvalidError, getDashboardViewer, listAccessibleCustomers } from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";

export default async function CustomersPage() {
  const viewer = await getDashboardViewer();
  if (!viewer) {
    redirect(buildDashboardSessionResetPath());
  }

  if (viewer.accessType !== "super_user") {
    redirect("/app/dashboard");
  }

  let customers;
  try {
    customers = await listAccessibleCustomers();
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }

    if (error instanceof DashboardAccessDeniedError) {
      redirect("/app/dashboard");
    }

    throw error;
  }

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
          "Review customer accounts in scope, find the right company quickly, and open the account dashboard for org-specific drilldown."
        }
      />

      <section className="metric-grid">
        <MetricCard label="Customer accounts" value={`${customerCount}`} meta="Accounts currently in your reporting scope" />
        <MetricCard
          label="Active learners"
          value={`${totalActiveUsers}`}
          meta="Active enterprise users across visible accounts"
          tone="accent"
        />
        <MetricCard
          label="Active training packs"
          value={`${activeTrainingPacks}`}
          meta="Live programs returned by the current backend"
        />
        <MetricCard
          label="Custom scenarios"
          value={`${customScenarios}`}
          meta="Enabled org-specific scenarios currently available"
          tone="positive"
        />
      </section>

      <CustomersDirectory customers={customers} />
    </>
  );
}
