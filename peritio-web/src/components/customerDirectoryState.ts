import { DashboardCustomerSummary } from "@voicepractice/shared";

export type CustomerDirectoryStatusFilter = "all" | "active" | "inactive";
export type CustomerDirectorySortOption = "latest_activity" | "name" | "usage";

export interface CustomerDirectoryControls {
  searchTerm: string;
  statusFilter: CustomerDirectoryStatusFilter;
  sortBy: CustomerDirectorySortOption;
}

export const DEFAULT_CUSTOMER_DIRECTORY_CONTROLS: CustomerDirectoryControls = {
  searchTerm: "",
  statusFilter: "all",
  sortBy: "latest_activity",
};

function normalizeSearchTerm(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function getContactDomain(email: string): string {
  const [, domain = ""] = email.toLowerCase().split("@");
  return domain;
}

function buildCustomerSearchIndex(customer: DashboardCustomerSummary): string {
  return [
    customer.orgName,
    customer.contactName,
    customer.contactEmail,
    getContactDomain(customer.contactEmail),
    ...customer.industryLabels,
    ...customer.customerUsers.map((user) => user.email),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesStatus(
  customer: DashboardCustomerSummary,
  statusFilter: CustomerDirectoryStatusFilter
): boolean {
  if (statusFilter === "all") {
    return true;
  }

  return statusFilter === "active" ? customer.orgStatus === "active" : customer.orgStatus !== "active";
}

function matchesSearch(customer: DashboardCustomerSummary, searchTerm: string): boolean {
  const tokens = normalizeSearchTerm(searchTerm);
  if (tokens.length === 0) {
    return true;
  }

  const haystack = buildCustomerSearchIndex(customer);
  return tokens.every((token) => haystack.includes(token));
}

function compareLatestActivity(left: DashboardCustomerSummary, right: DashboardCustomerSummary): number {
  const leftMs = new Date(left.latestActivityAt ?? 0).getTime() || 0;
  const rightMs = new Date(right.latestActivityAt ?? 0).getTime() || 0;
  return rightMs - leftMs;
}

export function getVisibleCustomers(
  customers: DashboardCustomerSummary[],
  controls: CustomerDirectoryControls
): DashboardCustomerSummary[] {
  return customers
    .filter((customer) => matchesStatus(customer, controls.statusFilter) && matchesSearch(customer, controls.searchTerm))
    .slice()
    .sort((left, right) => {
      if (controls.sortBy === "name") {
        return left.orgName.localeCompare(right.orgName);
      }

      if (controls.sortBy === "usage") {
        if (right.usedMinutesThisPeriod !== left.usedMinutesThisPeriod) {
          return right.usedMinutesThisPeriod - left.usedMinutesThisPeriod;
        }
        return left.orgName.localeCompare(right.orgName);
      }

      const latestActivityComparison = compareLatestActivity(left, right);
      if (latestActivityComparison !== 0) {
        return latestActivityComparison;
      }

      return left.orgName.localeCompare(right.orgName);
    });
}
