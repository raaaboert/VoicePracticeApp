import { DashboardCustomerSummary } from "@voicepractice/shared";

export interface DashboardAggregateScopeContext {
  customerCount: number;
  activeCustomerCount: number;
  inactiveCustomerCount: number;
  description: string;
  detail: string;
  activityNote: string | null;
}

export function buildDashboardAggregateScopeContext(
  customers: DashboardCustomerSummary[]
): DashboardAggregateScopeContext {
  const customerCount = customers.length;
  const activeCustomerCount = customers.filter((customer) => customer.orgStatus === "active").length;
  const inactiveCustomerCount = Math.max(0, customerCount - activeCustomerCount);
  const customersWithActivity = customers
    .filter((customer) => customer.simulationsLast30Days > 0)
    .slice()
    .sort((left, right) => right.simulationsLast30Days - left.simulationsLast30Days);
  const totalSimulationsLast30Days = customersWithActivity.reduce(
    (total, customer) => total + customer.simulationsLast30Days,
    0
  );

  const description =
    customerCount === 1
      ? "Viewing aggregate reporting across the single customer account currently in scope."
      : `Viewing aggregate reporting across ${customerCount} customer accounts currently in scope.`;
  const detail =
    inactiveCustomerCount > 0
      ? `${activeCustomerCount} active and ${inactiveCustomerCount} inactive customer accounts are included in this reporting scope.`
      : "All visible customer accounts in this reporting scope are active.";

  let activityNote: string | null = null;
  if (customersWithActivity.length === 0) {
    activityNote = "Recent activity is quiet across the customer accounts currently in scope.";
  } else if (customersWithActivity.length === 1) {
    activityNote = `Recent activity is currently coming from ${customersWithActivity[0]?.orgName ?? "one customer account"}.`;
  } else if (totalSimulationsLast30Days > 0) {
    const leadCustomer = customersWithActivity[0]!;
    const topTwoShare =
      (customersWithActivity[0]?.simulationsLast30Days ?? 0)
      + (customersWithActivity[1]?.simulationsLast30Days ?? 0);
    const leadShare = leadCustomer.simulationsLast30Days / totalSimulationsLast30Days;
    if (leadShare >= 0.6) {
      activityNote = `Most recent activity is concentrated in ${leadCustomer.orgName}.`;
    } else if (customersWithActivity.length > 2 && topTwoShare / totalSimulationsLast30Days >= 0.8) {
      activityNote = "Most recent activity is concentrated in a small number of customer accounts.";
    }
  }

  return {
    customerCount,
    activeCustomerCount,
    inactiveCustomerCount,
    description,
    detail,
    activityNote,
  };
}
