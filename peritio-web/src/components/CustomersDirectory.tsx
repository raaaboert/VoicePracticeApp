"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { DashboardCustomerSummary } from "@voicepractice/shared";

import { formatDate, formatScore, formatSignedPercent, formatUsageMinutes } from "@/src/lib/formatters";
import {
  CustomerDirectorySortOption,
  CustomerDirectoryStatusFilter,
  DEFAULT_CUSTOMER_DIRECTORY_CONTROLS,
  getVisibleCustomers,
} from "@/src/components/customerDirectoryState";

function formatStatusLabel(status: DashboardCustomerSummary["orgStatus"]): string {
  return status === "active" ? "Active" : "Inactive";
}

export function CustomersDirectory({ customers }: { customers: DashboardCustomerSummary[] }) {
  const [searchTerm, setSearchTerm] = useState(DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.searchTerm);
  const [statusFilter, setStatusFilter] = useState<CustomerDirectoryStatusFilter>(
    DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.statusFilter
  );
  const [sortBy, setSortBy] = useState<CustomerDirectorySortOption>(DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.sortBy);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const visibleCustomers = getVisibleCustomers(customers, {
    searchTerm: deferredSearchTerm,
    statusFilter,
    sortBy,
  });
  const filtersActive =
    searchTerm.trim().length > 0 || statusFilter !== "all" || sortBy !== DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.sortBy;

  const resetControls = () => {
    setSearchTerm(DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.searchTerm);
    setStatusFilter(DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.statusFilter);
    setSortBy(DEFAULT_CUSTOMER_DIRECTORY_CONTROLS.sortBy);
  };

  return (
    <>
      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Find an account</p>
            <h2>Customers in scope</h2>
            <p className="section-copy">
              Search by company name, contact details, or known account user email. Use the account dashboard link for
              org-specific drilldown.
            </p>
          </div>
        </div>

        <div className="customer-directory-controls">
          <div className="customer-directory-search">
            <label className="field-label" htmlFor="customer-directory-search">
              Search
            </label>
            <input
              id="customer-directory-search"
              className="text-input"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search company, contact, or email"
            />
          </div>

          <div className="customer-directory-filter">
            <label className="field-label" htmlFor="customer-directory-status-filter">
              Account state
            </label>
            <select
              id="customer-directory-status-filter"
              className="text-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as CustomerDirectoryStatusFilter)}
            >
              <option value="all">All accounts</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <div className="customer-directory-filter">
            <label className="field-label" htmlFor="customer-directory-sort">
              Sort by
            </label>
            <select
              id="customer-directory-sort"
              className="text-input"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as CustomerDirectorySortOption)}
            >
              <option value="latest_activity">Latest activity</option>
              <option value="usage">Usage this period</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>

          <div className="customer-directory-actions">
            <button type="button" className="ghost-button" onClick={resetControls} disabled={!filtersActive}>
              Reset
            </button>
          </div>
        </div>

        <div className="customer-directory-results-meta">
          <p className="small-copy">
            Showing {visibleCustomers.length} of {customers.length} customer accounts in scope.
          </p>
        </div>
      </section>

      {visibleCustomers.length > 0 ? (
        <section className="info-grid">
          {visibleCustomers.map((customer) => (
            <article key={customer.orgId} className="detail-card">
              <div className="pill-row">
                <span className="pill">{customer.industryLabels[0] ?? "General"}</span>
                <span className={`pill${customer.orgStatus === "active" ? " accent" : ""}`}>
                  {formatStatusLabel(customer.orgStatus)}
                </span>
                {customer.scoreDeltaLast30Days !== null ? (
                  <span className="pill accent">{formatSignedPercent(customer.scoreDeltaLast30Days)}</span>
                ) : (
                  <span className="pill">New score window</span>
                )}
              </div>
              <h2>{customer.orgName}</h2>
              <p>
                Contact: {customer.contactName} - {customer.contactEmail}
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
                {customer.simulationsLast30Days} simulations in the last 30 days. Renewal window ends{" "}
                {formatDate(customer.nextRenewalAt)}.
              </p>
              <Link className="inline-link" href={`/app/customers/${customer.orgId}`}>
                View account dashboard
              </Link>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state-panel">
          <h3>No customer accounts matched</h3>
          <p>Try a different name, contact email, or reset the current search and filters.</p>
          <div className="customer-directory-empty-actions">
            <button type="button" className="ghost-button" onClick={resetControls}>
              Clear search and filters
            </button>
          </div>
        </section>
      )}
    </>
  );
}
